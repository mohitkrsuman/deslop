import dagre from "@dagrejs/dagre";
import type { CanvasView, NodeView } from "./view.ts";

export interface PositionedNode {
  view: NodeView;
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Left to right, because labels are wide and screens are wider than tall.
// Nodes and edges go in sorted so dagre sees the same input order every time,
// which is what makes the picture identical run to run.
export function layoutCanvas(view: CanvasView): PositionedNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 10, ranksep: 56, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));

  const nodes = [...view.nodes].sort((left, right) => left.id.localeCompare(right.id));
  for (const node of nodes) graph.setNode(node.id, { width: node.width, height: node.height });

  // dagre lays out boxes, not rows, so many row edges between two boxes are
  // one constraint.
  const pairs = new Set(view.edges.map((edge) => `${edge.source}\0${edge.target}`));
  for (const pair of [...pairs].sort()) {
    const [source, target] = pair.split("\0");
    graph.setEdge(source, target);
  }

  dagre.layout(graph);
  return nodes.map((node) => {
    const placed = graph.node(node.id);
    return { view: node, x: placed.x - node.width / 2, y: placed.y - node.height / 2 };
  });
}

// The box around everything placed, used to fit the viewport.
export function boundsOf(nodes: PositionedNode[]): Bounds {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.view.width));
  const bottom = Math.max(...nodes.map((node) => node.y + node.view.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
