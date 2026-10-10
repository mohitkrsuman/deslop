"use client";

import { useCallback, useMemo, useState } from "react";
import { AnalysisShell } from "@/components/analysis-shell";
import { CategoryRail } from "@/components/canvas/category-rail";
import { DependencyMap } from "@/components/canvas/dependency-map";
import { DetailPane } from "@/components/canvas/detail-pane";
import { InsightsPanel } from "@/components/canvas/insights-panel";
import { RouteTable, type RouteRow } from "@/components/canvas/route-table";
import { categoriesOf, categoryFilterFor } from "@/lib/canvas/categories";
import { buildDetailIndex } from "@/lib/canvas/details";
import { foldDirectories } from "@/lib/canvas/fold";
import { type HoverTarget, type Selection } from "@/lib/canvas/selection";
import { nodeIdFor } from "@/lib/canvas/view";
import { buildInsights } from "@/lib/graph/insights";
import type { TracingStatus } from "@/lib/ai/client";
import type { Edge, FileNode, ParserCoverage } from "@/lib/parser/types.mts";

export function AnalysisView({
  analysisId,
  commitSha,
  modelRoles,
  labellingError,
  tracing,
  rerun,
  name,
  adapter,
  importCount,
  files,
  edges,
  routes,
  coverage,
  coveragePercent,
}: {
  analysisId: string;
  commitSha: string | null;
  modelRoles: string[];
  labellingError: string | null;
  tracing: TracingStatus;
  rerun: () => Promise<void>;
  name: string;
  adapter: string;
  importCount: number;
  files: FileNode[];
  edges: Edge[];
  routes: RouteRow[];
  coverage: ParserCoverage;
  coveragePercent: number;
}) {
  const categories = useMemo(() => categoriesOf(files, adapter), [files, adapter]);
  const folding = useMemo(() => foldDirectories(files), [files]);
  const index = useMemo(() => buildDetailIndex(files, edges), [files, edges]);
  const insights = useMemo(() => buildInsights(files, index), [files, index]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const categoryFilter = useMemo(() => categoryFilterFor(files, folding, activeCategory, adapter), [files, folding, activeCategory, adapter]);
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [hovered, setHovered] = useState<HoverTarget>(null);
  const [mainView, setMainView] = useState<"map" | "routes">("map");

  const selectFile = useCallback((path: string) => {
    const folder = folding.groupOf.get(path);
    if (!folder) return;
    setOpenFolders((current) => current.has(folder) ? current : new Set(current).add(folder));
    setHovered(null);
    setSelection({ kind: "row", node: nodeIdFor(folder, true), path });
  }, [folding]);

  const selectFolder = useCallback((folder: string) => {
    setHovered(null);
    setSelection({ kind: "node", id: nodeIdFor(folder, openFolders.has(folder)) });
  }, [openFolders]);
  const modelRoleSet = useMemo(() => new Set(modelRoles), [modelRoles]);

  return (
    <AnalysisShell
      rail={
        <>
          <CategoryRail categories={categories} activeCategory={activeCategory} onCategoryChange={(role) => {
            setActiveCategory(role);
            setSelection(null);
            setHovered(null);
          }} />
          <InsightsPanel insights={insights} graph={index} folding={folding} hovered={hovered} onSelectFile={selectFile} onHoverChange={setHovered} />
        </>
      }
      map={
        <div className="flex h-full min-h-0 flex-col">
        <div role="tablist" aria-label="Main view" className="flex shrink-0 border-b border-border bg-surface">
          {(["map", "routes"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mainView === value}
              onClick={() => setMainView(value)}
              className={`cursor-pointer border-b-2 px-3 py-1.5 text-[11px] ${mainView === value ? "border-accent text-foreground" : "border-transparent text-muted"}`}
            >
              {value === "map" ? "Map" : <>Routes <span className="tabular-nums text-muted">{routes.length}</span></>}
            </button>
          ))}
        </div>
        {mainView === "routes" && (
          <div className="min-h-0 flex-1">
            <RouteTable routes={routes} notes={coverage.routeNotes} folding={folding}
              selectedPath={selection?.kind === "row" ? selection.path : null}
              hovered={hovered} onSelectFile={selectFile} onHoverChange={setHovered} />
          </div>
        )}
        {/* Hidden rather than unmounted, so the map keeps its viewport and open folders. */}
        <div className={`relative min-h-0 flex-1 ${mainView === "map" ? "" : "hidden"}`}>
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
            <p>{coverage.filesParsed} of {coverage.filesFound} files parsed; {coverage.imports.resolved} of {coverage.imports.resolved + coverage.imports.unresolved + coverage.imports.excluded} local module references resolved.</p>
            {coverage.configurationWarnings.length > 0 && <p className="mt-1">{coverage.configurationWarnings.length} configuration warning(s).</p>}
            {coverage.imports.unresolvedExamples.slice(0, 3).map((item, index) => <p key={index} className="mt-1 truncate">{item.from}: {item.specifier}</p>)}
          </div>
        </details>}
        </div>
        </div>
      }
      detail={
        <DetailPane
          analysisId={analysisId}
          commitSha={commitSha}
          tracing={tracing}
          rerun={rerun}
          modelRoles={modelRoleSet}
          labellingError={labellingError}
          name={name}
          adapter={adapter}
          importCount={importCount}
          routeCount={routes.length}
          files={files}
          categories={categories}
          folding={folding}
          index={index}
          selection={selection}
          hovered={hovered}
          onSelectFile={selectFile}
          onSelectFolder={selectFolder}
          onHoverChange={setHovered}
        />
      }
    />
  );
}
