"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

export type AnalysisSummary = {
  id: string; name: string; status: string; stage: string; stage_message: string;
  stage_started_at: string; created_at: string; finished_at: string | null;
};

const formatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const staleAfter = 5 * 60 * 1000;

export function AnalysisList({ initial, orgId }: { initial: AnalysisSummary[]; orgId: string }) {
  const [updates, setUpdates] = useState<Record<string, Partial<AnalysisSummary>>>({});
  const [now, setNow] = useState(() => Date.now());
  const { getToken } = useAuth();
  const router = useRouter();
  const client = useMemo(() => createBrowserSupabaseClient(() => getToken()), [getToken]);
  const rows = initial.map((row) => ({ ...row, ...updates[row.id] }));

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
    <div className="mt-5 overflow-x-auto border border-border bg-surface">
      <table className="w-full min-w-[680px] text-left text-xs">
        <caption className="sr-only">Repository analyses</caption>
        <thead className="border-b border-border text-muted"><tr>
          <th className="px-4 py-3 font-medium">Repository</th><th className="px-4 py-3 font-medium">Progress</th>
          <th className="px-4 py-3 font-medium">Started (UTC)</th><th className="px-4 py-3 font-medium">Finished (UTC)</th>
        </tr></thead>
        <tbody>{rows.map((row) => {
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
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}
