import { auth } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase";

const statusLabels = {
  queued: "Queued",
  analyzing: "Analyzing",
  complete: "Complete",
  failed: "Failed",
} as const;

const statusClasses = {
  queued: "text-muted",
  analyzing: "text-outgoing",
  complete: "text-incoming",
  failed: "text-foreground",
} as const;

export default async function WorkspacePage() {
  const { orgId, orgSlug } = await auth();
  const supabase = createServerSupabaseClient();
  const { data: analyses, error } = await supabase
    .from("analyses")
    .select("id, name, status, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <section className="mx-auto w-full max-w-5xl px-3 py-6">
      <div className="flex items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <p className="text-xs text-muted">{orgSlug ?? orgId ?? "Workspace"}</p>
          <h1 className="mt-1 text-lg font-medium tracking-tight">Analyses</h1>
        </div>
        <p className="text-xs text-muted">{analyses?.length ?? 0} runs</p>
      </div>

      {error ? (
        <p className="mt-4 border border-border bg-surface px-3 py-3 text-xs">
          Analyses could not be loaded: {error.message}
        </p>
      ) : analyses && analyses.length > 0 ? (
        <div className="mt-4 overflow-hidden border border-border bg-surface">
          <div className="grid grid-cols-[minmax(0,1fr)_8rem_10rem] gap-3 border-b border-border px-3 py-2 text-[11px] uppercase tracking-wide text-muted">
            <span>Analysis</span>
            <span>State</span>
            <span>Started</span>
          </div>
          <ul>
            {analyses.map((analysis) => (
              <li
                key={analysis.id}
                className="grid grid-cols-[minmax(0,1fr)_8rem_10rem] gap-3 border-b border-border px-3 py-3 text-xs last:border-b-0"
              >
                <span className="truncate font-mono">{analysis.name}</span>
                <span className={statusClasses[analysis.status]}>
                  {statusLabels[analysis.status]}
                </span>
                <time dateTime={analysis.created_at} className="text-muted">
                  {new Date(analysis.created_at).toLocaleDateString("en", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-4 border border-dashed border-border px-3 py-8 text-center">
          <p className="text-sm">No analyses yet.</p>
          <p className="mt-1 text-xs text-muted">
            Analyses run by this organization will appear here.
          </p>
        </div>
      )}
    </section>
  );
}
