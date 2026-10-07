import type { CanvasView } from "./view.ts";

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "row"; node: string; path: string }
  | null;

export interface Highlight {
  // Nodes kept at full strength as a whole.
  nodes: Set<string>;
  // Rows kept at full strength, keyed `${nodeId}\0${handle}`.
  rows: Set<string>;
  edges: Set<string>;
  // Edges leaving the selection, as opposed to arriving at it.
  outgoing: Set<string>;
}

export function rowKey(node: string, handle: string): string {
  return `${node}\0${handle}`;
}

// What stays lit for a selection: the selection, its edges, and whatever
// those edges connect to. Null means nothing is selected and nothing dims.
export function highlightFor(view: CanvasView, selection: Selection): Highlight | null {
  if (!selection) return null;
  const highlight: Highlight = { nodes: new Set(), rows: new Set(), edges: new Set(), outgoing: new Set() };

  if (selection.kind === "node") highlight.nodes.add(selection.id);
  else highlight.rows.add(rowKey(selection.node, selection.path));

  const touches = (node: string, handle: string): boolean =>
    selection.kind === "node" ? node === selection.id : node === selection.node && handle === selection.path;

  for (const edge of view.edges) {
    const sourceHandle = edge.sourceHandle.slice("out:".length);
    const targetHandle = edge.targetHandle.slice("in:".length);
    const leaves = touches(edge.source, sourceHandle);
    const arrives = touches(edge.target, targetHandle);
    if (!leaves && !arrives) continue;
    highlight.edges.add(edge.id);
    if (leaves) highlight.outgoing.add(edge.id);
    // The far end lights up as a row if it sits in a panel, else as a node.
    const [farNode, farHandle] = leaves ? [edge.target, targetHandle] : [edge.source, sourceHandle];
    highlight.rows.add(rowKey(farNode, farHandle));
    if (farNode.startsWith("folder:")) highlight.nodes.add(farNode);
  }
  return highlight;
}
