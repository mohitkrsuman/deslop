"use client";

import { useId, useMemo, useState } from "react";
import { walkGraph, type GraphIndex, type WalkDirection } from "@/lib/graph/graph";
import { PathList, type FileNavigationProps } from "@/components/canvas/path-list";

export function GraphWalk({ path, graph, ...navigation }: FileNavigationProps & {
  path: string;
  graph: GraphIndex;
}) {
  const id = useId();
  const [direction, setDirection] = useState<WalkDirection | null>(null);
  const [depth, setDepth] = useState(2);
  const results = useMemo(() => direction ? walkGraph(graph, path, direction, depth) : [], [graph, path, direction, depth]);

  return (
    <section className="border-t border-border px-4 py-4" aria-label="Explore connections">
      <div className="flex gap-2">
        {(["dependents", "dependencies"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={direction === value}
            aria-controls={`${id}-results`}
            onClick={() => setDirection(direction === value ? null : value)}
            className={`flex-1 cursor-pointer border px-2 py-2 text-[11px] ${direction === value ? "border-accent bg-accent/10 text-accent" : "border-border hover:text-accent"}`}
          >
            {value === "dependents" ? "Blast radius" : "Dependency chain"}
          </button>
        ))}
      </div>
      <div id={`${id}-results`} aria-live="polite">
        {direction && (
          <>
            <p className="mt-3 text-[11px] text-muted">
              {direction === "dependents" ? "Files that depend on this file, directly or indirectly." : "Files this file depends on, directly or indirectly."}
            </p>
            <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
              <label htmlFor={`${id}-depth`}>Depth limit</label>
              <select
                id={`${id}-depth`}
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
                className="border border-border bg-surface px-2 py-1 text-foreground"
              >
                {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} {value === 1 ? "level" : "levels"}</option>)}
              </select>
            </div>
            <p className="mt-3 text-[11px] text-muted">{results.length} {results.length === 1 ? "file" : "files"} within {depth} {depth === 1 ? "level" : "levels"}</p>
            {results.length === 0 && <p className="mt-2 text-[11px]">No reachable files.</p>}
            {Array.from({ length: depth }, (_, i) => i + 1).map((level) => {
              const paths = results.filter((file) => file.depth === level).map((file) => file.path);
              return paths.length > 0 && (
                <div key={level} className="mt-3">
                  <h3 className="text-[10px] uppercase tracking-wide text-muted">Level {level} · {paths.length}</h3>
                  <PathList {...navigation} paths={paths} />
                </div>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}
