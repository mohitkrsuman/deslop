import "server-only";

import { rm } from "node:fs/promises";
import { readAll } from "@/lib/analysis-graph";
import { fetchArchiveAt, parseGithubUrl, resolveRef } from "@/lib/github-archive";
import { githubTokenFor } from "@/lib/github-token";
import { compareMaps } from "@/lib/graph/compare";
import { FRAMEWORK_ADAPTERS } from "@/lib/parser/adapters/index.mts";
import { parseRepository } from "@/lib/parser/parse.mts";
import type { Edge, ImportKind } from "@/lib/parser/types.mts";
import { createWorkerClient } from "@/lib/supabase-worker";

type ComparisonStage = "resolving" | "fetching" | "parsing" | "comparing" | "complete" | "failed";

export interface ComparisonRun {
  analysisId: string;
  organizationId: string;
  runId: string;
  repositoryUrl: string;
  ref: string;
  baseSha: string;
}

// The base side as stored, read with the server key, so every read names the
// organization as well as the analysis.
async function loadBase(client: ReturnType<typeof createWorkerClient>, run: ComparisonRun) {
  const [fileRows, edgeRows] = await Promise.all([
    readAll<{ id: string; path: string; sha256: string | null }>((from, to) => client.from("files").select("id,path,sha256")
      .eq("organization_id", run.organizationId).eq("analysis_id", run.analysisId).order("id").range(from, to)),
    readAll<{ source_file_id: string; target_file_id: string; kind: string }>((from, to) => client.from("edges")
      .select("source_file_id,target_file_id,kind")
      .eq("organization_id", run.organizationId).eq("analysis_id", run.analysisId).order("id").range(from, to)),
  ]);
  const pathOf = new Map(fileRows.map((row) => [row.id, row.path]));
  const edges: Edge[] = edgeRows.flatMap((row) => {
    const from = pathOf.get(row.source_file_id);
    const to = pathOf.get(row.target_file_id);
    return from && to ? [{ from, to, kind: row.kind as ImportKind }] : [];
  });
  return { files: fileRows.map((row) => ({ path: row.path, sha256: row.sha256 ?? "" })), edges };
}

export async function runComparison(run: ComparisonRun) {
  const client = createWorkerClient();
  // Every write names the run, so a comparison started after this one owns
  // the row and this one's late writes land nowhere.
  const update = async (fields: Record<string, unknown>) => {
    const { error } = await client.from("comparisons").update(fields)
      .eq("analysis_id", run.analysisId).eq("organization_id", run.organizationId).eq("run_id", run.runId);
    if (error) throw error;
  };
  const stage = (value: ComparisonStage, message: string) => update({
    stage: value, stage_message: message, stage_started_at: new Date().toISOString(),
    status: value === "complete" ? "complete" : value === "failed" ? "failed" : "analyzing",
  });

  let currentStage: ComparisonStage = "resolving";
  let directory: string | undefined;
  try {
    await stage(currentStage, `Resolving ${run.ref}`);
    const repository = parseGithubUrl(run.repositoryUrl);
    const token = await githubTokenFor(run.organizationId);
    const after = await resolveRef(repository, run.ref, token);
    await update({ after_sha: after.sha });

    currentStage = "fetching";
    await stage(currentStage, `Fetching ${after.sha.slice(0, 12)}`);
    directory = await fetchArchiveAt(repository, after.sha, token);

    currentStage = "parsing";
    await stage(currentStage, "Parsing imports and dependencies");
    const result = await parseRepository(directory, FRAMEWORK_ADAPTERS);

    currentStage = "comparing";
    await stage(currentStage, "Comparing with the analysis");
    const analysis = await client.from("analyses").select("commit_sha")
      .eq("id", run.analysisId).eq("organization_id", run.organizationId).maybeSingle();
    if (analysis.error) throw analysis.error;
    if (analysis.data?.commit_sha !== run.baseSha) throw new Error("The analysis was run again while comparing, so its before no longer exists.");
    const diff = compareMaps(await loadBase(client, run), result);

    await update({
      diff, after_adapter: result.adapter, after_coverage: result.coverage,
      stage: "complete", stage_message: "Comparison ready", status: "complete",
      stage_started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    try {
      await update({
        stage: "failed", stage_message: `Failed during ${currentStage}: ${message}`, status: "failed",
        error_message: message, stage_started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Could not record comparison failure", run.analysisId, error);
    }
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
