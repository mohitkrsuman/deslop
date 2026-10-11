import "../scripts/load-env.mts";

import { createHash } from "node:crypto";
import { evaluate } from "langsmith/evaluation";
import type { EvaluationResult } from "langsmith/evaluation";
import { JUDGE_MODEL, MODEL, complete } from "../lib/ai/client.ts";
import { EXPLAIN_FILE_SYSTEM, fileExplainInput, fileExplanationMessage, fileShownPaths, sourceFor, type FileExplainInput } from "../lib/ai/explain.ts";
import { inventedPathCheck, pathsInSource } from "../lib/ai/invented-paths.ts";
import type { ImportKind } from "../lib/parser/types.mts";
import { RETIRED_EXPLAIN_FILE_SYSTEM } from "./retired-prompts.mts";
import { ensureDataset, finishedAnalyses, flag, graphOf, langsmith, percent, type DatasetExample } from "./shared.mts";

// The shipped explanation prompt against a retired one, as two experiments
// over one dataset. Invented paths are counted exactly. Specificity is not
// countable: "is this specific enough to be useful" has no exact answer, so a
// second model judges it. That number is a model's opinion and is labelled so
// everywhere it appears.

const DATASET = "deslop-explanations";
const PER_ANALYSIS = 6;
const TOTAL = 24;

async function build(): Promise<DatasetExample[]> {
  const examples: DatasetExample[] = [];
  for (const analysis of await finishedAnalyses()) {
    if (examples.length >= TOTAL) break;
    const graph = await graphOf(analysis);
    const connected = new Set(graph.edges.flatMap((edge) => [edge.from, edge.to]));
    const pool = graph.files.filter((file) => connected.has(file.path))
      .map((file) => ({ file, order: createHash("sha256").update(`${analysis.id}:${file.path}`).digest("hex") }))
      .sort((left, right) => left.order.localeCompare(right.order));
    let taken = 0;
    for (const { file } of pool) {
      if (taken >= PER_ANALYSIS || examples.length >= TOTAL) break;
      const input = fileExplainInput(analysis, graph.files, graph.edges, file);
      // A file whose source can't be fetched at its commit would fail in both
      // experiments alike; leave it out rather than score an error.
      try { await sourceFor(input); } catch { continue; }
      examples.push({ inputs: { ...input }, metadata: { repository: analysis.name } });
      taken += 1;
    }
  }
  if (examples.length === 0) throw new Error("No analysed files with neighbours to explain. Analyse a repository first.");
  return examples;
}

function isNeighbours(value: unknown): value is { path: string; role: string; kinds: ImportKind[] }[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null &&
    typeof item.path === "string" && typeof item.role === "string" && Array.isArray(item.kinds));
}

function asFileExplainInput(inputs: Record<string, unknown>): FileExplainInput {
  const { repository, framework, path, role, sha256, lineCount, imports, importedBy, origin } = inputs;
  const where = typeof origin === "object" && origin !== null ? origin as Record<string, unknown> : {};
  if (typeof repository !== "string" || (framework !== null && typeof framework !== "string") || typeof path !== "string" ||
      typeof role !== "string" || typeof sha256 !== "string" || typeof lineCount !== "number" ||
      !isNeighbours(imports) || !isNeighbours(importedBy) ||
      typeof where.repositoryUrl !== "string" || typeof where.commitSha !== "string") {
    throw new Error("Dataset example is not an explanation input.");
  }
  return { repository, framework, path, role, sha256, lineCount, imports, importedBy,
    origin: { repositoryUrl: where.repositoryUrl, commitSha: where.commitSha } };
}

function explainWith(system: string) {
  return async (inputs: Record<string, unknown>) => {
    const input = asFileExplainInput(inputs);
    const { source, notes } = await sourceFor(input);
    const text = await complete({ system, maxTokens: 16000, messages: [{ role: "user", content: fileExplanationMessage(input, source, notes) }] });
    return { text, sourcePaths: pathsInSource(source) };
  };
}

const JUDGE_SYSTEM = [
  "You grade one explanation of a source file, written for a developer opening that file for the first time.",
  "Score how specific it is, on 1 to 5:",
  "1: generic; it could describe almost any file.",
  "2: names the file's general area but little about what it actually does.",
  "3: says concretely what the file does, but not how it fits among the files around it.",
  "4: concrete about what it does and about the part its neighbours play.",
  "5: as 4, and a developer could act on it without opening the file first.",
  "Ignore formatting; plain prose and markdown are equally acceptable. Do not reward length.",
].join("\n");

