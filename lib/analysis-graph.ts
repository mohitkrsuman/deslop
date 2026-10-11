import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RouteRow } from "../components/canvas/route-table.tsx";
import type { ComparisonView } from "./canvas/comparison.ts";
import type { Database } from "./database.types.ts";
import type { MapComparison } from "./graph/compare.ts";
import type { Edge, FileNode, ImportKind, ParserCoverage } from "./parser/types.mts";
import { GENERIC_ROLES, isModelAssignableRole, normalizeRole } from "./taxonomy.mts";

export interface AnalysisGraph {
  files: FileNode[];
  edges: Edge[];
  routes: RouteRow[];
  // Paths whose role came from the model rather than an adapter.
  modelRoles: string[];
}

export async function readAll<Row>(page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await page(offset, offset + 999);
    if (error) throw error;
    rows.push(...data ?? []);
    if (!data || data.length < 1000) return rows;
  }
}

// The map as stored, read through the user's client. The page draws it and
// explanations are written from it, so the model sees what the map shows.
export async function loadAnalysisGraph(client: SupabaseClient<Database>, analysisId: string, adapter: string): Promise<AnalysisGraph> {
  const [fileRows, edgeRows, routeRows, roleRows] = await Promise.all([
    readAll((from, to) => client.from("files").select("id,path,folder,module_id,kind,line_count,sha256,fan_in,fan_out")
      .eq("analysis_id", analysisId).order("path").range(from, to)),
    readAll((from, to) => client.from("edges").select("source_file_id,target_file_id,kind")
      .eq("analysis_id", analysisId).order("id").range(from, to)),
    readAll((from, to) => client.from("routes").select("file_id,method,path")
      .eq("analysis_id", analysisId).order("path").order("method").range(from, to)),
    readAll((from, to) => client.from("file_roles").select("file_id,role")
      .eq("analysis_id", analysisId).order("file_id").range(from, to)),
  ]);

  const assigned = new Map(roleRows.filter((row) => isModelAssignableRole(row.role)).map((row) => [row.file_id, row.role]));
  const idToPath = new Map<string, string>();
  const files: FileNode[] = [];
  const modelRoles: string[] = [];
  for (const row of fileRows) {
    idToPath.set(row.id, row.path);
    let kind = normalizeRole(adapter, row.kind ?? "");
    // A model role only fills a gap convention left; it never overrides one.
    const fromModel = assigned.get(row.id);
    if (kind === GENERIC_ROLES.other && fromModel && normalizeRole(adapter, fromModel) === fromModel) {
      kind = fromModel;
      modelRoles.push(row.path);
    }
    files.push({ path: row.path, folder: row.folder ?? ".", moduleId: row.module_id ?? row.path,
      kind, lineCount: row.line_count ?? 0, sha256: row.sha256 ?? "",
      fanIn: row.fan_in ?? 0, fanOut: row.fan_out ?? 0 });
  }
  const edges: Edge[] = [];
  for (const row of edgeRows) {
    const from = idToPath.get(row.source_file_id);
    const to = idToPath.get(row.target_file_id);
    if (from && to) edges.push({ from, to, kind: row.kind as ImportKind });
  }
  const routes: RouteRow[] = [];
  for (const row of routeRows) {
    const file = idToPath.get(row.file_id);
    if (file) routes.push({ file, method: row.method, path: row.path });
  }
  return { files, edges, routes, modelRoles };
}

function isComparison(value: unknown): value is MapComparison {
  if (typeof value !== "object" || value === null) return false;
  const fields = ["added", "removed", "changed", "unparsed", "addedEdges", "removedEdges"] as const;
  return fields.every((field) => field in value && Array.isArray((value as Record<string, unknown>)[field]));
}

// The analysis's comparison, read through the user's client, or null. One
// whose "before" isn't this analysis's commit any more isn't shown at all.
export async function loadComparison(
  client: SupabaseClient<Database>, analysisId: string, commitSha: string | null, adapter: string,
): Promise<ComparisonView | null> {
  const { data, error } = await client.from("comparisons")
    .select("ref,base_sha,after_sha,status,stage,stage_message,stage_started_at,error_message,after_coverage,diff")
    .eq("analysis_id", analysisId).maybeSingle();
  if (error) throw error;
  if (!data || data.base_sha !== commitSha) return null;
  const diff = isComparison(data.diff) ? {
    ...data.diff,
    // Added files are drawn beside the base map, so their roles read against its adapter.
    added: data.diff.added.map((file) => ({ ...file, kind: normalizeRole(adapter, file.kind) })),
  } : null;
  return {
    ref: data.ref, baseSha: data.base_sha, afterSha: data.after_sha, status: data.status, stage: data.stage,
    stageMessage: data.stage_message, stageStartedAt: data.stage_started_at, errorMessage: data.error_message,
    diff, afterCoverage: data.after_coverage ? coverageOf(data.after_coverage, [], []) : null,
  };
}

// Analyses stored before route notes existed have none to show.
export function coverageOf(stored: unknown, files: FileNode[], edges: Edge[]): ParserCoverage {
  const coverage = stored as Partial<ParserCoverage> | null;
  return coverage?.imports ? { ...coverage as ParserCoverage, routeNotes: coverage.routeNotes ?? [] } : {
    filesFound: files.length, filesParsed: files.length, filesSkipped: 0,
    skippedFiles: [], skippedDirectories: [], configurationWarnings: [], routeNotes: [],
    imports: { found: edges.length, resolved: edges.length, external: 0,
      excluded: 0, unresolved: 0, unresolvedExamples: [] },
  };
}
