"use client";

import {
  Handle,
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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { extensionOf, type Category } from "@/lib/canvas/categories";
import { foldDirectories } from "@/lib/canvas/fold";
import { boundsOf, layoutCanvas } from "@/lib/canvas/layout";
import { highlightFor, rowKey, type Highlight, type Selection } from "@/lib/canvas/selection";
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
  extensionColor: (path: string) => string;
}

const ActionsContext = createContext<MapActions | null>(null);

function useActions(): MapActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("Map nodes must render inside DependencyMap.");
  return actions;
}

type FolderNodeType = FlowNode<{ view: FolderView; dim: boolean; selected: boolean }, "folder">;
type PanelNodeType = FlowNode<
  { view: PanelView; highlight: Highlight | null; selectedRow: string | null; selected: boolean },
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
  const { open } = useActions();
  const { view } = data;
  return (
    <button
      type="button"
      onClick={() => open(view.folder)}
      title={view.folder}
      className={`flex h-full w-full cursor-pointer flex-col items-start border bg-surface px-3 py-1.5 text-left ${
        data.selected ? "border-accent" : "border-border"
      } ${data.dim ? "opacity-25" : ""}`}
    >
      <span className="font-mono text-[11px] leading-4">{view.label}</span>
      <span className="text-[10px] leading-4 text-muted">
        {view.fileCount} files <FanCounts fanIn={view.fanIn} fanOut={view.fanOut} />
      </span>
      <Handles id={NODE_HANDLE} />
    </button>
  );
}

function PanelNode({ data }: NodeProps<PanelNodeType>) {
  const { close, selectRow, scrollPanel, extensionColor } = useActions();
  const updateNodeInternals = useUpdateNodeInternals();
  const updateFrame = useRef<number | null>(null);
  const { view, highlight } = data;
  const lit = (handle: string): boolean =>
    !highlight || highlight.nodes.has(view.id) || highlight.rows.has(rowKey(view.id, handle));
  const frameLit = !highlight || highlight.nodes.has(view.id) ||
    [...view.rows.map((row) => row.path), ABOVE_HANDLE, MORE_HANDLE].some((handle) => highlight.rows.has(rowKey(view.id, handle)));

  useEffect(() => () => {
    if (updateFrame.current !== null) cancelAnimationFrame(updateFrame.current);
  }, []);

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
      className={`nowheel relative flex h-full min-w-0 w-full flex-col border bg-surface ${data.selected ? "border-accent" : "border-border"} ${
        frameLit ? "" : "opacity-25"
      }`}
    >
      <button
        type="button"
        onClick={() => close(view.folder)}
        title={`${view.folder} — click to fold`}
        className="flex shrink-0 cursor-pointer flex-col items-start border-b border-border px-3 py-1.5 text-left"
        style={{ height: SIZES.panelHeader }}
      >
        <span className="font-mono text-[11px] leading-4">{view.label}</span>
        <span className="text-[10px] leading-4 text-muted">
          {view.fileCount} files <FanCounts fanIn={view.fanIn} fanOut={view.fanOut} />
        </span>
      </button>
      {view.aboveRows > 0 && (
        <div className="pointer-events-none absolute inset-x-0 h-px" style={{ top: SIZES.panelHeader }}>
          <Handles id={ABOVE_HANDLE} />
        </div>
      )}
      <div
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
            title={row.path}
            className={`relative flex w-full shrink-0 cursor-pointer items-center gap-2 px-3 text-left ${
              data.selectedRow === row.path ? "bg-accent/10 text-accent" : ""
            } ${lit(row.path) ? "" : "opacity-25"}`}
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
            lit(ABOVE_HANDLE) || lit(MORE_HANDLE) ? "" : "opacity-25"
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

function MapCanvas({ files, edges, categories }: DependencyMapProps) {
  const folding = useMemo(() => foldDirectories(files), [files]);
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(() => new Set());
  const [scrollTops, setScrollTops] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [selection, setSelection] = useState<Selection>(null);
  const { getViewport, setViewport } = useReactFlow();
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

  const actions = useMemo<MapActions>(() => {
    const colors = new Map(categories.map((category) => [category.extension, category.color]));
    return {
      open: (folder) => {
        const next = new Set(openFolders).add(folder);
        setOpenFolders(next);
        setSelection({ kind: "node", id: nodeIdFor(folder, true) });
        refit(next);
      },
      close: (folder) => {
        const next = new Set(openFolders);
        next.delete(folder);
        setOpenFolders(next);
        setScrollTops((current) => {
          if (!current.has(folder)) return current;
          const updated = new Map(current);
          updated.delete(folder);
          return updated;
        });
        setSelection({ kind: "node", id: nodeIdFor(folder, false) });
      },
      selectRow: (node, path) => setSelection({ kind: "row", node, path }),
      scrollPanel: (folder, scrollTop) => setScrollTops((current) => {
        const previous = current.get(folder) ?? 0;
        if (Math.floor(previous / SIZES.row) === Math.floor(scrollTop / SIZES.row) &&
            Math.ceil(previous / SIZES.row) === Math.ceil(scrollTop / SIZES.row)) return current;
        return new Map(current).set(folder, scrollTop);
      }),
      extensionColor: (path) => colors.get(extensionOf(path)) ?? "transparent",
    };
  }, [categories, openFolders, refit]);

  const flowNodes = useMemo<(FolderNodeType | PanelNodeType)[]>(
    () =>
      positioned.map(({ view: node, x, y }) => {
        const selected = selection?.kind === "node" && selection.id === node.id;
        const base = { id: node.id, position: { x, y }, width: node.width, height: node.height };
        return node.kind === "folder"
          ? { ...base, type: "folder", data: { view: node, selected, dim: Boolean(highlight && !highlight.nodes.has(node.id)) } }
          : {
              ...base,
              type: "panel",
              data: {
                view: node,
                highlight,
                selected,
                selectedRow: selection?.kind === "row" && selection.node === node.id ? selection.path : null,
              },
            };
      }),
    [positioned, selection, highlight],
  );

  const flowEdges = useMemo<FlowEdge[]>(
    () =>
      view.edges.map((edge) => {
        const lit = !highlight || highlight.edges.has(edge.id);
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
    [view, highlight],
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
        onPaneClick={() => setSelection(null)}
        minZoom={MIN_ZOOM}
        fitView
        fitViewOptions={{ padding: FIT_PADDING, maxZoom: INITIAL_MAX_ZOOM }}
        style={{ background: "transparent" }}
      />
    </ActionsContext.Provider>
  );
}

interface DependencyMapProps {
  files: FileNode[];
  edges: Edge[];
  categories: Category[];
}

export function DependencyMap(props: DependencyMapProps) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  );
}
