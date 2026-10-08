import { PathList, type FileNavigationProps } from "@/components/canvas/path-list";
import { INSIGHT_SENTENCES, type Insights } from "@/lib/graph/insights";
import type { GraphIndex } from "@/lib/graph/graph";

export function InsightsPanel({ insights, graph, ...navigation }: FileNavigationProps & {
  insights: Insights;
  graph: GraphIndex;
}) {
  const lineCounts = new Map(insights.oversized.map((file) => [file.path, file.lineCount]));
  return (
    <details className="mt-4 border-t border-border">
      <summary className="cursor-pointer px-3 py-3 text-[11px] font-medium hover:text-accent">Insights</summary>
      <section className="border-t border-border px-3 py-3">
        <h3 className="text-[11px] font-medium">Files nothing imports · {insights.unimported.length}</h3>
        <p className="mt-1 text-[10px] text-muted">{INSIGHT_SENTENCES.unimported}</p>
        <p className="mt-1 text-[10px] text-muted">Known framework entry points excluded; no claim of unused code.</p>
        <PathList {...navigation} paths={insights.unimported.map((file) => file.path)} />
      </section>
      <section className="border-t border-border px-3 py-3">
        <h3 className="text-[11px] font-medium">Many importers · {insights.highFanIn.length}</h3>
        <p className="mt-1 text-[10px] text-muted">{INSIGHT_SENTENCES.highFanIn}</p>
        <p className="mt-1 text-[10px] text-muted" title="At least 10 importers, or the repository mean plus two standard deviations, rounded up.">Importers ≥ {insights.fanInThreshold}</p>
        <PathList {...navigation} paths={insights.highFanIn.map((file) => file.path)} trailing={(path) => String(graph.dependents.get(path)?.length ?? 0)} />
      </section>
      <section className="border-t border-border px-3 py-3">
        <h3 className="text-[11px] font-medium">Import cycles · {insights.cycles.length}</h3>
        <p className="mt-1 text-[10px] text-muted">{INSIGHT_SENTENCES.cycles}</p>
        <p className="mt-1 text-[10px] text-muted">One example per connected cycle group, in import order.</p>
        {insights.cycles.map((cycle, index) => (
          <details key={cycle.files[0]} className="mt-2 border border-border px-2 py-2">
            <summary className="cursor-pointer text-[10px]">Cycle {index + 1} · {cycle.files.length} files in group</summary>
            <PathList {...navigation} paths={cycle.path} ranked />
          </details>
        ))}
      </section>
      <section className="border-t border-border px-3 py-3">
        <h3 className="text-[11px] font-medium">Long files · {insights.oversized.length}</h3>
        <p className="mt-1 text-[10px] text-muted">{INSIGHT_SENTENCES.oversized}</p>
        <p className="mt-1 text-[10px] text-muted">Lines &gt; {insights.lineThreshold}</p>
        <PathList {...navigation} paths={insights.oversized.map((file) => file.path)} trailing={(path) => String(lineCounts.get(path) ?? 0)} />
      </section>
    </details>
  );
}
