"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { compareAnalysis, removeComparison, type CompareState } from "@/app/actions/comparison";
import { PathList, type FileNavigationProps } from "@/components/canvas/path-list";
import type { ComparisonView } from "@/lib/canvas/comparison";
import type { Edge, ParserCoverage } from "@/lib/parser/types.mts";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

const STALE_AFTER = 5 * 60 * 1000;
const LIST_LIMIT = 200;

function Progress({ analysisId, comparison }: { analysisId: string; comparison: ComparisonView }) {
  const [progress, setProgress] = useState({ message: comparison.stageMessage, startedAt: comparison.stageStartedAt });
  const [now, setNow] = useState(() => Date.now());
  const { getToken } = useAuth();
  const router = useRouter();
  const client = useMemo(() => createBrowserSupabaseClient(() => getToken()), [getToken]);

  useEffect(() => {
    const channel = client.channel(`comparison:${analysisId}`, { config: { private: true } })
      .on("broadcast", { event: "progress" }, ({ payload }) => {
        if (payload.id !== analysisId || typeof payload.stage !== "string") return;
        setProgress({ message: String(payload.message), startedAt: String(payload.stage_started_at) });
        setNow(Date.now());
        if (payload.stage === "complete" || payload.stage === "failed") router.refresh();
      })
      // A run can finish before this subscription is live; one server read
      // once subscribed catches that. It isn't polling.
      .subscribe((status) => { if (status === "SUBSCRIBED") router.refresh(); });
    return () => { void client.removeChannel(channel); };
  }, [client, analysisId, router]);

  useEffect(() => {
    const due = new Date(progress.startedAt).getTime() + STALE_AFTER;
    if (due <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), due - now + 50);
    return () => clearTimeout(timer);
  }, [progress, now]);

  const stale = now - new Date(progress.startedAt).getTime() > STALE_AFTER;
  return <p className="mt-2 text-[11px] text-muted">{stale ? `No update for five minutes. Last: ${progress.message}` : progress.message}</p>;
}

function EdgeList({ edges, onSelectFile }: { edges: Edge[]; onSelectFile: (path: string) => void }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {edges.slice(0, LIST_LIMIT).map((edge) => (
        <li key={`${edge.from}\0${edge.to}`}>
          <button type="button" onClick={() => onSelectFile(edge.from)} title={`${edge.from} → ${edge.to}`}
            className="w-full cursor-pointer break-all px-1 py-0.5 text-left font-mono text-[10px] leading-4 hover:bg-accent/10 hover:text-accent">
            {edge.from} <span className="text-muted">→</span> {edge.to}
          </button>
        </li>
      ))}
      {edges.length > LIST_LIMIT && <li className="px-1 text-[10px] text-muted">and {edges.length - LIST_LIMIT} more</li>}
    </ul>
  );
}

