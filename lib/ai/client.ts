import "server-only";

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "langsmith";
import type { RunTree } from "langsmith/run_trees";
import { getCurrentRunTree, traceable } from "langsmith/traceable";
import { wrapAnthropic } from "langsmith/wrappers/anthropic";
import OpenAI from "openai";

// The only place model clients are built. Anything constructing its own
// skips tracing without saying so.

export type Provider = "anthropic" | "openai";
export const PROVIDERS: readonly Provider[] = ["anthropic", "openai"];
export const PROVIDER_LABELS: Record<Provider, string> = { anthropic: "Claude", openai: "OpenAI" };

export function isProvider(value: unknown): value is Provider {
  return value === "anthropic" || value === "openai";
}

// Exact model IDs, never a "-latest" style alias. Choosing a provider chooses
// its model. The model and provider are part of every cache key, so
// re-pinning invalidates only what that model wrote.
export const MODELS: Record<Provider, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-5.5-2026-04-23",
};

// Grades explanations in the evals. A different model from any being
// measured, and fixed whichever provider is: a judge that moves with the
// subject measures nothing.
export const JUDGE_MODEL = "claude-sonnet-5-5";

// Who pays for a call. The key itself never leaves server code: not into a
// trace, a log, an error message or the browser.
export interface ModelChoice {
  provider: Provider;
  model: string;
  apiKey: string;
  source: "organization" | "app";
}

const APP_KEY_VARIABLES: Record<Provider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

// The app's own key, for organizations without one and for the evals.
export function appChoice(provider: Provider = "anthropic", model: string = MODELS[provider]): ModelChoice {
  const variable = APP_KEY_VARIABLES[provider];
  const apiKey = process.env[variable]?.trim();
  if (!apiKey) throw new Error(`${variable} is not set in .env.local.`);
  return { provider, model, apiKey, source: "app" };
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
  messages: { role: "user" | "assistant"; content: string }[];
  // For answers that are data rather than prose: the reply must match it.
  // Written to OpenAI's strict rules (every property required, no extras),
  // which Anthropic also accepts.
  schema?: Record<string, unknown>;
  maxTokens: number;
}

// Context reaches prepare but never the trace: it may carry a credential, such
// as the GitHub token a source read needs.
export interface CachedTask<Input, Output, Context = void> {
  name: string;
  // Bump when the prompt changes, so old answers to a different question miss.
  version: number;
  // Everything the answer depends on. Hashed with the model, name and version.
  keyOf(input: Input): unknown;
  // Only called on a miss, so expensive context (fetching source) is skipped on
  // a hit. Returns the call to make and how to read its reply; reading throws
  // when the reply is outside what the task permits.
  prepare(input: Input, context: Context): Promise<{ request: CompletionRequest; read(text: string): Output }>;
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

function cacheKey(choice: ModelChoice, name: string, version: number, content: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ provider: choice.provider, model: choice.model, name, version, content }))
    .digest("hex");
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

// Provider errors can quote the key back (OpenAI's 401 echoes a masked one),
// so anything key-shaped is removed before the message goes anywhere.
function redact(message: string, apiKey: string): string {
  return message.split(apiKey).join("[key]").replace(/\bsk-[A-Za-z0-9_*.\-]+/g, "[key]");
}

// The provider's own sentence, without the status prefix and JSON around it.
function providerMessage(cause: InstanceType<typeof Anthropic.APIError> | InstanceType<typeof OpenAI.APIError>): string {
  const body: unknown = cause.error;
  const inner = typeof body === "object" && body !== null && "error" in body ? body.error : body;
  return typeof inner === "object" && inner !== null && "message" in inner && typeof inner.message === "string" ? inner.message : cause.message;
}

function providerFailure(cause: unknown, choice: ModelChoice): Error {
  const name = PROVIDER_LABELS[choice.provider];
  const whose = choice.source === "organization" ? "the organization's" : "the app's";
  if (!(cause instanceof Anthropic.APIError) && !(cause instanceof OpenAI.APIError)) {
    return new Error(redact(cause instanceof Error ? cause.message : String(cause), choice.apiKey));
  }
  const message = redact(providerMessage(cause), choice.apiKey);
  const reason = cause.status === 401 ? `${name} rejected ${whose} key`
    : cause.status === 403 ? `${name} refused ${whose} key access`
    : cause.status === 404 ? `${choice.model} is not available to ${whose} ${name} key`
    : cause.status === 429 ? `${name} rate limit or quota reached on ${whose} key`
    : `${name} returned an error`;
  return new Error(`${reason}. ${message}`);
}

type Caller = (request: CompletionRequest) => Promise<string>;

