"use client";

import { useMemo } from "react";
import type { ExplainResult, Freshness } from "@/app/actions/explain";
import type { TracingStatus } from "@/lib/ai/client";
import type { DetailIndex } from "@/lib/canvas/details";
import type { Folding } from "@/lib/canvas/fold";
import { parseExplanation, type Inline, type PathKind } from "@/lib/canvas/markup";
import type { HoverTarget } from "@/lib/canvas/selection";

export type ExplanationEntry =
  | { status: "loading" }
  | { status: "done"; result: ExplainResult };

export interface ExplanationNavigation {
  folding: Folding;
  index: DetailIndex;
  hovered: HoverTarget;
  onSelectFile: (path: string) => void;
  onSelectFolder: (folder: string) => void;
  onHoverChange: (target: HoverTarget) => void;
}

function PathLink({ path, target, nav }: { path: string; target: PathKind; nav: ExplanationNavigation }) {
  const hover: HoverTarget = target === "file" ? { kind: "file", path } : { kind: "folder", folder: path };
  const highlighted = target === "file"
    ? nav.hovered?.kind === "file" && nav.hovered.path === path
    : nav.hovered?.kind === "folder" && nav.hovered.folder === path;
  return (
    <button
      type="button"
      title={path}
      onClick={() => target === "file" ? nav.onSelectFile(path) : nav.onSelectFolder(path)}
      onMouseEnter={() => nav.onHoverChange(hover)}
      onMouseLeave={() => nav.onHoverChange(null)}
      onFocus={() => nav.onHoverChange(hover)}
      onBlur={() => nav.onHoverChange(null)}
      className={`cursor-pointer break-all font-mono text-[10px] text-accent hover:underline ${highlighted ? "underline" : ""}`}
    >
      {path}
    </button>
  );
}

function Inlines({ items, nav }: { items: Inline[]; nav: ExplanationNavigation }) {
  return items.map((item, position) => {
    switch (item.kind) {
      case "text": return <span key={position}>{item.text}</span>;
      case "code": return <code key={position} className="bg-background px-0.5 font-mono text-[10px]">{item.text}</code>;
      case "bold": return <strong key={position} className="font-semibold"><Inlines items={item.children} nav={nav} /></strong>;
      case "path": return <PathLink key={position} path={item.path} target={item.target} nav={nav} />;
    }
  });
}

function ExplanationText({ text, nav }: { text: string; nav: ExplanationNavigation }) {
  const { folding, index } = nav;
  const blocks = useMemo(() => {
    const folders = new Set(folding.groups.map((group) => group.folder).filter((folder) => folder !== "."));
    return parseExplanation(text, (candidate) =>
      index.fileByPath.has(candidate) ? "file" : folders.has(candidate) ? "folder" : null);
  }, [text, folding, index]);
  return (
    <div className="space-y-2 text-[11px] leading-[1.55]">
      {blocks.map((block, position) => block.kind === "paragraph"
        ? <p key={position}><Inlines items={block.inlines} nav={nav} /></p>
        : (
          <ul key={position} className="list-disc space-y-1 pl-4">
            {block.items.map((item, itemPosition) => <li key={itemPosition}><Inlines items={item} nav={nav} /></li>)}
          </ul>
        ))}
    </div>
  );
}

function FreshnessNote({ freshness, subject, commitSha, rerun }: {
  freshness: Freshness | undefined;
  subject: "file" | "folder";
  commitSha: string | null;
  rerun: () => Promise<void>;
}) {
  if (!freshness) return <p className="text-[10px] text-muted">Checking the repository for changes…</p>;
  if (freshness.state === "current") return null;
  if (freshness.state === "unknown") {
    return <p className="text-[10px] text-muted">Could not check whether this is stale: {freshness.reason}</p>;
  }
  const analysed = commitSha ? <span className="font-mono">{commitSha.slice(0, 7)}</span> : "the analysed commit";
  const head = <span className="font-mono">{freshness.head.slice(0, 7)}</span>;
  const message = freshness.state === "changed"
    ? <>This file has changed since {analysed}. The explanation describes the old version.</>
    : freshness.state === "removed"
      ? <>This file no longer exists at {head}. The explanation describes {analysed}.</>
      : <>The repository has moved past {analysed} to {head}{subject === "file" ? "; this file is unchanged, but its neighbours may not be" : ""}.</>;
  return (
    <div role="status" className="border border-border bg-background px-3 py-2 text-[11px]">
      <p>{message}</p>
      <form action={rerun} className="mt-2">
        <button type="submit" className="cursor-pointer border border-border px-2 py-1 text-[11px] hover:bg-background">Re-analyse</button>
      </form>
    </div>
  );
}

export function ExplanationPanel({ subject, entry, freshness, commitSha, tracing, rerun, onExplain, nav }: {
  subject: "file" | "folder";
  entry: ExplanationEntry | undefined;
  freshness: Freshness | undefined;
  commitSha: string | null;
  tracing: TracingStatus;
  rerun: () => Promise<void>;
  onExplain: () => void;
  nav: ExplanationNavigation;
}) {
  const result = entry?.status === "done" ? entry.result : null;
  return (
    <div className="space-y-3 px-4 py-4">
      {!entry && (
        <>
          <p className="text-[11px] text-muted">
            {subject === "file"
              ? "Written from this file's source and every file it imports or is imported by, as the parser resolved them."
              : "Written from what this folder holds and which parts of the map point at it."}
          </p>
          <button type="button" onClick={onExplain} className="cursor-pointer border border-accent px-3 py-1.5 text-[11px] text-accent hover:bg-accent/10">
            Explain
          </button>
        </>
      )}
      {entry?.status === "loading" && <p className="text-[11px] text-muted">Explaining…</p>}
      {result && !result.ok && (
        <div className="space-y-2">
          <p role="alert" className="text-[11px] text-failed">{result.error}</p>
          <button type="button" onClick={onExplain} className="cursor-pointer border border-border px-2 py-1 text-[11px] hover:bg-background">Try again</button>
        </div>
      )}
      {result?.ok && (
        <>
          <FreshnessNote freshness={freshness} subject={subject} commitSha={commitSha} rerun={rerun} />
          <ExplanationText text={result.text} nav={nav} />
          {result.notes.map((note) => <p key={note} className="text-[10px] text-muted">{note}</p>)}
          <p className="font-mono text-[10px] text-muted">{result.model} · {result.cached ? "from cache" : "written now"}</p>
        </>
      )}
      <p className="border-t border-border pt-3 text-[10px] text-muted">
        {tracing.enabled ? <>Traced to LangSmith project <span className="font-mono">{tracing.project}</span>.</>
          : <>Not traced: {tracing.reason}. Calls still work, but no runs are recorded.</>}
      </p>
    </div>
  );
}
