import type { Edge, FileNode } from "../parser/types.mts";
import type { Folding } from "./fold.ts";
import { shortestUniqueLabels } from "./labels.ts";

// Sizes are computed here, not measured in the browser, so the layout has them
// up front and the same data always gives the same picture.
export const SIZES = {
  charWidth: 6.6,
  nodePadding: 24,
  nodeMinHeight: 40,
  nodeMaxExtra: 40,
  panelHeader: 40,
  row: 20,
  maxRows: 12,
} as const;

export const NODE_HANDLE = "node";
export const ABOVE_HANDLE = "+above";
export const MORE_HANDLE = "+more";

export interface FolderView {
  kind: "folder";
  id: string;
  folder: string;
  label: string;
  fileCount: number;
  fanIn: number;
  fanOut: number;
  width: number;
  height: number;
}

export interface RowView {
  path: string;
  label: string;
  kind: string;
  fanIn: number;
  fanOut: number;
}

export interface PanelView {
  kind: "panel";
  id: string;
  folder: string;
  label: string;
  fileCount: number;
  fanIn: number;
  fanOut: number;
  rows: RowView[];
  aboveRows: number;
  belowRows: number;
  scrollable: boolean;
  width: number;
  height: number;
}

export type NodeView = FolderView | PanelView;

export interface EdgeView {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  // How many file-to-file imports this one line stands for.
  imports: number;
}

export interface CanvasView {
  nodes: NodeView[];
  edges: EdgeView[];
}

function textWidth(text: string): number {
  return Math.ceil(text.length * SIZES.charWidth);
}

// Height carries how many files outside the node depend on it. Square root so
// one heavily used folder doesn't dwarf everything else; capped so it stays a
// box rather than a column.
function heightFor(fanIn: number): number {
  return SIZES.nodeMinHeight + Math.min(SIZES.nodeMaxExtra, Math.round(Math.sqrt(fanIn) * 4));
}

export function nodeIdFor(folder: string, open: boolean): string {
  // Distinct ids so an opened panel mounts fresh and gets its row handles
  // measured, rather than inheriting the folded node's single pair.
  return open ? `panel:${folder}` : `folder:${folder}`;
}

// Turns the folding plus which folders are open into exactly what's on
// screen: folded nodes, open panels with their visible rows, and edges routed
// to rows wherever an end sits in an open panel. Imports between two files in
// the same node aren't drawn; they'd be a line from a box to itself.
export function buildCanvasView(
  files: FileNode[],
  edges: Edge[],
  folding: Folding,
  openFolders: ReadonlySet<string>,
  scrollTops: ReadonlyMap<string, number> = new Map(),
): CanvasView {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const labels = shortestUniqueLabels(folding.groups.map((group) => group.folder));

  // Fan-in and fan-out of a node count distinct files on the other side.
  const dependents = new Map<string, Set<string>>();
  const dependencies = new Map<string, Set<string>>();
  for (const edge of edges) {
    const fromGroup = folding.groupOf.get(edge.from);
    const toGroup = folding.groupOf.get(edge.to);
    if (!fromGroup || !toGroup || fromGroup === toGroup) continue;
    if (!dependents.has(toGroup)) dependents.set(toGroup, new Set());
    if (!dependencies.has(fromGroup)) dependencies.set(fromGroup, new Set());
    dependents.get(toGroup)?.add(edge.from);
    dependencies.get(fromGroup)?.add(edge.to);
  }

  // Where each file's edges attach: the folded node, its own row, or the
  // panel's "more" row when it's past the visible limit.
  const anchor = new Map<string, { node: string; handle: string }>();
  const nodes: NodeView[] = folding.groups.map((group) => {
    const open = openFolders.has(group.folder);
    const id = nodeIdFor(group.folder, open);
    const label = labels.get(group.folder) ?? group.folder;
    const fileCount = group.files.length;
    const fanIn = dependents.get(group.folder)?.size ?? 0;
    const fanOut = dependencies.get(group.folder)?.size ?? 0;
    const meta = `${fileCount} files  in ${fanIn}  out ${fanOut}`;

    if (!open) {
      for (const file of group.files) anchor.set(file, { node: id, handle: NODE_HANDLE });
      return {
        kind: "folder",
        id,
        folder: group.folder,
        label,
        fileCount,
        fanIn,
        fanOut,
        width: Math.max(textWidth(label), textWidth(meta)) + SIZES.nodePadding,
        height: heightFor(fanIn),
      };
    }

    const ordered = group.files
      .flatMap((filePath) => {
        const file = fileByPath.get(filePath);
        return file ? [file] : [];
      })
      .sort((left, right) => right.fanIn - left.fanIn || left.path.localeCompare(right.path));
    const visibleRows = Math.min(ordered.length, SIZES.maxRows);
    const maxScrollTop = Math.max(0, ordered.length - visibleRows) * SIZES.row;
    const scrollTop = Math.min(Math.max(0, scrollTops.get(group.folder) ?? 0), maxScrollTop);
    const firstVisible = Math.floor(scrollTop / SIZES.row);
    const lastVisible = Math.min(ordered.length, Math.ceil((scrollTop + visibleRows * SIZES.row) / SIZES.row));
    const prefix = group.folder === "." ? "" : `${group.folder}/`;
    const rowLabels = shortestUniqueLabels(ordered.map((file) => file.path.slice(prefix.length)));
    const rows = ordered.map((file) => {
      const relative = file.path.slice(prefix.length);
      return {
        path: file.path,
        label: rowLabels.get(relative) ?? relative,
        kind: file.kind,
        fanIn: file.fanIn,
        fanOut: file.fanOut,
      };
    });
    for (const [index, file] of ordered.entries()) {
      const handle = index < firstVisible ? ABOVE_HANDLE : index >= lastVisible ? MORE_HANDLE : file.path;
      anchor.set(file.path, { node: id, handle });
    }
    const widest = Math.max(
      textWidth(label),
      textWidth(meta),
      ...rows.slice(0, SIZES.maxRows).map((row) => textWidth(`${row.label}  ${row.fanIn} ${row.fanOut}`) + 12),
    );
    return {
      kind: "panel",
      id,
      folder: group.folder,
      label,
      fileCount,
      fanIn,
      fanOut,
      rows,
      aboveRows: firstVisible,
      belowRows: ordered.length - lastVisible,
      scrollable: ordered.length > SIZES.maxRows,
      width: widest + SIZES.nodePadding,
      height: SIZES.panelHeader + SIZES.row * (visibleRows + (ordered.length > SIZES.maxRows ? 1 : 0)),
    };
  });

  // An import and a re-export between the same two files are one connection
  // on the map, so the count below is of distinct file pairs.
  const pairs = new Map<string, Edge>();
  for (const edge of edges) pairs.set(`${edge.from}\0${edge.to}`, edge);

  const merged = new Map<string, EdgeView>();
  for (const edge of pairs.values()) {
    const from = anchor.get(edge.from);
    const to = anchor.get(edge.to);
    if (!from || !to || from.node === to.node) continue;
    const id = `${from.node}\0${from.handle}\0${to.node}\0${to.handle}`;
    const existing = merged.get(id);
    if (existing) {
      existing.imports += 1;
    } else {
      merged.set(id, {
        id,
        source: from.node,
        sourceHandle: `out:${from.handle}`,
        target: to.node,
        targetHandle: `in:${to.handle}`,
        imports: 1,
      });
    }
  }

  return {
    nodes,
    edges: [...merged.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}
