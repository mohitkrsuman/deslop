import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { createMiddleware } from "langchain";
import { agentContextSchema } from "./client";

// The app's own model for Ask, used when the organization has saved no key.
// The same pinned snapshot the app uses for OpenAI; never a moving alias.
export const APP_MODEL = "gpt-5.5-2026-04-23";

// Which key pays is decided per question, by the app, from the grant. A model
// call that skips that decision must not quietly run on the app's key, so the
// agent's static model holds no real key: OpenAI rejects it, naming it. Deep
// Agents' summarisation step sits outside custom middleware and uses the
// static model, so in a conversation long enough to need summarising, that
// rejection is what shows rather than a bill to the wrong party.
export const unselectedModel = new ChatOpenAI({
  model: APP_MODEL,
  apiKey: "no-key-selected-for-this-question",
  maxRetries: 0,
});

type ModelKey =
  | { source: "app" }
  | { source: "organization"; provider: "anthropic" | "openai"; model: string; apiKey: string };

function isModelKey(value: unknown): value is ModelKey {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  if (body.source === "app") return true;
  return body.source === "organization" && (body.provider === "anthropic" || body.provider === "openai")
    && typeof body.model === "string" && typeof body.apiKey === "string";
}

// Provider errors can quote the key back, so anything key-shaped goes.
function redact(message: string, apiKey: string | undefined): string {
  const withoutKey = apiKey ? message.split(apiKey).join("[key]") : message;
  return withoutKey.replace(/\bsk-[A-Za-z0-9_*.\-]+/g, "[key]");
}

// One lookup per grant. A grant lives ten minutes, so the model (and the key
// inside it) is dropped after that and never outlives the question.
const GRANT_LIFETIME_MS = 10 * 60 * 1000;
const models = new Map<string, Promise<{ model: BaseChatModel; apiKey?: string }>>();

async function lookUp(token: string): Promise<{ model: BaseChatModel; apiKey?: string }> {
  const base = process.env.CARTOGRAPH_TOOL_API_URL;
  if (!base) throw new Error("CARTOGRAPH_TOOL_API_URL is not set.");
  const response = await fetch(`${base.replace(/\/$/, "")}/model-key`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = typeof body === "object" && body !== null && "error" in body ? String(body.error) : `status ${response.status}`;
    throw new Error(`Could not get this organization's model key: ${reason}`);
  }
  if (!isModelKey(body)) throw new Error("The app returned a model key this agent doesn't understand.");
  if (body.source === "app") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set in deslop-agent/.env.");
    return { model: new ChatOpenAI({ model: APP_MODEL, apiKey }), apiKey };
  }
  const model = body.provider === "anthropic"
    ? new ChatAnthropic({ model: body.model, apiKey: body.apiKey })
    : new ChatOpenAI({ model: body.model, apiKey: body.apiKey });
  return { model, apiKey: body.apiKey };
}

function modelForGrant(token: string) {
  let found = models.get(token);
  if (!found) {
    found = lookUp(token);
    models.set(token, found);
    found.catch(() => models.delete(token));
    setTimeout(() => models.delete(token), GRANT_LIFETIME_MS).unref();
  }
  return found;
}

// Every model call the agent and its subagent make goes through here. No
// fallback: if the organization's key fails, the question fails and says why.
export const selectModel = createMiddleware({
  name: "SelectModelForGrant",
  contextSchema: agentContextSchema,
  wrapModelCall: async (request, handler) => {
    const token = request.runtime.context?.toolToken;
    if (!token) throw new Error("This run has no grant, so no model key can be chosen.");
    const { model, apiKey } = await modelForGrant(token);
    try {
      return await handler({ ...request, model });
    } catch (cause) {
      throw new Error(redact(cause instanceof Error ? cause.message : String(cause), apiKey));
    }
  },
});