async function specificity({ inputs, outputs }: { inputs: Record<string, unknown>; outputs: Record<string, unknown> }): Promise<EvaluationResult> {
  if (typeof outputs.text !== "string") return { key: "specificity", comment: "No explanation to judge." };
  const input = asFileExplainInput(inputs);
  const list = (items: { path: string }[]) => items.length > 0 ? items.map((item) => `- ${item.path}`).join("\n") : "(none)";
  const reply = await complete({
    system: JUDGE_SYSTEM,
    maxTokens: 4000,
    schema: {
      type: "object", additionalProperties: false, required: ["score", "reason"],
      properties: { score: { type: "integer", enum: [1, 2, 3, 4, 5] }, reason: { type: "string" } },
    },
    messages: [{
      role: "user",
      content: [
        `File: ${input.path} (${input.role})`, "It imports:", list(input.imports), "It is imported by:", list(input.importedBy),
        "", "<explanation>", outputs.text, "</explanation>",
      ].join("\n"),
    }],
  }, JUDGE_MODEL);
  const parsed: unknown = JSON.parse(reply);
  const score = typeof parsed === "object" && parsed !== null && "score" in parsed ? parsed.score : null;
  const reason = typeof parsed === "object" && parsed !== null && "reason" in parsed ? String(parsed.reason) : "";
  if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) throw new Error(`Judge answered outside 1-5: ${reply}`);
  return { key: "specificity", score, comment: `${score}/5, judged by ${JUDGE_MODEL} (a model's opinion): ${reason}` };
}

function noInventedPaths({ inputs, outputs }: { inputs: Record<string, unknown>; outputs: Record<string, unknown> }): EvaluationResult {
  if (typeof outputs.text !== "string") return { key: "no_invented_paths", comment: "No explanation to check." };
  const sourcePaths = Array.isArray(outputs.sourcePaths) ? outputs.sourcePaths.filter((item) => typeof item === "string") : [];
  return inventedPathCheck(outputs.text, fileShownPaths(asFileExplainInput(inputs)), sourcePaths);
}

const client = langsmith();
await ensureDataset(client, DATASET, "Real files from analysed repositories, with the neighbours the parser resolved.", flag("--rebuild"), build);

const versions = [
  { name: "current", system: EXPLAIN_FILE_SYSTEM },
  { name: "retired", system: RETIRED_EXPLAIN_FILE_SYSTEM },
] as const;

const scores = new Map<string, Map<string, { specificity?: number; clean?: number }>>();
const experiments: string[] = [];
for (const version of versions) {
  const results = await evaluate(explainWith(version.system), {
    data: DATASET,
    client,
    experimentPrefix: `explain-file-${version.name}`,
    description: `Explanation prompt: ${version.name}. Specificity is scored by ${JUDGE_MODEL}, a model judging a model; no_invented_paths is exact.`,
    metadata: { prompt: version.name, model: MODEL, judge: JUDGE_MODEL },
    maxConcurrency: 4,
    evaluators: [noInventedPaths, specificity],
  });
  experiments.push(results.experimentName);
  const byExample = new Map<string, { specificity?: number; clean?: number }>();
  for (const row of results.results) {
    const entry: { specificity?: number; clean?: number } = {};
    for (const result of row.evaluationResults.results) {
      if (typeof result.score !== "number") continue;
      if (result.key === "specificity") entry.specificity = result.score;
      if (result.key === "no_invented_paths") entry.clean = result.score;
    }
    byExample.set(row.example.id, entry);
  }
  scores.set(version.name, byExample);
}

const current = scores.get("current")!;
const retired = scores.get("retired")!;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const differences: number[] = [];
for (const [example, score] of current) {
  const other = retired.get(example);
  if (score.specificity !== undefined && other?.specificity !== undefined) differences.push(score.specificity - other.specificity);
}
const clean = (map: typeof current) => {
  const values = [...map.values()].flatMap((score) => score.clean === undefined ? [] : [score.clean]);
  return `${values.filter((value) => value === 1).length} of ${values.length} (${percent(values.filter((value) => value === 1).length, values.length)})`;
};
const specific = (map: typeof current) => {
  const values = [...map.values()].flatMap((score) => score.specificity === undefined ? [] : [score.specificity]);
  return values.length > 0 ? `${mean(values).toFixed(2)} / 5 over ${values.length}` : "n/a";
};

console.log(`\nExperiments: ${experiments.join(" vs ")} on "${DATASET}". Compare them side by side from the dataset's Experiments tab.`);
console.log(`                     current            retired`);
console.log(`no invented paths    ${clean(current).padEnd(19)}${clean(retired)}   (exact)`);
console.log(`specificity          ${specific(current).padEnd(19)}${specific(retired)}   (judged by ${JUDGE_MODEL})`);

if (differences.length === 0) {
  console.error("\nNo example was scored in both experiments; nothing to compare.");
  process.exit(1);
}
const average = mean(differences);
const spread = differences.length > 1
  ? Math.sqrt(differences.reduce((sum, value) => sum + (value - average) ** 2, 0) / (differences.length - 1)) : 0;
const margin = 1.96 * spread / Math.sqrt(differences.length);
const wins = differences.filter((value) => value > 0).length;
const losses = differences.filter((value) => value < 0).length;
console.log(`\nPaired over ${differences.length} files: current scored higher on ${wins}, lower on ${losses}, the same on ${differences.length - wins - losses}.`);
console.log(`Current minus retired: ${average >= 0 ? "+" : ""}${average.toFixed(2)} points on the 1-5 scale (95% interval ${(average - margin).toFixed(2)} to ${(average + margin).toFixed(2)}).`);
console.log(average - margin > 0 ? "Current is better on judged specificity."
  : average + margin < 0 ? "Retired is better on judged specificity."
    : "No clear difference in judged specificity at this sample size.");
console.log(`That gap is ${JUDGE_MODEL}'s opinion of usefulness, not a measurement; the invented-path rates above are exact.`);
