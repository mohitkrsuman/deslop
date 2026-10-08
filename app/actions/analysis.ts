"use server";

import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { parseGithubUrl } from "@/lib/github-archive";
import { createWorkerClient, runAnalysis } from "@/lib/pipeline";

export type SubmitAnalysisState = { error?: string };

export async function submitAnalysis(_previous: SubmitAnalysisState, form: FormData): Promise<SubmitAnalysisState> {
  const { orgId, userId } = await auth();
  if (!orgId || !userId) return { error: "Choose an organization before analyzing a repository." };
  let repository: ReturnType<typeof parseGithubUrl>;
  try { repository = parseGithubUrl(String(form.get("repository_url") ?? "")); }
  catch (error) { return { error: (error as Error).message }; }

  let id: string;
  try {
    const client = createWorkerClient();
    const projectResult = await client.from("projects").upsert({
      organization_id: orgId, name: repository.name, repository_url: repository.url,
    }, { onConflict: "organization_id,repository_url" }).select("id").single();
    if (projectResult.error || !projectResult.data) throw projectResult.error ?? new Error("Could not create project.");
    const projectId = projectResult.data.id as string;
    const existing = await client.from("analyses").select("id")
      .eq("organization_id", orgId).eq("project_id", projectId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      id = existing.data.id as string;
    } else {
      const inserted = await client.from("analyses").insert({
        organization_id: orgId, project_id: projectId, name: repository.name,
        status: "queued", stage: "queued", stage_message: "Waiting to start",
      }).select("id").single();
      if (inserted.error) {
        // A concurrent submit can win the unique project constraint.
        const winner = await client.from("analyses").select("id")
          .eq("organization_id", orgId).eq("project_id", projectId).single();
        if (winner.error || !winner.data) throw inserted.error;
        id = winner.data.id as string;
      } else {
        id = inserted.data.id as string;
        after(() => runAnalysis(id, orgId, repository.url));
      }
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not start the analysis." };
  }
  redirect(`/analysis/${id}`);
}

export async function rerunAnalysis(id: string): Promise<void> {
  const { orgId, userId } = await auth();
  if (!orgId || !userId) throw new Error("Choose an organization first.");
  const client = createWorkerClient();
  const lookup = await client.from("analyses")
    .select("id,status,stage_started_at,projects(repository_url)")
    .eq("id", id).eq("organization_id", orgId).single();
  if (lookup.error || !lookup.data) throw new Error("Analysis not found.");
  const row = lookup.data;
  const stale = row.status !== "complete" && row.status !== "failed" &&
    Date.now() - new Date(row.stage_started_at as string).getTime() > 5 * 60 * 1000;
  if (row.status !== "complete" && row.status !== "failed" && !stale) {
    redirect(`/analysis/${id}`);
  }
  const project = row.projects as unknown as { repository_url: string } | null;
  if (!project?.repository_url) throw new Error("Repository URL is missing.");
  const reset = await client.from("analyses").update({
    status: "queued", stage: "queued", stage_message: "Waiting to restart",
    stage_started_at: new Date().toISOString(), finished_at: null,
    error_message: null, failed_stage: null,
  }).eq("id", id).eq("organization_id", orgId);
  if (reset.error) throw reset.error;
  after(() => runAnalysis(id, orgId, project.repository_url));
  redirect(`/analysis/${id}`);
}
