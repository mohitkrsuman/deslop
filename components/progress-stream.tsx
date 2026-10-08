"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

const stages = ["fetching", "selecting", "parsing", "storing", "complete"];
const labels: Record<string, string> = {
  fetching: "Fetch archive", selecting: "Select files", parsing: "Parse dependencies",
  storing: "Store map", complete: "Map ready",
};

export function ProgressStream({ id, initial }: {
  id: string;
  initial: { stage: string; message: string; stageStartedAt: string; status: string };
}) {
  const [progress, setProgress] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const { getToken } = useAuth();
  const router = useRouter();
  const client = useMemo(() => createBrowserSupabaseClient(() => getToken()), [getToken]);

  useEffect(() => {
    const channel = client.channel(`analysis:${id}`, { config: { private: true } })
      .on("broadcast", { event: "progress" }, ({ payload }) => {
        if (payload.id !== id || typeof payload.stage !== "string") return;
        setProgress({ stage: payload.stage, message: String(payload.message),
          stageStartedAt: String(payload.stage_started_at), status: String(payload.status) });
        setNow(Date.now());
        if (payload.stage === "complete") router.refresh();
      }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, id, router]);

  useEffect(() => {
    if (progress.status === "complete" || progress.status === "failed") return;
    const due = new Date(progress.stageStartedAt).getTime() + 5 * 60 * 1000;
    if (due > now) {
      const timer = setTimeout(() => setNow(Date.now()), due - now + 50);
      return () => clearTimeout(timer);
    }
  }, [progress, now]);

  const stale = progress.status !== "complete" && progress.status !== "failed" &&
    now - new Date(progress.stageStartedAt).getTime() > 5 * 60 * 1000;
  const index = stages.indexOf(progress.stage);
  return <div className="mx-auto max-w-xl border border-border bg-surface p-6">
    <p className="text-xs uppercase tracking-widest text-muted">Live progress</p>
    <h2 className="mt-2 text-lg font-semibold">{stale ? "Run appears stale" : progress.stage === "failed" ? "Analysis failed" : progress.message}</h2>
    {stale && <p className="mt-2 text-sm text-muted">No stage update for over five minutes. Last stage: {progress.stage}.</p>}
    {progress.stage === "failed" && <p role="alert" className="mt-2 text-sm text-failed">{progress.message}</p>}
    <ol className="mt-6 space-y-3">{stages.map((stage, position) => <li key={stage} className="flex items-center gap-3 text-sm">
      <span aria-hidden="true" className={`flex size-6 items-center justify-center rounded-full border ${position < index ? "border-incoming text-incoming" : position === index ? "border-outgoing text-outgoing" : "border-border text-muted"}`}>
        {position < index ? "✓" : position + 1}
      </span>
      <span className={position > index ? "text-muted" : ""}>{labels[stage]}</span>
    </li>)}</ol>
  </div>;
}
