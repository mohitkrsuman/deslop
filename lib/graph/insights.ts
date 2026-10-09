import type { FileNode } from "../parser/types.mts";
import { isConventionEntryPoint } from "../parser/adapters/entry-points.mts";
import { findImportCycles, type GraphIndex, type ImportCycle } from "./graph.ts";

export const INSIGHT_SENTENCES = {
  unimported: "No file in this repository depends on this file.",
  highFanIn: "An unusually large number of files depend on this file.",
  cycles: "These files form a dependency cycle.",
  oversized: "This file exceeds the line-count threshold.",
} as const;

export const LONG_FILE_LINES = 500;

export interface Insights {
  unimported: FileNode[];
  highFanIn: FileNode[];
  cycles: ImportCycle[];
  oversized: FileNode[];
  fanInThreshold: number;
  lineThreshold: number;
}

export function buildInsights(files: FileNode[], graph: GraphIndex): Insights {
  const count = (file: FileNode) => graph.dependents.get(file.path)?.length ?? 0;
  const mean = files.length ? files.reduce((sum, file) => sum + count(file), 0) / files.length : 0;
  const variance = files.length ? files.reduce((sum, file) => sum + (count(file) - mean) ** 2, 0) / files.length : 0;
  // A repository-relative outlier threshold, with a floor for small graphs.
  const fanInThreshold = Math.max(10, Math.ceil(mean + 2 * Math.sqrt(variance)));
  return {
    unimported: files.filter((file) => count(file) === 0 && !isConventionEntryPoint(file))
      .sort((a, b) => a.path.localeCompare(b.path)),
    highFanIn: files.filter((file) => count(file) >= fanInThreshold)
      .sort((a, b) => count(b) - count(a) || a.path.localeCompare(b.path)),
    cycles: findImportCycles(graph),
    oversized: files.filter((file) => file.lineCount > LONG_FILE_LINES)
      .sort((a, b) => b.lineCount - a.lineCount || a.path.localeCompare(b.path)),
    fanInThreshold,
    lineThreshold: LONG_FILE_LINES,
  };
}
