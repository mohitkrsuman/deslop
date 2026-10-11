import { auth } from "@clerk/nextjs/server";
import { AnalysisForm } from "@/components/analysis-form";
import { AnalysisList } from "@/components/analysis-list";
import { ModelKeySettings } from "@/components/model-key-settings";
import { MODELS, PROVIDER_LABELS, isProvider } from "@/lib/ai/client";
import { createServerSupabaseClient } from "@/lib/supabase";

export const maxDuration = 900;

export default async function WorkspacePage() {
  const { orgId, orgSlug, orgRole } = await auth();
  const supabase = createServerSupabaseClient();
  const [{ data, error }, { data: key }] = await Promise.all([
    supabase.from("analyses")
      .select("id,name,status,stage,stage_message,stage_started_at,created_at,finished_at")
      .order("created_at", { ascending: false }).limit(50),
    supabase.from("model_keys").select("provider,last_four").maybeSingle(),
  ]);
  const stored = key && isProvider(key.provider) ? { provider: key.provider, lastFour: key.last_four } : null;
  return <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
    <div className="border-b border-border pb-4">
      <p className="text-xs text-muted">{orgSlug ?? orgId ?? "Workspace"}</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Analyses</h1>
    </div>
    <AnalysisForm />
    <ModelKeySettings stored={stored} canEdit={orgRole === "org:admin"} labels={PROVIDER_LABELS} models={MODELS} />
    {error ? <p className="mt-5 border border-border bg-surface p-4 text-xs" role="alert">Could not load analyses: {error.message}</p> :
      <AnalysisList initial={data ?? []} orgId={orgId ?? ""} canDelete={orgRole === "org:admin"} />}
  </section>;
}
