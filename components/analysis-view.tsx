"use client";

import { useCallback, useMemo, useState } from "react";
import { AnalysisShell } from "@/components/analysis-shell";
import { CategoryRail } from "@/components/canvas/category-rail";
import { DependencyMap } from "@/components/canvas/dependency-map";
import { DetailPane } from "@/components/canvas/detail-pane";
import { InsightsPanel } from "@/components/canvas/insights-panel";
import { categoriesOf, categoryFilterFor } from "@/lib/canvas/categories";
import { buildDetailIndex } from "@/lib/canvas/details";
import { foldDirectories } from "@/lib/canvas/fold";
import { type HoverTarget, type Selection } from "@/lib/canvas/selection";
import { nodeIdFor } from "@/lib/canvas/view";
import { buildInsights } from "@/lib/graph/insights";
import type { Edge, FileNode, ParserCoverage } from "@/lib/parser/types.mts";

export function AnalysisView({
  name,
  adapter,
  importCount,
  files,
  edges,
  coverage,
  coveragePercent,
}: {
  name: string;
  adapter: string;
  importCount: number;
  files: FileNode[];
  edges: Edge[];
  coverage: ParserCoverage;
  coveragePercent: number;
}) {
  const categories = useMemo(() => categoriesOf(files), [files]);
  const folding = useMemo(() => foldDirectories(files), [files]);
  const index = useMemo(() => buildDetailIndex(files, edges), [files, edges]);
  const insights = useMemo(() => buildInsights(files, index), [files, index]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const categoryFilter = useMemo(() => categoryFilterFor(files, folding, activeCategory), [files, folding, activeCategory]);
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [hovered, setHovered] = useState<HoverTarget>(null);

  const selectFile = useCallback((path: string) => {
    const folder = folding.groupOf.get(path);
    if (!folder) return;
    setOpenFolders((current) => current.has(folder) ? current : new Set(current).add(folder));
    setHovered(null);
    setSelection({ kind: "row", node: nodeIdFor(folder, true), path });
  }, [folding]);

  return (
    <AnalysisShell
      rail={
        <>
          <CategoryRail name={name} categories={categories} activeCategory={activeCategory} onCategoryChange={(extension) => {
            setActiveCategory(extension);
            setSelection(null);
            setHovered(null);
          }} />
          <InsightsPanel insights={insights} graph={index} folding={folding} hovered={hovered} onSelectFile={selectFile} onHoverChange={setHovered} />
        </>
      }
      map={
        <div className="relative h-full min-h-0">
        <DependencyMap
          files={files}
          edges={edges}
          categories={categories}
          categoryFilter={categoryFilter}
          folding={folding}
          openFolders={openFolders}
          onOpenFoldersChange={setOpenFolders}
          selection={selection}
          onSelectionChange={setSelection}
          hovered={hovered}
          onHoverChange={setHovered}
        />
        {coveragePercent < 100 && <details className="absolute left-3 top-3 z-20 max-w-sm border border-border bg-surface/95 text-xs shadow-sm">
          <summary className="cursor-pointer px-3 py-2 font-medium">Partial graph · {coveragePercent.toFixed(1)}% coverage</summary>
          <div className="border-t border-border px-3 py-2 text-muted">
            <p>{coverage.filesParsed} of {coverage.filesFound} files parsed; {coverage.imports.resolved} of {coverage.imports.resolved + coverage.imports.unresolved + coverage.imports.excluded} local imports resolved.</p>
            {coverage.configurationWarnings.length > 0 && <p className="mt-1">{coverage.configurationWarnings.length} configuration warning(s).</p>}
            {coverage.imports.unresolvedExamples.slice(0, 3).map((item, index) => <p key={index} className="mt-1 truncate">{item.from}: {item.specifier}</p>)}
          </div>
        </details>}
        </div>
      }
      detail={
        <DetailPane
          name={name}
          adapter={adapter}
          importCount={importCount}
          files={files}
          categories={categories}
          folding={folding}
          index={index}
          selection={selection}
          hovered={hovered}
          onSelectFile={selectFile}
          onHoverChange={setHovered}
        />
      }
    />
  );
}
