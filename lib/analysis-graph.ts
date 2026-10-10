import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RouteRow } from "@/components/canvas/route-table";
import type { Database } from "@/lib/database.types";
import type { Edge, FileNode, ImportKind } from "@/lib/parser/types.mts";
import { GENERIC_ROLES, isModelAssignableRole, normalizeRole } from "@/lib/taxonomy.mts";

export interface AnalysisGraph {
  files: FileNode[];
  edges: Edge[];
  routes: RouteRow[];
  // Paths whose role came from the model rather than an adapter.
  modelRoles: string[];
}

async function readAll<Row>(page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>): Promise<Row[]> {
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
