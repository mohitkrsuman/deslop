import { auth } from "@clerk/nextjs/server";
import { AnalysisForm } from "@/components/analysis-form";
import { AnalysisList } from "@/components/analysis-list";
import { createServerSupabaseClient } from "@/lib/supabase";

export const maxDuration = 900;

export default async function WorkspacePage() {
  const { orgId, orgSlug, orgRole } = await auth();
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("analyses")
    .select("id,name,status,stage,stage_message,stage_started_at,created_at,finished_at")
    .order("created_at", { ascending: false }).limit(50);
  return <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
    <div className="border-b border-border pb-4">
      <p className="text-xs text-muted">{orgSlug ?? orgId ?? "Workspace"}</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Analyses</h1>
    </div>
    <AnalysisForm />
    {error ? <p className="mt-5 border border-border bg-surface p-4 text-xs" role="alert">Could not load analyses: {error.message}</p> :
      <AnalysisList initial={data ?? []} orgId={orgId ?? ""} canDelete={orgRole === "org:admin"} />}
  </section>;
}
