import type { NextRequest } from "next/server";
import { createGrantClient } from "@/lib/agent/grant";
import { isAgentTool, runAgentTool, ToolInputError } from "@/lib/agent/tools";
import { coverageOf, loadAnalysisGraph } from "@/lib/analysis-graph";

// Called by the agent service, never by a browser. No user session here: the
// bearer token is a grant, and row security turns it into exactly one analysis.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/agent-tools/[tool]">) {
  const { tool } = await ctx.params;
  if (!isAgentTool(tool)) return Response.json({ error: `Unknown tool "${tool}".` }, { status: 404 });

  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return Response.json({ error: "Missing grant." }, { status: 401 });

  let args: Record<string, unknown>;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ToolInputError("Body must be a JSON object.");
    args = body as Record<string, unknown>;
  } catch (cause) {
    return Response.json({ error: cause instanceof ToolInputError ? cause.message : "Body must be JSON." }, { status: 400 });
  }

  const client = createGrantClient(token);
  // No filter: the policy decides which analysis this is. More than one row
  // would mean the policy is wrong, so it fails rather than picking one.
  const { data: rows, error } = await client.from("analyses").select("id,name,adapter,commit_sha,coverage").limit(2);
  if (error) return Response.json({ error: "Could not read the analysis." }, { status: 502 });
  if (!rows || rows.length === 0) return Response.json({ error: "Grant is invalid or expired." }, { status: 401 });
  if (rows.length > 1) return Response.json({ error: "Grant resolved to more than one analysis." }, { status: 500 });

  const [analysis] = rows;
  const adapter = analysis.adapter ?? "fallback";
  const graph = await loadAnalysisGraph(client, analysis.id, adapter);
  try {
    const result = runAgentTool({
      name: analysis.name,
      adapter,
      commitSha: analysis.commit_sha,
      coverage: coverageOf(analysis.coverage, graph.files, graph.edges),
      ...graph,
    }, tool, args);
    return Response.json(result);
  } catch (cause) {
    if (cause instanceof ToolInputError) return Response.json({ error: cause.message }, { status: 400 });
    throw cause;
  }
}
