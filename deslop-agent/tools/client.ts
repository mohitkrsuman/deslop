import type { ToolRuntime } from "langchain";
import { z } from "zod";

// The app starts each run with this context. The credential names exactly one
// analysis; the model never sees it, so nothing it reads can redirect a tool to
// a different analysis.
export const agentContextSchema = z.object({
  toolToken: z.string().min(1),
});

export type AgentContext = z.infer<typeof agentContextSchema>;
export type AgentToolRuntime = ToolRuntime<unknown, AgentContext>;

// Every tool is a POST to `<CARTOGRAPH_TOOL_API_URL>/<tool name>` with the tool's
// arguments as the JSON body. The endpoint runs the app's own graph functions;
// this side only forwards, so no relationship is ever computed here.
export async function callToolApi(
  name: string,
  args: Record<string, unknown>,
  runtime: AgentToolRuntime,
): Promise<string> {
  const base = process.env.CARTOGRAPH_TOOL_API_URL;
  if (!base) throw new Error("CARTOGRAPH_TOOL_API_URL is not set.");
  const token = runtime.context?.toolToken;
  if (!token) throw new Error("This run has no tool credential, so no analysis can be read.");

  const response = await fetch(`${base.replace(/\/$/, "")}/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${name} failed with ${response.status}: ${body.slice(0, 500)}`);
  return body;
}
