import { defineDeepAgent } from "managed-deepagents";
import { analysisTools } from "./tools/analysis";
import { agentContextSchema } from "./tools/client";

export const agent = defineDeepAgent({
  name: "deslop-agent",
  model: "anthropic:claude-sonnet-5",
  tools: analysisTools,
  contextSchema: agentContextSchema,
});
