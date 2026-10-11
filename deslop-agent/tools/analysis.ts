import { tool } from "langchain";
import { z } from "zod";
import { callToolApi, type AgentToolRuntime } from "./client";

const filePath = z.string().min(1).describe("Repository-relative file path exactly as the analysis lists it, e.g. src/lib/auth.ts.");

export const getSummary = tool(
  (_input: Record<string, never>, runtime: AgentToolRuntime) => callToolApi("get_summary", {}, runtime),
  {
    name: "get_summary",
    description: "Summary of the whole analysis: repository, framework adapter, file and edge counts, the roles present, and what the parser skipped or could not resolve. Call this first when you don't yet know the shape of the repository.",
    schema: z.object({}),
  },
);

export const searchPaths = tool(
  ({ query }, runtime: AgentToolRuntime) => callToolApi("search_paths", { query }, runtime),
  {
    name: "search_paths",
    description: "Find files whose path contains the given text. Use it to turn a name the user mentions into exact paths before calling any other file tool.",
    schema: z.object({ query: z.string().min(1).describe("Part of a file path, e.g. 'auth' or 'components/button'.") }),
  },
);

export const listFilesByRole = tool(
  ({ role }, runtime: AgentToolRuntime) => callToolApi("list_files_by_role", { role }, runtime),
  {
    name: "list_files_by_role",
    description: "List the files the analysis assigned a given role, such as route, component or config. The roles that exist in this analysis are listed by get_summary.",
    schema: z.object({ role: z.string().min(1).describe("A role name exactly as get_summary lists it.") }),
  },
);

export const getNeighbours = tool(
  ({ path }, runtime: AgentToolRuntime) => callToolApi("get_neighbours", { path }, runtime),
  {
    name: "get_neighbours",
    description: "The files this file imports directly and the files that import it directly. Only resolved imports appear; nothing is inferred.",
    schema: z.object({ path: filePath }),
  },
);

export const walkGraph = tool(
  ({ path, direction, depth }, runtime: AgentToolRuntime) => callToolApi("walk_graph", { path, direction, depth }, runtime),
  {
    name: "walk_graph",
    description: "Walk the import graph outward from one file and return every file reached, with its distance and the file it was reached through. 'dependencies' follows what the file imports (downstream); 'dependents' follows what imports it (upstream), which answers 'what breaks if this changes'.",
    schema: z.object({
      path: filePath,
      direction: z.enum(["dependencies", "dependents"]).describe("dependencies = files it relies on; dependents = files that rely on it."),
      depth: z.number().int().min(1).max(5).default(2).describe("How many import hops to follow, 1 to 5."),
    }),
  },
);

export const getRouteTable = tool(
  (_input: Record<string, never>, runtime: AgentToolRuntime) => callToolApi("get_route_table", {}, runtime),
  {
    name: "get_route_table",
    description: "The HTTP and page routes the framework adapter recovered, each with its method, URL path and the file that defines it. Routes the parser could not fully recover are absent, not approximated.",
    schema: z.object({}),
  },
);

export const analysisTools = [getSummary, searchPaths, listFilesByRole, getNeighbours, walkGraph, getRouteTable];
