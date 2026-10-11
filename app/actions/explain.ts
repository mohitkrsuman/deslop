"use server";

import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { userModelCache } from "@/lib/ai/cache";
import { explainFile, explainFolder, fileExplainInput, folderExplainInput } from "@/lib/ai/explain";
import { modelFor } from "@/lib/ai/keys";
import { loadAnalysisGraph } from "@/lib/analysis-graph";
import { foldDirectories } from "@/lib/canvas/fold";
import { fetchFileAtCommit, fetchHeadCommit, parseGithubUrl } from "@/lib/github-archive";
import { githubTokenForAnalysis } from "@/lib/github-token";
import { createServerSupabaseClient } from "@/lib/supabase";

export type ExplainResult =
  | { ok: true; text: string; notes: string[]; cached: boolean; model: string; keySource: "organization" | "app" }
  | { ok: false; error: string };

export type Freshness =
  | { state: "current" }
  // The repository moved past the analysed commit; this file is the same.
  | { state: "moved"; head: string }
  | { state: "changed"; head: string }
  | { state: "removed"; head: string }
  | { state: "unknown"; reason: string };

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : typeof cause === "object" && cause && "message" in cause ? String(cause.message) : String(cause);
}

// Everything is read through the signed-in user's client, so an analysis from
// another organization is simply not found.
async function loadContext(analysisId: string) {
  const { orgId, userId } = await auth();
  if (!orgId || !userId) throw new Error("Choose an organization first.");
  const client = createServerSupabaseClient();
  const { data: analysis, error } = await client.from("analyses")
    .select("id,name,adapter,commit_sha,project_id,organization_id,private").eq("id", analysisId).maybeSingle();
  if (error) throw error;
  if (!analysis) throw new Error("Analysis not found.");
  if (!analysis.commit_sha) throw new Error("This analysis has no recorded commit. Run it again.");
  const { data: project, error: projectError } = await client.from("projects")
    .select("repository_url").eq("id", analysis.project_id).maybeSingle();
  if (projectError) throw projectError;
  if (!project) throw new Error("Project not found.");
  return {
    client,
    organizationId: analysis.organization_id,
    isPrivate: analysis.private,
    analysis: { name: analysis.name, adapter: analysis.adapter ?? "fallback", repositoryUrl: project.repository_url, commitSha: analysis.commit_sha },
  };
}

export async function requestFileExplanation(analysisId: string, path: string): Promise<ExplainResult> {
  try {
    const { client, organizationId, isPrivate, analysis } = await loadContext(analysisId);
    const graph = await loadAnalysisGraph(client, analysisId, analysis.adapter);
    const file = graph.files.find((item) => item.path === path);
    if (!file) return { ok: false, error: `${path} is not in this analysis.` };
    const input = fileExplainInput(analysis, graph.files, graph.edges, file);
    const choice = await modelFor(organizationId);
    const token = await githubTokenForAnalysis(organizationId, isPrivate);
    const { output, cached } = await explainFile(input, userModelCache(client, organizationId), choice, token);
    return { ok: true, text: output.text, notes: output.notes, cached, model: choice.model, keySource: choice.source };
  } catch (cause) {
    return { ok: false, error: messageOf(cause) };
  }
}

export async function requestFolderExplanation(analysisId: string, folder: string): Promise<ExplainResult> {
  try {
    const { client, organizationId, analysis } = await loadContext(analysisId);
    const graph = await loadAnalysisGraph(client, analysisId, analysis.adapter);
    const folding = foldDirectories(graph.files);
    const group = folding.groups.find((item) => item.folder === folder);
    if (!group) return { ok: false, error: `${folder} is not a folder on this map.` };
    const input = folderExplainInput(analysis, graph.files, graph.edges, folding, group.folder, group.files);
    const choice = await modelFor(organizationId);
    const { output, cached } = await explainFolder(input, userModelCache(client, organizationId), choice);
    return { ok: true, text: output.text, notes: output.notes, cached, model: choice.model, keySource: choice.source };
  } catch (cause) {
    return { ok: false, error: messageOf(cause) };
  }
}

// Compares the analysed commit with the repository now. For a file, its stored
// content hash is checked against the file at the current head.
export async function checkFreshness(analysisId: string, path: string | null): Promise<Freshness> {
  try {
    const { client, organizationId, isPrivate, analysis } = await loadContext(analysisId);
    const repository = parseGithubUrl(analysis.repositoryUrl);
    const token = await githubTokenForAnalysis(organizationId, isPrivate);
    const head = await fetchHeadCommit(repository, token);
    if (head === analysis.commitSha) return { state: "current" };
    if (path === null) return { state: "moved", head };
    const { data: file, error } = await client.from("files").select("sha256")
      .eq("analysis_id", analysisId).eq("path", path).maybeSingle();
    if (error) throw error;
    if (!file?.sha256) return { state: "unknown", reason: "No content hash was stored for this file." };
    const bytes = await fetchFileAtCommit(repository, head, path, token);
    if (!bytes) return { state: "removed", head };
    const current = createHash("sha256").update(bytes).digest("hex");
    return current === file.sha256 ? { state: "moved", head } : { state: "changed", head };
  } catch (cause) {
    return { state: "unknown", reason: messageOf(cause) };
  }
}
