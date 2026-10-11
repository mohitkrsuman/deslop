"use server";

import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { runComparison } from "@/lib/comparison-pipeline";
import { createWorkerClient } from "@/lib/supabase-worker";

export type CompareState = { error?: string };

export async function compareAnalysis(analysisId: string, _previous: CompareState, form: FormData): Promise<CompareState> {
  const { orgId, userId } = await auth();
  if (!orgId || !userId) return { error: "Choose an organization first." };
  const ref = String(form.get("ref") ?? "").trim();
  if (!ref) return { error: "Name a branch, commit or pull request to compare with." };
  if (ref.length > 300) return { error: "That name is too long." };

  const client = createWorkerClient();
  const lookup = await client.from("analyses").select("status,commit_sha,projects(repository_url)")
    .eq("id", analysisId).eq("organization_id", orgId).maybeSingle();
  if (lookup.error) return { error: "Could not read this analysis." };
  if (!lookup.data) return { error: "This analysis was not found in your organization." };
  const project = lookup.data.projects as unknown as { repository_url: string } | null;
  if (lookup.data.status !== "complete" || !lookup.data.commit_sha || !project?.repository_url) {
    return { error: "Only a complete analysis can be compared." };
  }

  // A new run id takes the row over from any comparison still running.
  const runId = randomUUID();
  const { error } = await client.from("comparisons").upsert({
    organization_id: orgId, analysis_id: analysisId, run_id: runId, ref, base_sha: lookup.data.commit_sha,
    after_sha: null, status: "queued", stage: "queued", stage_message: "Waiting to start",
    stage_started_at: new Date().toISOString(), finished_at: null, error_message: null,
    after_adapter: null, after_coverage: null, diff: null,
  }, { onConflict: "analysis_id" });
  if (error) return { error: "Could not start the comparison." };
  const run = { analysisId, organizationId: orgId, runId, repositoryUrl: project.repository_url, ref, baseSha: lookup.data.commit_sha };
  after(() => runComparison(run));
  redirect(`/analysis/${analysisId}`);
}

export async function removeComparison(analysisId: string): Promise<void> {
  const { orgId, userId } = await auth();
  if (!orgId || !userId) throw new Error("Choose an organization first.");
  const { error } = await createWorkerClient().from("comparisons").delete()
    .eq("analysis_id", analysisId).eq("organization_id", orgId);
  if (error) throw new Error("Could not remove the comparison.");
  redirect(`/analysis/${analysisId}`);
}
