import { defineDeepAgent } from "managed-deepagents";
import { analysisTools } from "./tools/analysis";
import { agentContextSchema } from "./tools/client";
import { selectModel, unselectedModel } from "./tools/model";

export const agent = defineDeepAgent({
  name: "deslop-agent",
  // Refuses to answer on its own; selectModel swaps in the model and key the
  // app chose for this question's organization.
  model: unselectedModel,
  tools: analysisTools,
  contextSchema: agentContextSchema,
  middleware: [selectModel],
  // Replaces the built-in general-purpose subagent, which doesn't receive
  // custom middleware and would otherwise call the static model directly.
  subagents: [{
    name: "general-purpose",
    description: "Runs a multi-step lookup over this analysis in its own context and returns the result. Has the same repository tools.",
    systemPrompt: "You look things up in one analysed repository using the tools you have. Every path, role, import and route you report must have come back from a tool. Report what you found plainly; never infer a connection.",
    tools: analysisTools,
    middleware: [selectModel],
  }],
});
