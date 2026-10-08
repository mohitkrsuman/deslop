"use client";

import {
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getViewportForBounds,
  useReactFlow,
  useStoreApi,
  useUpdateNodeInternals,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { extensionOf, type Category, type CategoryFilter } from "@/lib/canvas/categories";
import type { Folding } from "@/lib/canvas/fold";
import { boundsOf, layoutCanvas } from "@/lib/canvas/layout";
import { highlightFor, rowKey, type Highlight, type HoverTarget, type Selection } from "@/lib/canvas/selection";
import {
  ABOVE_HANDLE,
  MORE_HANDLE,
  NODE_HANDLE,
  SIZES,
  buildCanvasView,
  nodeIdFor,
  type FolderView,
  type PanelView,
} from "@/lib/canvas/view";
import type { Edge, FileNode } from "@/lib/parser/types.mts";

const FIT_PADDING = 0.06;
const MIN_ZOOM = 0.05;
// The first fit never magnifies past 1:1, so a small repository isn't blown up.
const INITIAL_MAX_ZOOM = 1;

interface MapActions {
  open: (folder: string) => void;
  close: (folder: string) => void;
  selectRow: (node: string, path: string) => void;
  scrollPanel: (folder: string, scrollTop: number) => void;
  hoverFile: (path: string) => void;
  hoverFolder: (folder: string) => void;
  clearHover: () => void;
  extensionColor: (path: string) => string;
}

const ActionsContext = createContext<MapActions | null>(null);

function useActions(): MapActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("Map nodes must render inside DependencyMap.");
  return actions;
}

type FolderNodeType = FlowNode<{ view: FolderView; dim: boolean; selected: boolean; hovered: boolean; matchCount: number | null }, "folder">;
type PanelNodeType = FlowNode<
  { view: PanelView; highlight: Highlight | null; selectedRow: string | null; selected: boolean; hoveredFolder: boolean; hoveredRow: string | null; categoryFilter: CategoryFilter | null; matchCount: number | null },
  "panel"
>;

// Handles are invisible attachment points; the edge meeting the box is enough.
const handleStyle: CSSProperties = {
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  background: "transparent",
};

function Handles({ id, inside = false }: { id: string; inside?: boolean }) {
  return (
    <>
      <Handle type="target" position={Position.Left} id={`in:${id}`} isConnectable={false} style={inside ? { ...handleStyle, left: 0 } : handleStyle} />
      <Handle type="source" position={Position.Right} id={`out:${id}`} isConnectable={false} style={inside ? { ...handleStyle, right: 0 } : handleStyle} />
    </>
  );
}

function FanCounts({ fanIn, fanOut }: { fanIn: number; fanOut: number }) {
  return (
    <span className="tabular-nums">
      <span className="text-incoming">in {fanIn}</span>{" "}
      <span className="text-outgoing">out {fanOut}</span>
    </span>
  );
}

function FolderNode({ data }: NodeProps<FolderNodeType>) {
  const { open, hoverFolder, clearHover } = useActions();
  const { view } = data;
  return (
    <button
      type="button"
      onClick={() => open(view.folder)}
      onMouseEnter={() => hoverFolder(view.folder)}
      onMouseLeave={clearHover}
      onFocus={() => hoverFolder(view.folder)}
      onBlur={clearHover}
      title={view.folder}
      className={`flex h-full w-full cursor-pointer flex-col items-start border bg-surface px-3 py-1.5 text-left ${
        data.selected || data.hovered ? "border-accent" : "border-border"
      } ${data.dim ? "opacity-25" : ""}`}
    >
      <span className="font-mono text-[11px] leading-4">{view.label}</span>
      <span className="text-[10px] leading-4 text-muted">
        {data.matchCount === null ? `${view.fileCount} files` : `${data.matchCount}/${view.fileCount} match`} <FanCounts fanIn={view.fanIn} fanOut={view.fanOut} />
      </span>
      <Handles id={NODE_HANDLE} />
    </button>
  );
}

