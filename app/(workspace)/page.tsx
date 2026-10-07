import { auth } from "@clerk/nextjs/server";
import type { Database } from "@/lib/database.types";
import { createServerSupabaseClient } from "@/lib/supabase";

type AnalysisStatus = Database["public"]["Tables"]["analyses"]["Row"]["status"];

const statuses: AnalysisStatus[] = ["queued", "analyzing", "complete", "failed"];

const statusDisplay: Record<AnalysisStatus, { label: string; color: string }> = {
  queued: { label: "Queued", color: "text-muted" },
  analyzing: { label: "Analyzing", color: "text-outgoing" },
  complete: { label: "Complete", color: "text-incoming" },
  failed: { label: "Failed", color: "text-failed" },
};

function StatusIcon({ status }: { status: AnalysisStatus }) {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {status === "queued" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      )}
      {status === "analyzing" && (
        <>
          <path d="M20.5 9A9 9 0 0 0 4.7 6.2L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3.5 15A9 9 0 0 0 19.3 17.8L21 16" />
          <path d="M16 16h5v5" />
        </>
      )}
      {status === "complete" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16 9" />
        </>
      )}
      {status === "failed" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 6 6m0-6-6 6" />
        </>
      )}
    </svg>
  );
}

function StatusLabel({ status }: { status: AnalysisStatus }) {
  const display = statusDisplay[status];

  return (
    <span className={`inline-flex items-center gap-2 font-medium ${display.color}`}>
      <StatusIcon status={status} />
      {display.label}
    </span>
  );
}

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function WorkspacePage() {
  const { orgId, orgSlug } = await auth();
  const supabase = createServerSupabaseClient();
  const { data: analyses, error } = await supabase
    .from("analyses")
    .select("id, name, status, created_at, finished_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const statusCounts: Record<AnalysisStatus, number> = {
    queued: 0,
    analyzing: 0,
    complete: 0,
    failed: 0,
  };
  for (const analysis of analyses ?? []) {
    statusCounts[analysis.status] += 1;
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="text-xs text-muted">{orgSlug ?? orgId ?? "Workspace"}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Analyses</h1>
        </div>
        {!error && analyses && (
          <p className="pb-0.5 text-xs text-muted">
            {analyses.length === 50
              ? "Latest 50 runs"
              : `${analyses.length} ${analyses.length === 1 ? "run" : "runs"}`}
          </p>
        )}
      </div>

      {error ? (
        <p className="mt-4 border border-border bg-surface px-3 py-3 text-xs">
          Analyses could not be loaded: {error.message}
        </p>
      ) : analyses && analyses.length > 0 ? (
        <>
          <div className="mt-6">
            <p className="mb-2 text-xs text-muted">Status of runs shown</p>
            <ul className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
              {statuses.map((status) => (
                <li
                  key={status}
                  className="flex items-center justify-between gap-3 bg-surface px-4 py-3"
                >
                  <StatusLabel status={status} />
                  <span className="text-sm font-semibold tabular-nums">
                    {statusCounts[status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-5 overflow-x-auto border border-border bg-surface">
            <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-xs">
              <caption className="sr-only">Recent analyses and their status</caption>
              <colgroup>
                <col className="w-[39%]" />
                <col className="w-[17%]" />
                <col className="w-[22%]" />
                <col className="w-[22%]" />
              </colgroup>
              <thead className="border-b border-border text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium" scope="col">Analysis</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">Status</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">Started (UTC)</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">Finished (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {analyses.map((analysis) => (
                  <tr key={analysis.id} className="border-b border-border last:border-b-0">
                    <th className="px-4 py-4 font-medium" scope="row" title={analysis.name}>
                      <span className="block truncate">{analysis.name}</span>
                    </th>
                    <td className="whitespace-nowrap px-4 py-4">
                      <StatusLabel status={analysis.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 tabular-nums text-muted">
                      <time dateTime={analysis.created_at}>
                        {dateFormatter.format(new Date(analysis.created_at))}
                      </time>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 tabular-nums text-muted">
                      {analysis.finished_at ? (
                        <time dateTime={analysis.finished_at}>
                          {dateFormatter.format(new Date(analysis.finished_at))}
                        </time>
                      ) : (
                        <span aria-label="Not finished">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
