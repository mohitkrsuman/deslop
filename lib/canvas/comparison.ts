import { pairKey, type MapComparison } from "../graph/compare.ts";
import type { ParserCoverage } from "../parser/types.mts";
import type { CategoryFilter } from "./categories.ts";
import type { Folding } from "./fold.ts";
import type { EdgeView } from "./view.ts";

export type FileChange = "added" | "removed" | "changed";
export type ImportChange = "added" | "removed";

export interface ComparisonView {
  ref: string;
  baseSha: string;
  afterSha: string | null;
  status: "queued" | "analyzing" | "complete" | "failed";
  stage: string;
  stageMessage: string;
  stageStartedAt: string;
  errorMessage: string | null;
  diff: MapComparison | null;
  afterCoverage: ParserCoverage | null;
}

export interface ChangeMarks {
  files: ReadonlyMap<string, FileChange>;
  pairs: ReadonlyMap<string, ImportChange>;
}

export function changeMarksFor(diff: MapComparison): ChangeMarks {
  const files = new Map<string, FileChange>();
  for (const file of diff.added) files.set(file.path, "added");
  for (const path of diff.removed) files.set(path, "removed");
  for (const path of diff.changed) files.set(path, "changed");
  const pairs = new Map<string, ImportChange>();
  for (const edge of diff.addedEdges) pairs.set(pairKey(edge.from, edge.to), "added");
  for (const edge of diff.removedEdges) pairs.set(pairKey(edge.from, edge.to), "removed");
  return { files, pairs };
}

// One drawn line can stand for several imports. It shows as added when any of
// them was added, as removed only when every changed one was removed.
export function edgeChange(edge: EdgeView, marks: ChangeMarks): ImportChange | null {
  let removed = false;
  for (const pair of edge.pairs) {
    const mark = marks.pairs.get(pair);
    if (mark === "added") return "added";
    if (mark === "removed") removed = true;
  }
  return removed ? "removed" : null;
}

export type ChangeCounts = Record<FileChange, number>;

export function changeCountsFor(folding: Folding, marks: ChangeMarks): Map<string, ChangeCounts> {
  return new Map(folding.groups.map((group) => {
    const counts: ChangeCounts = { added: 0, removed: 0, changed: 0 };
    for (const path of group.files) {
      const mark = marks.files.get(path);
      if (mark) counts[mark] += 1;
    }
    return [group.folder, counts];
  }));
}

// Lights what the change touched; everything else dims, nothing is removed.
export function changeFilterFor(folding: Folding, marks: ChangeMarks): CategoryFilter {
  const paths = new Set(marks.files.keys());
  return {
    paths,
    counts: new Map(folding.groups.map((group) => [group.folder, group.files.filter((path) => paths.has(path)).length])),
    litEdge: (edge) => edgeChange(edge, marks) !== null,
  };
}