function PanelNode({ data }: NodeProps<PanelNodeType>) {
  const { close, selectRow, scrollPanel, hoverFile, hoverFolder, clearHover, extensionColor } = useActions();
  const updateNodeInternals = useUpdateNodeInternals();
  const updateFrame = useRef<number | null>(null);
  const rowsElement = useRef<HTMLDivElement | null>(null);
  const lastAutoScrolledRow = useRef<string | null>(null);
  const { view, highlight } = data;
  const categoryLit = (handle: string): boolean => {
    if (!data.categoryFilter) return true;
    if (handle === ABOVE_HANDLE || handle === MORE_HANDLE) {
      const rows = handle === ABOVE_HANDLE ? view.rows.slice(0, view.aboveRows) : view.rows.slice(view.rows.length - view.belowRows);
      return rows.some((row) => data.categoryFilter!.paths.has(row.path));
    }
    return data.categoryFilter.paths.has(handle);
  };
  // Selection and hover take priority over category dimming. A selected file
  // and its neighbours must remain readable even outside the active category.
  const lit = (handle: string): boolean => data.hoveredFolder || data.hoveredRow === handle || (highlight
    ? highlight.nodes.has(view.id) || highlight.rows.has(rowKey(view.id, handle))
    : categoryLit(handle));
  const frameLit = data.hoveredFolder || Boolean(data.hoveredRow) || (highlight
    ? highlight.nodes.has(view.id) || [...view.rows.map((row) => row.path), ABOVE_HANDLE, MORE_HANDLE]
      .some((handle) => highlight.rows.has(rowKey(view.id, handle)))
    : data.matchCount !== 0);

  useEffect(() => () => {
    if (updateFrame.current !== null) cancelAnimationFrame(updateFrame.current);
  }, []);

  useEffect(() => {
    const element = rowsElement.current;
    if (!data.selectedRow) {
      lastAutoScrolledRow.current = null;
      return;
    }
    if (!element || lastAutoScrolledRow.current === data.selectedRow) return;
    lastAutoScrolledRow.current = data.selectedRow;
    const index = view.rows.findIndex((row) => row.path === data.selectedRow);
    if (index < 0) return;
    const top = index * SIZES.row;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + SIZES.row > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + SIZES.row - element.clientHeight;
    }
  }, [data.selectedRow, view.rows]);

  const onRowsScroll = (scrollTop: number) => {
    scrollPanel(view.folder, scrollTop);
    if (updateFrame.current === null) {
      updateFrame.current = requestAnimationFrame(() => {
        updateFrame.current = null;
        updateNodeInternals(view.id);
      });
    }
  };

  return (
    <div
      className={`nowheel relative flex h-full min-w-0 w-full flex-col border bg-surface ${data.selected || data.selectedRow !== null || data.hoveredFolder ? "border-accent" : "border-border"} ${
        frameLit ? "" : "opacity-25"
      }`}
    >
      <button
        type="button"
        onClick={() => close(view.folder)}
        onMouseEnter={() => hoverFolder(view.folder)}
        onMouseLeave={clearHover}
        onFocus={() => hoverFolder(view.folder)}
        onBlur={clearHover}
        title={`${view.folder} — click to fold`}
        className="flex shrink-0 cursor-pointer flex-col items-start border-b border-border px-3 py-1.5 text-left"
        style={{ height: SIZES.panelHeader }}
      >
        <span className="font-mono text-[11px] leading-4">{view.label}</span>
        <span className="text-[10px] leading-4 text-muted">
          {data.matchCount === null ? `${view.fileCount} files` : `${data.matchCount}/${view.fileCount} match`} <FanCounts fanIn={view.fanIn} fanOut={view.fanOut} />
        </span>
      </button>
      {view.aboveRows > 0 && (
        <div className="pointer-events-none absolute inset-x-0 h-px" style={{ top: SIZES.panelHeader }}>
          <Handles id={ABOVE_HANDLE} />
        </div>
      )}
      <div
        ref={rowsElement}
        className="canvas-file-scroll nowheel nopan min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain touch-pan-y"
        role="region"
        aria-label={`${view.folder} files`}
        tabIndex={0}
        onScroll={(event) => onRowsScroll(event.currentTarget.scrollTop)}
      >
        {view.rows.map((row) => (
          <button
            key={row.path}
            type="button"
            onClick={() => selectRow(view.id, row.path)}
            onMouseEnter={() => hoverFile(row.path)}
            onMouseLeave={clearHover}
            onFocus={() => hoverFile(row.path)}
            onBlur={clearHover}
            title={row.path}
            className={`relative flex w-full shrink-0 cursor-pointer items-center gap-2 px-3 text-left ${
              data.selectedRow === row.path || data.hoveredRow === row.path ? "bg-accent/10 text-accent" : ""
            } ${frameLit && !lit(row.path) ? "opacity-25" : ""}`}
            style={{ height: SIZES.row }}
          >
            <span aria-hidden="true" className="size-1.5 shrink-0" style={{ background: extensionColor(row.path) }} />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{row.label}</span>
            <span className="text-[10px] text-muted">
              <FanCounts fanIn={row.fanIn} fanOut={row.fanOut} />
            </span>
            <Handles id={row.path} inside />
          </button>
        ))}
      </div>
      {view.scrollable && (
        <div
          className={`relative flex shrink-0 items-center px-3 text-[10px] text-muted ${
            !frameLit || lit(ABOVE_HANDLE) || lit(MORE_HANDLE) ? "" : "opacity-25"
          }`}
          style={{ height: SIZES.row }}
        >
          {view.aboveRows > 0 && `${view.aboveRows} above`}
          {view.aboveRows > 0 && view.belowRows > 0 && " · "}
          {view.belowRows > 0 && `${view.belowRows} more`}
          <Handles id={MORE_HANDLE} />
        </div>
      )}
    </div>
  );
}

