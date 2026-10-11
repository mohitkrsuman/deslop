import "../scripts/load-env.mts";

import { createHash } from "node:crypto";
import { evaluate } from "langsmith/evaluation";
import { classifyFile, excerptOf, type ClassifyInput } from "../lib/ai/classify.ts";
import { PROVIDER_LABELS } from "../lib/ai/client.ts";
import { fetchFileAtCommit, parseGithubUrl } from "../lib/github-archive.ts";
import { MODEL_ASSIGNABLE_ROLES, isModelAssignableRole } from "../lib/taxonomy.mts";
import { NO_CACHE, ensureDataset, finishedAnalyses, flag, graphOf, langsmith, measuredModel, percent, type DatasetExample } from "./shared.mts";

// Files convention already labelled never reach the classifier in normal
// operation, so their roles are held-out ground truth. Only roles the
// classifier may return are in the set: scoring it on page or route, which it
// is forbidden to answer, would measure nothing.

const DATASET = "deslop-role-accuracy";
const PER_ROLE = 12;
const MINIMUM = 30;

async function build(): Promise<DatasetExample[]> {
  const candidates: { example: DatasetExample; role: string; order: string; fetch: () => Promise<Buffer | null> }[] = [];
  for (const analysis of await finishedAnalyses()) {
    const graph = await graphOf(analysis);
    const fromModel = new Set(graph.modelRoles);
    const imports = new Map<string, Set<string>>();
    for (const edge of graph.edges) imports.set(edge.from, (imports.get(edge.from) ?? new Set()).add(edge.to));
    const repository = parseGithubUrl(analysis.repositoryUrl);
    for (const file of graph.files) {
      if (!isModelAssignableRole(file.kind) || fromModel.has(file.path)) continue;
      candidates.push({
        role: file.kind,
        // Stable but unrelated to path, so one folder doesn't fill a role's quota.
        order: createHash("sha256").update(`${analysis.id}:${file.path}`).digest("hex"),
        fetch: () => fetchFileAtCommit(repository, analysis.commitSha, file.path, null),
        example: {
          inputs: { path: file.path, sha256: file.sha256, imports: [...imports.get(file.path) ?? []].sort() },
          outputs: { role: file.kind },
          metadata: { repository: analysis.name, commit: analysis.commitSha, adapter: analysis.adapter },
        },
      });
    }
  }

  const examples: DatasetExample[] = [];
  let unreadable = 0;
  for (const role of MODEL_ASSIGNABLE_ROLES) {
    const pool = candidates.filter((candidate) => candidate.role === role).sort((left, right) => left.order.localeCompare(right.order));
    let taken = 0;
    for (const candidate of pool) {
      if (taken >= PER_ROLE) break;
      const bytes = await candidate.fetch();
      if (!bytes || createHash("sha256").update(bytes).digest("hex") !== candidate.example.inputs.sha256) {
        unreadable += 1;
        continue;
      }
      examples.push({ ...candidate.example, inputs: { ...candidate.example.inputs, excerpt: excerptOf(bytes.toString("utf8")) } });
      taken += 1;
    }
    console.log(`  ${role}: ${taken} of ${pool.length} available`);
  }
  if (unreadable > 0) console.log(`  ${unreadable} files skipped: missing at their commit or not matching the stored hash.`);
  if (examples.length < MINIMUM) {
    throw new Error(`Only ${examples.length} convention-labelled files with an assignable role; at least ${MINIMUM} are needed. Analyse more repositories.`);
  }
  return examples;
}

function asClassifyInput(inputs: Record<string, unknown>): ClassifyInput {
  const { path, sha256, imports, excerpt } = inputs;
  if (typeof path !== "string" || typeof sha256 !== "string" || typeof excerpt !== "string" ||
      !Array.isArray(imports) || !imports.every((item) => typeof item === "string")) {
    throw new Error("Dataset example is not a classification input.");
  }
  return { path, sha256, imports, excerpt };
}

function roleCorrect({ outputs, referenceOutputs }: { outputs: Record<string, unknown>; referenceOutputs?: Record<string, unknown> }) {
  return {
    key: "role_correct",
    score: outputs.role === referenceOutputs?.role ? 1 : 0,
    comment: `expected ${String(referenceOutputs?.role)}, answered ${String(outputs.role)}`,
  };
}

const choice = measuredModel();
const client = langsmith();
await ensureDataset(client, DATASET, "Files whose role convention assigned, with the role hidden. Ground truth for the classifier.", flag("--rebuild"), build);

const results = await evaluate(
  async (inputs: Record<string, unknown>) => (await classifyFile(asClassifyInput(inputs), NO_CACHE, choice)).output,
  {
    data: DATASET,
    client,
    experimentPrefix: `role-accuracy-${choice.provider}-${choice.model}`,
    metadata: { provider: choice.provider, model: choice.model },
    maxConcurrency: 4,
    evaluators: [roleCorrect],
  },
);

const byRole = new Map<string, { right: number; total: number; answers: Map<string, number> }>();
let right = 0;
for (const row of results.results) {
  const expected = String(row.example.outputs?.role);
  const answered = String(row.run.outputs?.role ?? "error");
  const tally = byRole.get(expected) ?? { right: 0, total: 0, answers: new Map() };
  tally.total += 1;
  if (answered === expected) {
    tally.right += 1;
    right += 1;
  } else tally.answers.set(answered, (tally.answers.get(answered) ?? 0) + 1);
  byRole.set(expected, tally);
}

console.log(`\nRole accuracy, ${PROVIDER_LABELS[choice.provider]} ${choice.model}: ${right} of ${results.results.length} (${percent(right, results.results.length)})  experiment ${results.experimentName}`);
for (const [role, tally] of byRole) {
  const misses = [...tally.answers].map(([answer, count]) => `${answer} ×${count}`).join(", ");
  console.log(`  ${role.padEnd(11)} ${String(tally.right).padStart(3)}/${tally.total}  ${misses && `missed as ${misses}`}`);
}
console.log("\nThese files' paths follow the conventions that labelled them, so the path itself is a strong hint; this measures agreement with convention, not insight.");
