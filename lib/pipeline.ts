import "server-only";

import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { classifyFile, excerptOf } from "@/lib/ai/classify";
import { MODEL } from "@/lib/ai/client";
import { workerModelCache } from "@/lib/ai/cache";
import { fetchGithubArchive, parseGithubUrl } from "@/lib/github-archive";
import { FRAMEWORK_ADAPTERS } from "@/lib/parser/adapters/index.mts";
import { parseRepository } from "@/lib/parser/parse.mts";
import type { ParserResult } from "@/lib/parser/types.mts";
import { createWorkerClient } from "@/lib/supabase-worker";
import { GENERIC_ROLES } from "@/lib/taxonomy.mts";

export type PipelineStage = "queued" | "fetching" | "selecting" | "parsing" | "storing" | "labelling" | "complete" | "failed";

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

async function storeResult(client: Worker, id: string, organizationId: string, result: ParserResult, commitSha: string): Promise<Map<string, string>> {
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
  // Old routes went with the deleted files; their foreign key cascades.
  for (let start = 0; start < result.routes.length; start += 300) {
    const batch = result.routes.slice(start, start + 300).map((route) => ({
      organization_id: organizationId, analysis_id: id,
      file_id: ids.get(route.file)!, method: route.method, path: route.path,
    }));
    const { error } = await client.from("routes").insert(batch);
    if (error) throw error;
  }
  const { error } = await client.from("analyses").update({
    commit_sha: commitSha, adapter: result.adapter, coverage: result.coverage,
    coverage_percent: coveragePercent(result), import_count: result.coverage.imports.found,
  }).eq("id", id);
  if (error) throw error;
  return ids;
}

const LABELLING_CONCURRENCY = 6;

// Gives files no adapter identified a non-structural role. A failure here
// leaves those files unidentified and is recorded, rather than costing the map.
async function labelUnidentified(
  client: Worker, id: string, organizationId: string, directory: string, result: ParserResult, ids: Map<string, string>,
): Promise<string | null> {
  const targets = result.files.filter((file) => file.kind === GENERIC_ROLES.other);
  if (targets.length === 0) return null;
  const imports = new Map<string, Set<string>>();
  for (const edge of result.edges) imports.set(edge.from, (imports.get(edge.from) ?? new Set()).add(edge.to));

  const cache = workerModelCache(organizationId);
  const rows: { organization_id: string; analysis_id: string; file_id: string; role: string; model: string }[] = [];
  const failures: string[] = [];
  const queue = [...targets];
  let done = 0;
  async function work() {
    for (let file = queue.shift(); file; file = queue.shift()) {
      try {
        const source = await readFile(path.join(directory, file.path), "utf8");
        const { output } = await classifyFile({
          path: file.path, sha256: file.sha256, imports: [...imports.get(file.path) ?? []].sort(), excerpt: excerptOf(source),
        }, cache);
        if (output.role !== "none") {
          rows.push({ organization_id: organizationId, analysis_id: id, file_id: ids.get(file.path)!, role: output.role, model: MODEL });
        }
      } catch (cause) {
        failures.push(`${file.path}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      done += 1;
      if (done % 25 === 0) await stage(client, id, "labelling", `Labelled ${done} of ${targets.length} files no adapter identified`);
    }
  }
  await Promise.all(Array.from({ length: LABELLING_CONCURRENCY }, work));

  for (let start = 0; start < rows.length; start += 300) {
    const { error } = await client.from("file_roles").insert(rows.slice(start, start + 300));
    if (error) throw error;
  }
  if (failures.length === 0) return null;
  return `${failures.length} of ${targets.length} files could not be labelled. First: ${failures[0]}`;
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
    const result = await parseRepository(directory, FRAMEWORK_ADAPTERS);
    currentStage = "storing";
    await stage(client, id, currentStage, "Storing the map and coverage report");
    const ids = await storeResult(client, id, organizationId, result, archive.commitSha);
    currentStage = "labelling";
    await stage(client, id, currentStage, "Labelling files no adapter identified");
    const labellingError = await labelUnidentified(client, id, organizationId, directory, result, ids);
    const labelled = await client.from("analyses").update({ labelling_error: labellingError }).eq("id", id);
    if (labelled.error) throw labelled.error;
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
