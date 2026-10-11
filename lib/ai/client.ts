import "server-only";

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "langsmith";
import type { RunTree } from "langsmith/run_trees";
import { getCurrentRunTree, traceable } from "langsmith/traceable";
import { wrapAnthropic } from "langsmith/wrappers/anthropic";

// The only place the model client is built. Anything constructing its own
// skips tracing without saying so.

// An exact model ID, never a "-latest" style alias. It is part of every cache
// key, so re-pinning invalidates only what this model wrote.
export const MODEL = "claude-opus-5-5";

// Grades explanations in the evals. A different model from MODEL, so it isn't
// marking its own writing.
export const JUDGE_MODEL = "claude-sonnet-5-5";

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
  // Deterministic checks scored on every run, cache hits included, and
  // recorded as feedback on that run: evaluation of real traffic.
  liveChecks?(input: Input, output: Output): LiveCheck[];
}

export interface LiveCheck {
  key: string;
  score: number;
  comment: string;
}

export interface CachedResult<Output> {
  output: Output;
  cached: boolean;
}

function cacheKey(name: string, version: number, content: unknown): string {
  return createHash("sha256").update(JSON.stringify({ model: MODEL, name, version, content })).digest("hex");
}

let tracer: Client | undefined;

function tracingClient(): Client {
  tracer ??= new Client();
  return tracer;
}

const projectIds = new Map<string, Promise<string>>();

// Feedback is recorded after the answer is returned and never fails the call;
// a failure to record is logged, not swallowed.
async function recordChecks(run: RunTree, checks: LiveCheck[]) {
  const projectName = run.project_name;
  if (!tracingStatus().enabled || !projectName || checks.length === 0) return;
  try {
    if (!projectIds.has(projectName)) {
      projectIds.set(projectName, tracingClient().readProject({ projectName }).then((project) => project.id));
    }
    const sessionId = await projectIds.get(projectName)!;
    await Promise.all(checks.map((check) => tracingClient().createFeedback({
      runId: run.id, sessionId, key: check.key, score: check.score, comment: check.comment,
      feedbackSourceType: "api", startTime: run.start_time,
    })));
  } catch (cause) {
    projectIds.delete(projectName);
    console.error(`Could not record live checks on run ${run.id}:`, cause);
  }
}

// No refusal fallback: a different model answering would be stored under this
// model's cache key. A refusal is reported as a failure instead.
export async function complete(request: CompletionRequest, model: string = MODEL): Promise<string> {
  const response = await anthropic().messages.create({
    model,
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
    async ({ input, cache, trace }: { input: Input; cache: ModelCache; trace: { run?: RunTree } }): Promise<CachedResult<Output>> => {
      const key = cacheKey(task.name, task.version, task.keyOf(input));
      const stored = await cache.read(key);
      const result: CachedResult<Output> = task.isOutput(stored) ? { output: stored, cached: true } : await (async () => {
        const { request, read } = await task.prepare(input);
        const output = read(await complete(request));
        await cache.write(key, { task: task.name, model: MODEL, output });
        return { output, cached: false };
      })();
      trace.run = getCurrentRunTree(true);
      return result;
    },
    {
      client: tracingClient(),
      name: task.name,
      run_type: "chain",
      metadata: { model: MODEL, version: task.version },
      processInputs: (inputs) => ({ input: inputs.input }),
    },
  );
  return async (input: Input, cache: ModelCache): Promise<CachedResult<Output>> => {
    const trace: { run?: RunTree } = {};
    const result = await run({ input, cache, trace });
    // Scored once the run has ended, so the feedback has a finished run to attach to.
    if (trace.run && task.liveChecks) void recordChecks(trace.run, task.liveChecks(input, result.output));
    return result;
  };
}
