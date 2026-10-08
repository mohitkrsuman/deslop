import "server-only";

import { rm } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { fetchGithubArchive, parseGithubUrl } from "@/lib/github-archive";
import { parseRepository } from "@/lib/parser/parse.mts";
import type { ParserResult } from "@/lib/parser/types.mts";

export type PipelineStage = "queued" | "fetching" | "selecting" | "parsing" | "storing" | "complete" | "failed";

export function createWorkerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_SECRET_KEY for analysis writes.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type Worker = ReturnType<typeof createWorkerClient>;

async function stage(client: Worker, id: string, value: PipelineStage, message: string) {
  const { error } = await client.from("analyses").update({
    stage: value, stage_message: message, stage_started_at: new Date().toISOString(),
    status: value === "complete" ? "complete" : value === "failed" ? "failed" : "analyzing",
    ...(value === "complete" || value === "failed" ? { finished_at: new Date().toISOString() } : {}),
  }).eq("id", id);
  if (error) throw error;
}

function coveragePercent(result: ParserResult): number {
  const files = result.coverage.filesFound === 0 ? 100 :
    result.coverage.filesParsed / result.coverage.filesFound;
  const imports = result.coverage.imports;
  const local = imports.resolved + imports.unresolved + imports.excluded;
  const resolved = local === 0 ? 1 : imports.resolved / local;
  return Math.round(Math.min(files, resolved) * 10000) / 100;
}

async function storeResult(client: Worker, id: string, organizationId: string, result: ParserResult, commitSha: string) {
  const removed = await client.from("files").delete().eq("analysis_id", id);
  if (removed.error) throw removed.error;

  const ids = new Map<string, string>();
  for (let start = 0; start < result.files.length; start += 300) {
    const batch = result.files.slice(start, start + 300).map((file) => ({
      organization_id: organizationId, analysis_id: id, path: file.path,
      language: file.path.split(".").at(-1) ?? null,
      folder: file.folder, module_id: file.moduleId, kind: file.kind,
      line_count: file.lineCount, sha256: file.sha256,
      fan_in: file.fanIn, fan_out: file.fanOut,
    }));
    const { data, error } = await client.from("files").insert(batch).select("id,path");
    if (error) throw error;
    for (const file of data ?? []) ids.set(file.path, file.id);
  }
  for (let start = 0; start < result.edges.length; start += 300) {
    const batch = result.edges.slice(start, start + 300).map((edge) => ({
      organization_id: organizationId, analysis_id: id,
      source_file_id: ids.get(edge.from)!, target_file_id: ids.get(edge.to)!, kind: edge.kind,
    }));
    const { error } = await client.from("edges").insert(batch);
    if (error) throw error;
  }
  const { error } = await client.from("analyses").update({
    commit_sha: commitSha, adapter: result.adapter, coverage: result.coverage,
    coverage_percent: coveragePercent(result), import_count: result.coverage.imports.found,
  }).eq("id", id);
  if (error) throw error;
}

export async function runAnalysis(id: string, organizationId: string, repositoryUrl: string) {
  const client = createWorkerClient();
  let currentStage: PipelineStage = "fetching";
  let directory: string | undefined;
  try {
    await stage(client, id, currentStage, "Fetching the public repository archive");
    const repository = parseGithubUrl(repositoryUrl);
    const archive = await fetchGithubArchive(repository);
    directory = archive.directory;
    currentStage = "selecting";
    await stage(client, id, currentStage, "Selecting source files");
    currentStage = "parsing";
    await stage(client, id, currentStage, "Parsing imports and dependencies");
    const result = await parseRepository(directory);
    currentStage = "storing";
    await stage(client, id, currentStage, "Storing the map and coverage report");
    await storeResult(client, id, organizationId, result, archive.commitSha);
    await stage(client, id, "complete", "Map ready");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const { error } = await client.from("analyses").update({
      stage: "failed", stage_message: `Failed during ${currentStage}: ${message}`,
      failed_stage: currentStage, error_message: message, status: "failed",
      stage_started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) console.error("Could not record analysis failure", id, error);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
