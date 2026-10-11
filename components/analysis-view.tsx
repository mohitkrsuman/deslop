"use client";

import { useCallback, useMemo, useState } from "react";
import { AnalysisShell } from "@/components/analysis-shell";
import { AskPanel, type AnswerTrace, type AskSelection } from "@/components/canvas/ask-panel";
import { CategoryRail } from "@/components/canvas/category-rail";
import { DependencyMap } from "@/components/canvas/dependency-map";
import { DetailPane } from "@/components/canvas/detail-pane";
import { InsightsPanel } from "@/components/canvas/insights-panel";
import { RouteTable, type RouteRow } from "@/components/canvas/route-table";
import { categoriesOf, categoryFilterFor, pathFilterFor } from "@/lib/canvas/categories";
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
  // An answer shown on the map, and how many hops of it are lit. Starts at the
  // files the tools began from; each step is a click.
  const [trace, setTrace] = useState<{ hops: AnswerTrace; shown: number } | null>(null);
  const traceMax = useMemo(() => trace ? Math.max(...trace.hops.values()) : 0, [trace]);
  const traceFilter = useMemo(() => trace
    ? pathFilterFor(folding, new Set([...trace.hops].filter(([, hops]) => hops <= trace.shown).map(([path]) => path)))
    : null, [trace, folding]);
  const categoryFilter = useMemo(
    () => traceFilter ?? categoryFilterFor(files, folding, activeCategory, adapter),
    [traceFilter, files, folding, activeCategory, adapter],
  );
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
  const showTrace = useCallback((hops: AnswerTrace) => {
    const folders = new Set([...hops.keys()].flatMap((path) => folding.groupOf.get(path) ?? []));
    setOpenFolders((current) => new Set([...current, ...folders]));
    setActiveCategory(null);
    setSelection(null);
    setHovered(null);
    setMainView("map");
    setTrace({ hops, shown: 0 });
  }, [folding]);
  const modelRoleSet = useMemo(() => new Set(modelRoles), [modelRoles]);
  const [paneMode, setPaneMode] = useState<"details" | "ask">("details");
  const askSelection = useMemo<AskSelection>(() => {
    if (selection?.kind === "row") return { kind: "file", path: selection.path };
    if (selection?.kind !== "node") return null;
    const group = folding.groups.find((item) => selection.id === nodeIdFor(item.folder, false) || selection.id === nodeIdFor(item.folder, true));
    return group ? { kind: "folder", path: group.folder } : null;
  }, [selection, folding]);

  return (
    <AnalysisShell
      rail={
        <>
          <CategoryRail categories={categories} activeCategory={activeCategory} onCategoryChange={(role) => {
            setTrace(null);
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
        {trace && (
          <div role="group" aria-label="Answer on the map" className="absolute right-3 top-3 z-20 flex items-center gap-2 border border-border bg-surface px-2 py-1.5 text-[11px] shadow-sm">
            <span className="text-muted">
              Answer · hop <span className="tabular-nums text-foreground">{trace.shown}</span> of <span className="tabular-nums">{traceMax}</span>
              {" "}· <span className="tabular-nums">{categoryFilter?.paths.size ?? 0}</span> of {trace.hops.size} files
            </span>
            <button type="button" disabled={trace.shown === 0} onClick={() => setTrace({ ...trace, shown: trace.shown - 1 })}
              className="cursor-pointer border border-border px-1.5 hover:bg-background disabled:cursor-default disabled:opacity-50">Back</button>
            <button type="button" disabled={trace.shown >= traceMax} onClick={() => setTrace({ ...trace, shown: trace.shown + 1 })}
              className="cursor-pointer border border-border px-1.5 hover:bg-background disabled:cursor-default disabled:opacity-50">Next hop</button>
            <button type="button" disabled={trace.shown >= traceMax} onClick={() => setTrace({ ...trace, shown: traceMax })}
              className="cursor-pointer border border-border px-1.5 hover:bg-background disabled:cursor-default disabled:opacity-50">All</button>
            <button type="button" onClick={() => setTrace(null)} className="cursor-pointer px-1 text-muted hover:text-foreground">Clear</button>
          </div>
        )}
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
        <div className="flex h-full min-h-0 flex-col">
          {/* Ask is a mode of the whole pane, not a tab beside Structure: a
              repository question doesn't need a file selected. */}
          <div role="tablist" aria-label="Right pane" className="flex shrink-0 border-b border-border">
            {(["details", "ask"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={paneMode === value}
                onClick={() => setPaneMode(value)}
                className={`flex-1 cursor-pointer border-b-2 px-2 py-1.5 text-[11px] ${paneMode === value ? "border-accent text-foreground" : "border-transparent text-muted"}`}
              >
                {value === "details" ? "Details" : "Ask"}
              </button>
            ))}
          </div>
          {/* Both stay mounted, so switching keeps the conversation and the open explanation. */}
          <div className={`analysis-side-scroll min-h-0 flex-1 overflow-y-auto ${paneMode === "details" ? "" : "hidden"}`}>
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
          </div>
          <div className={`min-h-0 flex-1 ${paneMode === "ask" ? "" : "hidden"}`}>
            <AskPanel
              analysisId={analysisId}
              selection={askSelection}
              nav={{ folding, index, hovered, onSelectFile: selectFile, onSelectFolder: selectFolder, onHoverChange: setHovered }}
              onShowTrace={showTrace}
            />
          </div>
        </div>
      }
    />
  );
}
