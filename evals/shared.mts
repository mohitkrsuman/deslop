import "../scripts/load-env.mts";

import { Client, type Example } from "langsmith";
import type { KVMap } from "langsmith/schemas";
import type { ModelCache } from "../lib/ai/client.ts";
import { tracingStatus } from "../lib/ai/client.ts";
import { loadAnalysisGraph, type AnalysisGraph } from "../lib/analysis-graph.ts";
import { createWorkerClient } from "../lib/supabase-worker.ts";

// Evals write datasets and experiments to LangSmith; without it there is
// nothing to look at, so they refuse to run rather than score into the void.
export function langsmith(): Client {
  const status = tracingStatus();
  if (!status.enabled) throw new Error(`Evals need LangSmith: ${status.reason}.`);
  return new Client();
}

export function projectName(): string {
  return process.env.LANGSMITH_PROJECT?.trim() || "default";
}

// Evals measure the model, so they never answer from the cache.
export const NO_CACHE: ModelCache = {
  read: async () => undefined,
  write: async () => {},
};

export interface StoredAnalysis {
  id: string;
  name: string;
  adapter: string;
  commitSha: string;
  repositoryUrl: string;
}

// Every finished analysis, across organizations: datasets are built by an
// operator from the server side, not by a signed-in user.
export async function finishedAnalyses(): Promise<StoredAnalysis[]> {
  const client = createWorkerClient();
  const { data, error } = await client.from("analyses")
    .select("id,name,adapter,commit_sha,projects(repository_url)")
    .eq("status", "complete").not("commit_sha", "is", null).order("created_at").limit(50);
  if (error) throw error;
  const rows: StoredAnalysis[] = [];
  for (const row of data ?? []) {
    const project: unknown = row.projects;
    const url = typeof project === "object" && project !== null && "repository_url" in project ? project.repository_url : null;
    if (typeof row.commit_sha !== "string" || typeof url !== "string") continue;
    rows.push({ id: String(row.id), name: String(row.name), adapter: typeof row.adapter === "string" ? row.adapter : "fallback", commitSha: row.commit_sha, repositoryUrl: url });
  }
  return rows;
}

export function graphOf(analysis: StoredAnalysis): Promise<AnalysisGraph> {
  return loadAnalysisGraph(createWorkerClient(), analysis.id, analysis.adapter);
}

export interface DatasetExample {
  inputs: KVMap;
  outputs?: KVMap;
  metadata?: KVMap;
}

// A dataset is built once and reused, so experiments run on different days
// still compare like with like. --rebuild replaces it.
export async function ensureDataset(
  client: Client, name: string, description: string, rebuild: boolean, build: () => Promise<DatasetExample[]>,
): Promise<Example[]> {
  const exists = await client.hasDataset({ datasetName: name });
  if (exists && !rebuild) {
    const examples: Example[] = [];
    for await (const example of client.listExamples({ datasetName: name })) examples.push(example);
    console.log(`Using dataset "${name}" (${examples.length} examples). Pass --rebuild to replace it.`);
    return examples;
  }
  // Built before anything is deleted, so a failed rebuild keeps the old dataset.
  const built = await build();
  if (exists) await client.deleteDataset({ datasetName: name });
  const dataset = await client.createDataset(name, { description });
  await client.createExamples(built.map((example) => ({ ...example, dataset_id: dataset.id })));
  const examples: Example[] = [];
  for await (const example of client.listExamples({ datasetId: dataset.id })) examples.push(example);
  console.log(`Built dataset "${name}" (${examples.length} examples).`);
  return examples;
}

export function flag(name: string): boolean {
  return process.argv.includes(name);
}

export function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function percent(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${(part / whole * 100).toFixed(1)}%`;
}