function Section({ title, count, tone, children }: { title: string; count: number; tone?: string; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="border-b border-border px-4 py-3">
      <h3 className="text-[10px] uppercase tracking-wide text-muted">
        <span className={tone}>{title}</span> <span className="tabular-nums">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function CoverageSide({ label, coverage }: { label: string; coverage: ParserCoverage }) {
  const { skippedFiles, imports } = coverage;
  if (skippedFiles.length === 0 && imports.unresolvedExamples.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[11px] text-muted">{label}: why files and imports were left out</summary>
      <ul className="mt-1 space-y-0.5 font-mono text-[10px] leading-4 text-muted">
        {skippedFiles.slice(0, LIST_LIMIT).map((file) => <li key={`f:${file.path}`} className="break-all">{file.path} — {file.reason}</li>)}
        {skippedFiles.length > LIST_LIMIT && <li>and {skippedFiles.length - LIST_LIMIT} more skipped files</li>}
        {imports.unresolvedExamples.map((item, index) => (
          <li key={`i:${index}`} className="break-all">{item.from}: {item.specifier} — {item.status === "resolved" ? "resolved" : item.reason}</li>
        ))}
        {imports.unresolved > imports.unresolvedExamples.length &&
          <li>{imports.unresolvedExamples.length} of {imports.unresolved} unresolved imports listed</li>}
      </ul>
    </details>
  );
}

function CoverageRow({ label, before, after }: { label: string; before: number; after: number }) {
  return (
    <tr>
      <td className="py-0.5 pr-3 text-muted">{label}</td>
      <td className="py-0.5 pr-2 text-right tabular-nums">{before}</td>
      <td className="py-0.5 pr-2 text-muted">→</td>
      <td className="py-0.5 text-right tabular-nums">{after}</td>
    </tr>
  );
}

export function ComparisonPanel({
  analysisId, comparison, coverage, dimUnchanged, onDimUnchangedChange, nav,
}: {
  analysisId: string;
  comparison: ComparisonView | null;
  coverage: ParserCoverage;
  dimUnchanged: boolean;
  onDimUnchangedChange: (dim: boolean) => void;
  nav: FileNavigationProps;
}) {
  const [state, compare, pending] = useActionState<CompareState, FormData>(compareAnalysis.bind(null, analysisId), {});
  const running = comparison !== null && comparison.status !== "complete" && comparison.status !== "failed";
  const diff = comparison?.status === "complete" ? comparison.diff : null;

  return (
    <div className="min-w-0 text-[11px]">
      <form action={compare} className="border-b border-border px-4 py-3">
        <label htmlFor="comparison-ref" className="text-[10px] uppercase tracking-wide text-muted">Compare with a change</label>
        <div className="mt-2 flex gap-2">
          <input id="comparison-ref" name="ref" required maxLength={300} placeholder="branch, commit SHA, #12 or pull request URL"
            className="min-w-0 flex-1 border border-border bg-background px-2 py-1 font-mono text-[11px]" />
          <button type="submit" disabled={pending}
            className="cursor-pointer border border-border px-2 py-1 hover:bg-background disabled:cursor-default disabled:opacity-50">
            {pending ? "Starting" : "Compare"}
          </button>
        </div>
        {state.error && <p role="alert" className="mt-2 text-failed">{state.error}</p>}
        {!comparison && <p className="mt-2 text-muted">This analysis is the before. The after is parsed the same way, and only what the parser found differs.</p>}
      </form>

      {comparison && (
        <div className="border-b border-border px-4 py-3">
          <p className="font-mono">
            <span className="text-muted">{comparison.baseSha.slice(0, 12)}</span>
            {" → "}
            {comparison.afterSha ? comparison.afterSha.slice(0, 12) : "…"}
            <span className="text-muted"> ({comparison.ref})</span>
          </p>
          {running && <Progress key={`${comparison.stage}:${comparison.stageStartedAt}`} analysisId={analysisId} comparison={comparison} />}
          {comparison.status === "failed" && <p role="alert" className="mt-2 text-failed">{comparison.errorMessage ?? comparison.stageMessage}</p>}
          {diff && (
            <>
              <p className="mt-2 tabular-nums">
                <span className="text-added">+{diff.added.length}</span>{" "}
                <span className="text-removed">−{diff.removed.length}</span>{" "}
                ~{diff.changed.length} files ·{" "}
                <span className="text-added">+{diff.addedEdges.length}</span>{" "}
                <span className="text-removed">−{diff.removedEdges.length}</span> imports
              </p>
              <label className="mt-2 flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={dimUnchanged} onChange={(event) => onDimUnchangedChange(event.target.checked)} />
                Dim everything unchanged
              </label>
            </>
          )}
          <form action={removeComparison.bind(null, analysisId)} className="mt-2">
            <button type="submit" className="cursor-pointer text-muted hover:text-foreground">Remove comparison</button>
          </form>
        </div>
      )}

      {diff && (
        <>
          <Section title="Added files" count={diff.added.length} tone="text-added">
            <PathList {...nav} paths={diff.added.slice(0, LIST_LIMIT).map((file) => file.path)} />
          </Section>
          <Section title="Removed files" count={diff.removed.length} tone="text-removed">
            <PathList {...nav} paths={diff.removed.slice(0, LIST_LIMIT)} />
          </Section>
          <Section title="Changed files" count={diff.changed.length}>
            <PathList {...nav} paths={diff.changed.slice(0, LIST_LIMIT)} />
          </Section>
          <Section title="Added imports" count={diff.addedEdges.length} tone="text-added">
            <EdgeList edges={diff.addedEdges} onSelectFile={nav.onSelectFile} />
          </Section>
          <Section title="Removed imports" count={diff.removedEdges.length} tone="text-removed">
            <EdgeList edges={diff.removedEdges} onSelectFile={nav.onSelectFile} />
          </Section>
          <Section title="Not parsed on the after side" count={diff.unparsed.length}>
            <p className="mt-1 text-muted">Found but not read, so not reported as removed.</p>
            <ul className="mt-1 space-y-0.5 font-mono text-[10px] leading-4">
              {diff.unparsed.slice(0, LIST_LIMIT).map((file) => (
                <li key={file.path}>
                  <button type="button" onClick={() => nav.onSelectFile(file.path)} title={file.detail}
                    className="w-full cursor-pointer break-all px-1 py-0.5 text-left hover:bg-accent/10 hover:text-accent">
                    {file.path} <span className="text-muted">— {file.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
          {comparison?.afterCoverage && (
            <section className="px-4 py-3">
              <h3 className="text-[10px] uppercase tracking-wide text-muted">Coverage</h3>
              <table className="mt-1">
                <tbody>
                  <CoverageRow label="Files parsed" before={coverage.filesParsed} after={comparison.afterCoverage.filesParsed} />
                  <CoverageRow label="Files skipped" before={coverage.filesSkipped} after={comparison.afterCoverage.filesSkipped} />
                  <CoverageRow label="Imports resolved" before={coverage.imports.resolved} after={comparison.afterCoverage.imports.resolved} />
                  <CoverageRow label="Imports unresolved" before={coverage.imports.unresolved} after={comparison.afterCoverage.imports.unresolved} />
                </tbody>
              </table>
              <CoverageSide label="Before" coverage={coverage} />
              <CoverageSide label="After" coverage={comparison.afterCoverage} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
