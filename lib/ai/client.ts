import "server-only";

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { traceable } from "langsmith/traceable";
import { wrapAnthropic } from "langsmith/wrappers/anthropic";

// The only place the model client is built. Anything constructing its own
// skips tracing without saying so.

// An exact model ID, never a "-latest" style alias. It is part of every cache
// key, so re-pinning invalidates only what this model wrote.
export const MODEL = "claude-opus-5-5";

let client: Anthropic | undefined;

function anthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in .env.local.");
    client = wrapAnthropic(new Anthropic({ apiKey }));
  }
  return client;
}

export type TracingStatus = { enabled: true; project: string } | { enabled: false; reason: string };

// Calls succeed without tracing, which otherwise looks exactly like a working
// setup with no traffic. The interface shows this.
export function tracingStatus(): TracingStatus {
  if (process.env.LANGSMITH_TRACING?.trim().toLowerCase() !== "true") {
    return { enabled: false, reason: "LANGSMITH_TRACING is not \"true\"" };
  }
  if (!process.env.LANGSMITH_API_KEY?.trim()) return { enabled: false, reason: "LANGSMITH_API_KEY is not set" };
  return { enabled: true, project: process.env.LANGSMITH_PROJECT?.trim() || "default" };
}

export interface ModelCache {
  read(key: string): Promise<unknown>;
  write(key: string, entry: { task: string; model: string; output: unknown }): Promise<void>;
}

export interface CompletionRequest {
  system: string;
  messages: Anthropic.MessageParam[];
  // For answers that are data rather than prose: the reply must match it.
  schema?: Record<string, unknown>;
  maxTokens: number;
}

export interface CachedTask<Input, Output> {
  name: string;
  // Bump when the prompt changes, so old answers to a different question miss.
  version: number;
  // Everything the answer depends on. Hashed with the model, name and version.
  keyOf(input: Input): unknown;
  // Only called on a miss, so expensive context (fetching source) is skipped on
  // a hit. Returns the call to make and how to read its reply; reading throws
  // when the reply is outside what the task permits.
  prepare(input: Input): Promise<{ request: CompletionRequest; read(text: string): Output }>;
  isOutput(value: unknown): value is Output;
}

export interface CachedResult<Output> {
  output: Output;
  cached: boolean;
}

function cacheKey(name: string, version: number, content: unknown): string {
  return createHash("sha256").update(JSON.stringify({ model: MODEL, name, version, content })).digest("hex");
}

// No refusal fallback: a different model answering would be stored under this
// model's cache key. A refusal is reported as a failure instead.
async function complete(request: CompletionRequest): Promise<string> {
  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: request.maxTokens,
    // Thinking can't be turned off on this model; low effort keeps it short.
    output_config: {
      effort: "low",
      ...(request.schema ? { format: { type: "json_schema", schema: request.schema } } : {}),
    },
    system: request.system,
    messages: request.messages,
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to answer.");
  if (response.stop_reason === "max_tokens") throw new Error("The model's answer was cut off at its token limit.");
  const text = response.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("").trim();
  if (!text) throw new Error(`The model returned no text (stop reason: ${response.stop_reason ?? "none"}).`);
  return text;
}

// The cache read happens inside the traced run, so a hit is recorded as a run
// with no model call in it. A cache read outside the trace would make a
// working cache and a broken one look the same.
export function cachedTask<Input, Output>(task: CachedTask<Input, Output>) {
  const run = traceable(
    async ({ input, cache }: { input: Input; cache: ModelCache }): Promise<CachedResult<Output>> => {
      const key = cacheKey(task.name, task.version, task.keyOf(input));
      const stored = await cache.read(key);
      if (task.isOutput(stored)) return { output: stored, cached: true };
      const { request, read } = await task.prepare(input);
      const output = read(await complete(request));
      await cache.write(key, { task: task.name, model: MODEL, output });
      return { output, cached: false };
    },
    {
      name: task.name,
      run_type: "chain",
      metadata: { model: MODEL, version: task.version },
      processInputs: (inputs) => ({ input: inputs.input }),
    },
  );
  return (input: Input, cache: ModelCache) => run({ input, cache });
}
