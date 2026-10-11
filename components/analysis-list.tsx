"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AnalysisSettingsButton } from "@/components/analysis-settings-button";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

export type AnalysisSummary = {
  id: string; name: string; status: string; stage: string; stage_message: string;
  stage_started_at: string; created_at: string; finished_at: string | null;
};

const formatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const staleAfter = 5 * 60 * 1000;
const pageSize = 5;

export function AnalysisList({ initial, orgId, canDelete }: { initial: AnalysisSummary[]; orgId: string; canDelete: boolean }) {
  const [updates, setUpdates] = useState<Record<string, Partial<AnalysisSummary>>>({});
  const [now, setNow] = useState(() => Date.now());
  const [requestedPage, setPage] = useState(0);
  const { getToken } = useAuth();
  const router = useRouter();
  const client = useMemo(() => createBrowserSupabaseClient(() => getToken()), [getToken]);
  const rows = initial.map((row) => ({ ...row, ...updates[row.id] }));
  const pageCount = Math.ceil(rows.length / pageSize);
  // Clamped at render time: a delete can shrink the list under the current page.
  const page = Math.min(requestedPage, Math.max(0, pageCount - 1));
  const visibleRows = rows.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => {
    const channel = client.channel(`analyses:org:${orgId}`, { config: { private: true } })
      .on("broadcast", { event: "progress" }, ({ payload }) => {
        if (typeof payload.id !== "string" || typeof payload.stage !== "string") return;
        setUpdates((current) => ({ ...current, [payload.id]: {
          status: String(payload.status), stage: String(payload.stage),
          stage_message: String(payload.message), stage_started_at: String(payload.stage_started_at),
        } }));
        setNow(Date.now());
        if (!initial.some((row) => row.id === payload.id) || payload.stage === "complete" || payload.stage === "failed") router.refresh();
      }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, orgId, initial, router]);

  useEffect(() => {
    const next = rows.filter((row) => row.status !== "complete" && row.status !== "failed")
      .map((row) => new Date(row.stage_started_at).getTime() + staleAfter)
      .filter((time) => time > now).sort((a, b) => a - b)[0];
    if (!next) return;
    const timer = setTimeout(() => setNow(Date.now()), next - now + 50);
    return () => clearTimeout(timer);
  }, [rows, now]);

  if (rows.length === 0) return <div className="mt-5 border border-dashed border-border px-4 py-8 text-center text-sm">No analyses yet.</div>;
  return (
    <div className="mt-5 border border-border bg-surface">
      <div className="analysis-list-scroll overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <caption className="sr-only">Repository analyses</caption>
          <thead className="border-b border-border text-muted"><tr>
            <th className="px-4 py-3 font-medium">Repository</th><th className="px-4 py-3 font-medium">Progress</th>
            <th className="px-4 py-3 font-medium">Started (UTC)</th><th className="px-4 py-3 font-medium">Finished (UTC)</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr></thead>
          <tbody>{visibleRows.map((row, index) => {
            const stale = row.status !== "complete" && row.status !== "failed" && now - new Date(row.stage_started_at).getTime() > staleAfter;
            return <tr key={row.id} className="border-b border-border last:border-0">
              <th className="px-4 py-4 font-medium"><Link href={`/analysis/${row.id}`} className="hover:underline">{row.name}</Link></th>
              <td className="px-4 py-4"><Link href={`/analysis/${row.id}`} className="hover:underline">
                <span className={row.status === "failed" ? "text-failed" : row.status === "complete" ? "text-incoming" : "text-outgoing"}>
                  {stale ? "Stale" : row.stage.charAt(0).toUpperCase() + row.stage.slice(1)}
                </span>
                <span className="mt-1 block text-muted">{stale ? `Last update: ${row.stage_message}` : row.stage_message}</span>
              </Link></td>
              <td className="px-4 py-4 tabular-nums text-muted">{formatter.format(new Date(row.created_at))}</td>
              <td className="px-4 py-4 tabular-nums text-muted">{row.finished_at ? formatter.format(new Date(row.finished_at)) : "—"}</td>
              <td className="px-4 py-3 text-right"><AnalysisSettingsButton analysisId={row.id} projectName={row.name}
                canDelete={canDelete} preferAbove={index === visibleRows.length - 1} /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs">
        <span className="text-muted">Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, rows.length)} of {rows.length}</span>
        {pageCount > 1 && <nav aria-label="Analysis pages" className="flex items-center gap-2">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}
            className="border border-border px-2.5 py-1.5 hover:bg-background disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
          <span aria-live="polite" className="min-w-16 text-center text-muted">{page + 1} / {pageCount}</span>
          <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}
            className="border border-border px-2.5 py-1.5 hover:bg-background disabled:cursor-not-allowed disabled:opacity-40">Next</button>
        </nav>}
      </div>
    </div>
  );
}
