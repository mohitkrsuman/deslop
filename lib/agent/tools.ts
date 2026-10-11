import type { RouteRow } from "../../components/canvas/route-table.tsx";
import { buildGraphIndex, walkGraph, type WalkDirection } from "../graph/graph.ts";
import type { Edge, FileNode, ParserCoverage } from "../parser/types.mts";
import { GENERIC_ROLES, taxonomyFor } from "../taxonomy.mts";

// What the agent's tool endpoints answer from: one analysis, exactly as the map
// draws it. Nothing in here may identify the analysis itself.
export interface AgentAnalysis {
  name: string;
  adapter: string;
  commitSha: string | null;
  coverage: ParserCoverage;
  files: FileNode[];
  edges: Edge[];
  routes: RouteRow[];
  modelRoles: string[];
}

export const AGENT_TOOLS = ["get_summary", "search_paths", "list_files_by_role", "get_neighbours", "walk_graph", "get_route_table"] as const;
export type AgentToolName = typeof AGENT_TOOLS[number];

export function isAgentTool(name: string): name is AgentToolName {
  return (AGENT_TOOLS as readonly string[]).includes(name);
}

// Long lists are cut, and the cut is always stated with the full count.
const SEARCH_LIMIT = 50;
const LIST_LIMIT = 200;
// The same range the canvas graph walk offers.
const MAX_WALK_DEPTH = 5;

export class ToolInputError extends Error {}

function stringField(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new ToolInputError(`"${key}" must be a non-empty string.`);
  return value.trim();
}

function capped<T>(items: T[], limit: number) {
  return { total: items.length, truncated: items.length > limit, items: items.slice(0, limit) };
}

function roleLabel(adapter: string, role: string): string {
  if (role === GENERIC_ROLES.other) return "Unidentified";
  return taxonomyFor(adapter).categories.find((category) => category.role === role)?.label ?? role;
}

function unknownPath(path: string) {
  return { found: false, path, note: "No file in this analysis has exactly that path. Use search_paths to find the exact path." };
}

export function runAgentTool(analysis: AgentAnalysis, name: AgentToolName, args: Record<string, unknown>): unknown {
  const { files, edges, adapter } = analysis;
  const byPath = new Map(files.map((file) => [file.path, file]));

  switch (name) {
    case "get_summary": {
      const counts = new Map<string, number>();
      for (const file of files) counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1);
      const { coverage } = analysis;
      return {
        repository: analysis.name,
        framework: taxonomyFor(adapter).framework ?? "Not detected",
        commit: analysis.commitSha,
        files: files.length,
        imports: edges.length,
        routes: analysis.routes.length,
        roles: [...counts].map(([role, count]) => ({ role, label: roleLabel(adapter, role), files: count }))
          .sort((a, b) => b.files - a.files || a.role.localeCompare(b.role)),
        rolesLabelledByModel: analysis.modelRoles.length,
        parser: {
          filesFound: coverage.filesFound,
          filesParsed: coverage.filesParsed,
          filesSkipped: coverage.filesSkipped,
          importsResolved: coverage.imports.resolved,
          importsUnresolved: coverage.imports.unresolved,
          importsExternal: coverage.imports.external,
          importsExcluded: coverage.imports.excluded,
          configurationWarnings: coverage.configurationWarnings.length,
          routeNotes: coverage.routeNotes,
        },
      };
    }
    case "search_paths": {
      const query = stringField(args, "query").toLowerCase();
      const matches = files.filter((file) => file.path.toLowerCase().includes(query))
        .map((file) => ({ path: file.path, role: roleLabel(adapter, file.kind) }));
      return { query, ...capped(matches, SEARCH_LIMIT) };
    }
    case "list_files_by_role": {
      const role = stringField(args, "role");
      const present = [...new Set(files.map((file) => file.kind))].sort();
      if (!present.includes(role)) return { role, found: false, note: "No file in this analysis has that role.", rolesPresent: present };
      const paths = files.filter((file) => file.kind === role).map((file) => file.path).sort();
      return { role, label: roleLabel(adapter, role), ...capped(paths, LIST_LIMIT) };
    }
    case "get_neighbours": {
      const path = stringField(args, "path");
      if (!byPath.has(path)) return unknownPath(path);
      const graph = buildGraphIndex(files, edges);
      return {
        path,
        dependsOn: graph.dependencies.get(path) ?? [],
        dependedOnBy: graph.dependents.get(path) ?? [],
      };
    }
    case "walk_graph": {
      const path = stringField(args, "path");
      const direction = args.direction;
      if (direction !== "dependencies" && direction !== "dependents") throw new ToolInputError('"direction" must be "dependencies" or "dependents".');
      const depth = args.depth ?? 2;
      if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1 || depth > MAX_WALK_DEPTH) {
        throw new ToolInputError(`"depth" must be a whole number from 1 to ${MAX_WALK_DEPTH}.`);
      }
      if (!byPath.has(path)) return unknownPath(path);
      const reached = walkGraph(buildGraphIndex(files, edges), path, direction as WalkDirection, depth);
      return { path, direction, depth, ...capped(reached, LIST_LIMIT) };
    }
    case "get_route_table": {
      return { routeNotes: analysis.coverage.routeNotes, ...capped(analysis.routes, LIST_LIMIT) };
    }
  }
}
