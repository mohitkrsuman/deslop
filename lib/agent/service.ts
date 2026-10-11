import "server-only";

import { Client } from "@langchain/langgraph-sdk";
import type { AskEvent } from "@/lib/agent/events";

const ASSISTANT_ID = "deslop-agent";

// The agent service trusts this app to have signed the user in; it scopes each
// conversation thread to the user id sent here. apiKey null stops the SDK
// forwarding the app's LangSmith key from the environment.
export function createAgentClient(userId: string): Client | null {
  const apiUrl = process.env.AGENT_URL;
  const secret = process.env.MDA_INGRESS_SECRET;
  if (!apiUrl || !secret) return null;
  return new Client({
    apiUrl,
    apiKey: null,
    defaultHeaders: { "x-mda-ingress-secret": secret, "x-mda-user-id": userId },
  });
}

// A thread belongs to one analysis. One started on another analysis, or one
// this user can't see, starts a fresh conversation instead of carrying over.
export async function resolveThread(client: Client, threadId: string | null, analysisId: string): Promise<string> {
  if (threadId) {
    const existing = await client.threads.get(threadId).catch(() => null);
    if (existing?.metadata?.analysis_id === analysisId) return existing.thread_id;
  }
  const thread = await client.threads.create({ metadata: { analysis_id: analysisId } });
  return thread.thread_id;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => isObject(block) && block.type === "text" && typeof block.text === "string" ? block.text : "").join("");
}

// Tokens from a subagent or from summarisation run inside a nested namespace;
// only the top-level model's words are the answer.
function isTopLevel(metadata: unknown): boolean {
  const namespace = isObject(metadata) ? metadata.langgraph_checkpoint_ns : undefined;
  return typeof namespace !== "string" || !namespace.includes("|");
}

function messagesOf(update: unknown): Json[] {
  if (!isObject(update)) return [];
  const { messages } = update;
  const list = Array.isArray(messages) ? messages : isObject(messages) && Array.isArray(messages.value) ? messages.value : [];
  return list.filter(isObject);
}

export async function* streamAnswer(client: Client, threadId: string, content: string, grant: string, signal: AbortSignal): AsyncGenerator<AskEvent> {
  const stream = client.runs.stream(threadId, ASSISTANT_ID, {
    input: { messages: [{ role: "user", content }] },
    // Tools read the grant from run context; it never enters the conversation.
    context: { toolToken: grant },
    streamMode: ["messages-tuple", "updates"],
    onDisconnect: "cancel",
    signal,
  });
  const announced = new Set<string>();
  for await (const part of stream) {
    const { event, data } = part as { event: string; data: unknown };
    if (event === "messages" && Array.isArray(data)) {
      const [chunk, metadata] = data;
      if (!isObject(chunk) || !isTopLevel(metadata)) continue;
      if (chunk.type !== "AIMessageChunk" && chunk.type !== "ai") continue;
      const text = textOf(chunk.content);
      if (text) yield { type: "text", text };
    } else if (event === "updates" && isObject(data)) {
      for (const message of Object.values(data).flatMap(messagesOf)) {
        if (message.type === "ai" && Array.isArray(message.tool_calls)) {
          for (const call of message.tool_calls) {
            if (!isObject(call) || typeof call.id !== "string" || typeof call.name !== "string" || announced.has(call.id)) continue;
            announced.add(call.id);
            yield { type: "tool", id: call.id, name: call.name, args: isObject(call.args) ? call.args : {} };
          }
        } else if (message.type === "tool" && typeof message.tool_call_id === "string") {
          yield { type: "tool_done", id: message.tool_call_id, ok: message.status !== "error" };
        }
      }
    } else if (event === "error") {
      const message = isObject(data) && typeof data.message === "string" ? data.message : "The agent run failed.";
      yield { type: "error", message };
    }
  }
}