const nodeTypes = { folder: FolderNode, panel: PanelNode };

function MapCanvas({
  files, edges, categories, categoryFilter, folding, openFolders, onOpenFoldersChange,
  selection, onSelectionChange, hovered, onHoverChange,
}: DependencyMapProps) {
  const [scrollTops, setScrollTops] = useState<ReadonlyMap<string, number>>(() => new Map());
  const previousOpenFolders = useRef(openFolders);
  const { getViewport, setViewport, zoomIn, zoomOut } = useReactFlow();
  const store = useStoreApi();

  const layoutFor = useCallback(
    (open: ReadonlySet<string>, scroll: ReadonlyMap<string, number>) => {
      const view = buildCanvasView(files, edges, folding, open, scroll);
      return { view, positioned: layoutCanvas(view) };
    },
    [files, edges, folding],
  );
  const { view, positioned } = useMemo(() => layoutFor(openFolders, scrollTops), [layoutFor, openFolders, scrollTops]);
  const highlight = useMemo(() => highlightFor(view, selection), [view, selection]);

  // Fits against the layout *after* the change, computed here from the next
  // open set rather than read back from state, and caps zoom at the current
  // level so opening a panel can only ever zoom out.
  const refit = useCallback(
    (open: ReadonlySet<string>) => {
      const { width, height } = store.getState();
      const next = layoutFor(open, scrollTops);
      setViewport(
        getViewportForBounds(boundsOf(next.positioned), width, height, MIN_ZOOM, getViewport().zoom, FIT_PADDING),
      );
    },
    [layoutFor, scrollTops, store, getViewport, setViewport],
  );

  // The pane can open a folder too. Fit after that state reaches the map, using
  // the new layout and never increasing the current zoom level.
  useLayoutEffect(() => {
    const added = [...openFolders].some((folder) => !previousOpenFolders.current.has(folder));
    previousOpenFolders.current = openFolders;
    if (added) refit(openFolders);
  }, [openFolders, refit]);

  const actions = useMemo<MapActions>(() => {
    const colors = new Map(categories.map((category) => [category.extension, category.color]));
    return {
      open: (folder) => {
        const next = new Set(openFolders).add(folder);
        onOpenFoldersChange(next);
        onSelectionChange({ kind: "node", id: nodeIdFor(folder, true) });
      },
      close: (folder) => {
        const next = new Set(openFolders);
        next.delete(folder);
        onOpenFoldersChange(next);
        setScrollTops((current) => {
          if (!current.has(folder)) return current;
          const updated = new Map(current);
          updated.delete(folder);
          return updated;
        });
        onSelectionChange({ kind: "node", id: nodeIdFor(folder, false) });
      },
      selectRow: (node, path) => onSelectionChange({ kind: "row", node, path }),
      scrollPanel: (folder, scrollTop) => setScrollTops((current) => {
        const previous = current.get(folder) ?? 0;
        if (Math.floor(previous / SIZES.row) === Math.floor(scrollTop / SIZES.row) &&
            Math.ceil(previous / SIZES.row) === Math.ceil(scrollTop / SIZES.row)) return current;
        return new Map(current).set(folder, scrollTop);
      }),
      hoverFile: (path) => onHoverChange({ kind: "file", path }),
      hoverFolder: (folder) => onHoverChange({ kind: "folder", folder }),
      clearHover: () => onHoverChange(null),
      extensionColor: (path) => colors.get(extensionOf(path)) ?? "transparent",
    };
  }, [categories, openFolders, onOpenFoldersChange, onSelectionChange, onHoverChange]);

  const flowNodes = useMemo<(FolderNodeType | PanelNodeType)[]>(
    () =>
      positioned.map(({ view: node, x, y }) => {
        const selected = selection?.kind === "node" && selection.id === node.id;
        const hoveredFolder = hovered?.kind === "folder" && hovered.folder === node.folder;
        const hoveredFile = hovered?.kind === "file" && folding.groupOf.get(hovered.path) === node.folder
          ? hovered.path : null;
        const base = { id: node.id, position: { x, y }, width: node.width, height: node.height };
        const matchCount = categoryFilter ? categoryFilter.counts.get(node.folder) ?? 0 : null;
        return node.kind === "folder"
          ? {
              ...base, type: "folder",
              data: {
                view: node, selected, hovered: hoveredFolder || Boolean(hoveredFile),
                matchCount,
                dim: !hoveredFolder && !hoveredFile && (highlight ? !highlight.nodes.has(node.id) : matchCount === 0),
              },
            }
          : {
              ...base,
              type: "panel",
              data: {
                view: node,
                highlight,
                selected,
                selectedRow: selection?.kind === "row" && selection.node === node.id ? selection.path : null,
                hoveredFolder,
                hoveredRow: hoveredFile,
                categoryFilter,
                matchCount,
              },
            };
      }),
    [positioned, selection, highlight, hovered, folding, categoryFilter],
  );

  const flowEdges = useMemo<FlowEdge[]>(
    () =>
      view.edges.map((edge) => {
        const lit = highlight ? highlight.edges.has(edge.id) : !categoryFilter || edge.extensions.includes(categoryFilter.extension);
        // Colour only means direction, so it only appears once there's a
        // selection to be direction relative to.
        const stroke = highlight && lit
          ? highlight.outgoing.has(edge.id) ? "var(--outgoing)" : "var(--incoming)"
          : "var(--muted)";
        return {
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourceHandle,
          target: edge.target,
          targetHandle: edge.targetHandle,
          focusable: false,
          style: {
            stroke,
            strokeWidth: Math.min(3, 1 + Math.log2(edge.imports) / 2),
            opacity: lit ? (highlight ? 0.9 : 0.35) : 0.06,
          },
        };
      }),
    [view, highlight, categoryFilter],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        // React Flow disables pointer events on nodes unless they are selectable,
        // draggable, or have a node click handler. Keep our buttons interactive
        // while preventing their clicks from reaching the pane's clear action.
        onNodeClick={(event) => event.stopPropagation()}
        onPaneClick={() => onSelectionChange(null)}
        minZoom={MIN_ZOOM}
        fitView
        fitViewOptions={{ padding: FIT_PADDING, maxZoom: INITIAL_MAX_ZOOM }}
        style={{ background: "transparent" }}
      >
        <Panel
          position="bottom-left"
          role="group"
          aria-label="Canvas zoom"
          onClick={(event) => event.stopPropagation()}
          className="flex flex-col border border-border bg-surface shadow-sm"
        >
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => void zoomIn({ duration: 120 })}
            className="flex size-9 cursor-pointer items-center justify-center border-b border-border font-mono text-lg leading-none hover:text-accent focus-visible:text-accent"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => void zoomOut({ duration: 120 })}
            className="flex size-9 cursor-pointer items-center justify-center font-mono text-lg leading-none hover:text-accent focus-visible:text-accent"
          >
            −
          </button>
        </Panel>
      </ReactFlow>
    </ActionsContext.Provider>
  );
}

interface DependencyMapProps {
  files: FileNode[];
  edges: Edge[];
  categories: Category[];
  categoryFilter: CategoryFilter | null;
  folding: Folding;
  openFolders: ReadonlySet<string>;
  onOpenFoldersChange: (folders: ReadonlySet<string>) => void;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  hovered: HoverTarget;
  onHoverChange: (target: HoverTarget) => void;
}

export function DependencyMap(props: DependencyMapProps) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  );
}
