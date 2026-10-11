"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ExplanationText, type ExplanationNavigation } from "@/components/canvas/explanation-panel";
import type { AskEvent } from "@/lib/agent/events";

export type AskSelection = { kind: "file" | "folder"; path: string } | null;

type Part =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; args: Record<string, unknown>; state: "running" | "done" | "failed" };

// Every file this turn's graph tools returned, with the fewest hops any of
// them put it from its starting file.
export type AnswerTrace = ReadonlyMap<string, number>;

interface Turn {
  question: string;
  selection: AskSelection;
  parts: Part[];
  reached: AnswerTrace;
  status: "streaming" | "done" | "error" | "stopped";
  error?: string;
}

function mergeReached(current: AnswerTrace, reached: { path: string; hops: number }[] | undefined): AnswerTrace {
  if (!reached || reached.length === 0) return current;
  const next = new Map(current);
  for (const { path, hops } of reached) next.set(path, Math.min(hops, next.get(path) ?? hops));
  return next;
}

function applyEvent(turn: Turn, event: AskEvent): Turn {
  switch (event.type) {
    case "text": {
      const last = turn.parts.at(-1);
      const parts = last?.kind === "text"
        ? [...turn.parts.slice(0, -1), { kind: "text" as const, text: last.text + event.text }]
        : [...turn.parts, { kind: "text" as const, text: event.text }];
      return { ...turn, parts };
    }
    case "tool":
      return { ...turn, parts: [...turn.parts, { kind: "tool", id: event.id, name: event.name, args: event.args, state: "running" }] };
    case "tool_done":
      return {
        ...turn,
        reached: mergeReached(turn.reached, event.reached),
        parts: turn.parts.map((part) => part.kind === "tool" && part.id === event.id ? { ...part, state: event.ok ? "done" : "failed" } : part),
      };
    case "error":
      return { ...turn, status: "error", error: event.message };
    case "done":
      return turn.status === "streaming" ? { ...turn, status: "done" } : turn;
    case "thread":
      return turn;
  }
}

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args).map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`).join(" ");
}

function ToolCall({ part }: { part: Extract<Part, { kind: "tool" }> }) {
  return (
    <div className="border border-border bg-background px-2 py-1.5 font-mono text-[10px] leading-4">
      <div className="flex items-baseline justify-between gap-2">
        <span>{part.name}</span>
        <span className={part.state === "failed" ? "text-failed" : "text-muted"}>
          {part.state === "running" ? "running" : part.state === "done" ? "done" : "failed"}
        </span>
      </div>
      {Object.keys(part.args).length > 0 && <p className="break-all text-muted">{formatArgs(part.args)}</p>}
    </div>
  );
}

// Offered once the answer is finished, and only for files on this map.
function TraceButton({ turn, nav, onShowTrace }: { turn: Turn; nav: ExplanationNavigation; onShowTrace: (trace: AnswerTrace) => void }) {
  const onMap = useMemo(
    () => new Map([...turn.reached].filter(([path]) => nav.index.fileByPath.has(path))),
    [turn.reached, nav.index],
  );
  if (turn.status === "streaming" || onMap.size === 0) return null;
  return (
    <button
      type="button"
      onClick={() => onShowTrace(onMap)}
      className="cursor-pointer border border-border px-2 py-1 text-[11px] hover:bg-background"
    >
      Show on map <span className="tabular-nums text-muted">· {onMap.size} {onMap.size === 1 ? "file" : "files"} the tools returned</span>
    </button>
  );
}

export function AskPanel({ analysisId, selection, nav, onShowTrace }: {
  analysisId: string;
  selection: AskSelection;
  nav: ExplanationNavigation;
  onShowTrace: (trace: AnswerTrace) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const streaming = turns.at(-1)?.status === "streaming";

  useEffect(() => () => controller.current?.abort(), []);

  const updateLast = useCallback((update: (turn: Turn) => Turn) => {
    setTurns((current) => current.length ? [...current.slice(0, -1), update(current[current.length - 1])] : current);
  }, []);

  const ask = useCallback(async (text: string) => {
    const abort = new AbortController();
    controller.current = abort;
    setTurns((current) => [...current, { question: text, selection, parts: [], reached: new Map(), status: "streaming" }]);
    // Scrolls once, because the user just asked; streamed text doesn't move the view.
    requestAnimationFrame(() => end.current?.scrollIntoView({ block: "end" }));
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ analysisId, threadId, question: text, selection }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        const body: unknown = await response.json().catch(() => null);
        const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Request failed (${response.status}).`;
        updateLast((turn) => ({ ...turn, status: "error", error: message }));
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AskEvent;
          if (event.type === "thread") setThreadId(event.threadId);
          updateLast((turn) => applyEvent(turn, event));
        }
      }
      updateLast((turn) => turn.status === "streaming" ? { ...turn, status: "error", error: "The answer stopped before it finished." } : turn);
    } catch (cause) {
      if (abort.signal.aborted) updateLast((turn) => ({ ...turn, status: "stopped" }));
      else updateLast((turn) => ({ ...turn, status: "error", error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }, [analysisId, threadId, selection, updateLast]);

  const submit = (event?: FormEvent | KeyboardEvent) => {
    event?.preventDefault();
    const text = question.trim();
    if (!text || streaming) return;
    setQuestion("");
    void ask(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) submit(event);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="analysis-side-scroll min-h-0 flex-1 overflow-y-auto">
        {turns.length === 0 ? (
          <p className="px-4 py-4 text-[11px] leading-[1.55] text-muted">
            Ask about this repository&apos;s structure. Every answer is looked up with tools over the parsed map, and each lookup is shown as it runs.
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {turns.map((turn, position) => (
              <li key={position} className="space-y-2 px-4 py-3">
                <p className="text-[11px] font-semibold leading-[1.55]">{turn.question}</p>
                {turn.selection && <p className="break-all font-mono text-[10px] text-muted">with {turn.selection.path} selected</p>}
                {turn.parts.map((part, index) => part.kind === "tool"
                  ? <ToolCall key={part.id} part={part} />
                  : <ExplanationText key={index} text={part.text} nav={nav} />)}
                {turn.status === "streaming" && turn.parts.length === 0 && <p className="text-[11px] text-muted">Waiting for the agent…</p>}
                {turn.status === "stopped" && <p className="text-[11px] text-muted">Stopped.</p>}
                {turn.status === "error" && <p className="text-[11px] text-failed">{turn.error}</p>}
                <TraceButton turn={turn} nav={nav} onShowTrace={onShowTrace} />
              </li>
            ))}
          </ol>
        )}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="shrink-0 border-t border-border px-4 py-3">
        {selection && <p className="mb-2 break-all font-mono text-[10px] text-muted">Selected: {selection.path}</p>}
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          maxLength={4000}
          placeholder="What depends on the auth module?"
          aria-label="Question"
          className="block w-full resize-none border border-border bg-background px-2 py-1.5 text-[11px] leading-[1.55] text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => { controller.current?.abort(); setTurns([]); setThreadId(null); }}
            disabled={turns.length === 0}
            className="cursor-pointer text-[11px] text-muted hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            New conversation
          </button>
          {streaming ? (
            <button type="button" onClick={() => controller.current?.abort()} className="cursor-pointer border border-border px-3 py-1 text-[11px] hover:bg-background">Stop</button>
          ) : (
            <button type="submit" disabled={!question.trim()} className="cursor-pointer border border-border px-3 py-1 text-[11px] hover:bg-background disabled:cursor-default disabled:opacity-50">Ask</button>
          )}
        </div>
      </form>
    </div>
  );
}