function anthropicCaller(choice: ModelChoice): Caller {
  const anthropic = wrapAnthropic(new Anthropic({ apiKey: choice.apiKey }));
  return async (request) => {
    const response = await anthropic.messages.create({
      model: choice.model,
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
  };
}

// Traced by hand rather than with LangSmith's OpenAI wrapper, because the
// wrapper records the provider's raw error, and OpenAI's quotes the key.
function openaiCaller(choice: ModelChoice): Caller {
  const openai = new OpenAI({ apiKey: choice.apiKey });
  return traceable(async (request: CompletionRequest) => {
    try {
      const response = await openai.responses.create({
        model: choice.model,
        max_output_tokens: request.maxTokens,
        reasoning: { effort: "low" },
        instructions: request.system,
        input: request.messages,
        ...(request.schema ? { text: { format: { type: "json_schema", name: "answer", strict: true, schema: request.schema } } } : {}),
      });
      const refused = response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
      if (refused) throw new Error("The model declined to answer.");
      if (response.status === "incomplete") {
        throw new Error(response.incomplete_details?.reason === "max_output_tokens"
          ? "The model's answer was cut off at its token limit."
          : `The model stopped early (${response.incomplete_details?.reason ?? "no reason given"}).`);
      }
      const text = response.output_text.trim();
      if (!text) throw new Error(`The model returned no text (status: ${response.status ?? "none"}).`);
      return text;
    } catch (cause) {
      throw providerFailure(cause, choice);
    }
  }, {
    client: tracingClient(),
    name: "OpenAI",
    run_type: "llm",
    metadata: { ls_provider: "openai", ls_model_name: choice.model },
  });
}

const callers = new Map<string, Caller>();

// One client per provider, model and key, built on first use. Keyed on a
// hash so the key isn't held as a map key.
function callerFor(choice: ModelChoice): Caller {
  const id = createHash("sha256").update(JSON.stringify([choice.provider, choice.model, choice.source, choice.apiKey])).digest("hex");
  let caller = callers.get(id);
  if (!caller) {
    caller = choice.provider === "anthropic" ? anthropicCaller(choice) : openaiCaller(choice);
    callers.set(id, caller);
  }
  return caller;
}

// No fallback of any kind: not to another model, which would be stored under
// this model's cache key, and not to another key, which would bill someone
// else and hide a broken setup. A failure is reported as a failure.
export async function complete(request: CompletionRequest, choice: ModelChoice): Promise<string> {
  try {
    return await callerFor(choice)(request);
  } catch (cause) {
    throw providerFailure(cause, choice);
  }
}

// Proves a key works for its provider's pinned model before it is saved.
// Reads the model's metadata, which costs no tokens; not a model call, so it
// isn't traced.
export async function verifyKey(provider: Provider, apiKey: string): Promise<void> {
  const choice: ModelChoice = { provider, model: MODELS[provider], apiKey, source: "organization" };
  try {
    if (provider === "anthropic") await new Anthropic({ apiKey, maxRetries: 0 }).models.retrieve(choice.model);
    else await new OpenAI({ apiKey, maxRetries: 0 }).models.retrieve(choice.model);
  } catch (cause) {
    throw providerFailure(cause, choice);
  }
}

// The cache read happens inside the traced run, so a hit is recorded as a run
// with no model call in it. A cache read outside the trace would make a
// working cache and a broken one look the same.
export function cachedTask<Input, Output, Context = void>(task: CachedTask<Input, Output, Context>) {
  const run = traceable(
    async ({ input, cache, choice, context, trace }: {
      input: Input; cache: ModelCache; choice: ModelChoice; context: Context; trace: { run?: RunTree };
    }): Promise<CachedResult<Output>> => {
      const key = cacheKey(choice, task.name, task.version, task.keyOf(input));
      const stored = await cache.read(key);
      const result: CachedResult<Output> = task.isOutput(stored) ? { output: stored, cached: true } : await (async () => {
        const { request, read } = await task.prepare(input, context);
        const output = read(await complete(request, choice));
        await cache.write(key, { task: task.name, model: choice.model, output });
        return { output, cached: false };
      })();
      trace.run = getCurrentRunTree(true);
      return result;
    },
    {
      client: tracingClient(),
      name: task.name,
      run_type: "chain",
      metadata: { version: task.version },
      // Named fields only: the choice carries the key, the context may carry a token.
      processInputs: (inputs) => {
        const choice: unknown = inputs.choice;
        if (typeof choice !== "object" || choice === null) return { input: inputs.input };
        const { provider, model, source } = choice as Record<string, unknown>;
        return { input: inputs.input, provider, model, key: source };
      },
    },
  );
  return async (input: Input, cache: ModelCache, choice: ModelChoice, context: Context): Promise<CachedResult<Output>> => {
    const trace: { run?: RunTree } = {};
    const result = await run({ input, cache, choice, context, trace });
    // Scored once the run has ended, so the feedback has a finished run to attach to.
    if (trace.run && task.liveChecks) void recordChecks(trace.run, task.liveChecks(input, result.output));
    return result;
  };
}
