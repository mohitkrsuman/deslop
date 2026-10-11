import "../scripts/load-env.mts";

import { fileShownPaths, folderShownPaths } from "../lib/ai/explain.ts";
import { findInventedPaths } from "../lib/ai/invented-paths.ts";
import { langsmith, option, percent, projectName } from "./shared.mts";

// Re-scores recent real explanations from the traces: the same check the app
// records live on every run, run here over a window you can read through.
// --project <name> reads another tracing project. --splice <path> adds a made-up path to every explanation first; every one
// should then fail, which shows the check catches what it claims to.

const limit = Number(option("--limit") ?? 50);
const splice = option("--splice");
const project = option("--project") ?? projectName();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function paths(value: unknown): { path: string }[] {
  return Array.isArray(value) ? value.flatMap((item) => typeof record(item)?.path === "string" ? [{ path: String(record(item)!.path) }] : []) : [];
}

function folders(value: unknown): { folder: string }[] {
  return Array.isArray(value) ? value.flatMap((item) => typeof record(item)?.folder === "string" ? [{ folder: String(record(item)!.folder) }] : []) : [];
}

// What the model was shown, rebuilt from the run's logged input with the
// same functions the app uses.
function shownFor(name: string, input: Record<string, unknown>): { subject: string; shown: string[] } | null {
  if (name === "explain-file" && typeof input.path === "string") {
    return { subject: input.path, shown: fileShownPaths({ path: input.path, imports: paths(input.imports), importedBy: paths(input.importedBy) }) };
  }
  if (name === "explain-folder" && typeof input.folder === "string") {
    return {
      subject: `${input.folder}/`,
      shown: folderShownPaths({ folder: input.folder, files: paths(input.files), incoming: folders(input.incoming), outgoing: folders(input.outgoing) }),
    };
  }
  return null;
}

function sentenceAround(text: string, needle: string): string {
  const at = text.indexOf(needle);
  if (at < 0) return "";
  const start = Math.max(text.lastIndexOf(".", at - 1) + 1, at - 160);
  const end = Math.min(text.length, at + needle.length + 120);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

const client = langsmith();
const { id: projectId } = await client.readProject({ projectName: project });
const seen = new Set<string>();
const failures: { runId: string; started: string; subject: string; invented: string[]; context: string; shownCount: number }[] = [];
let runs = 0;
let skipped = 0;
let strict = 0;
let literals = 0;

for await (const run of client.runs.query({
  project_ids: [projectId],
  is_root: true,
  min_start_time: new Date(Date.now() - Number(option("--days") ?? 30) * 86_400_000).toISOString(),
  filter: 'or(eq(name, "explain-file"), eq(name, "explain-folder"))',
  selects: ["ID", "NAME", "START_TIME", "INPUTS", "OUTPUTS"],
  page_size: 100,
})) {
  if (runs >= limit) break;
  runs += 1;
  const input = record(record(run.inputs)?.input);
  const output = record(record(run.outputs)?.output);
  const text = output?.text;
  const recorded = Array.isArray(output?.sourcePaths) ? output.sourcePaths.filter((item): item is string => typeof item === "string") : null;
  const shown = input && run.name ? shownFor(run.name, input) : null;
  if (!shown || typeof text !== "string") {
    skipped += 1;
    continue;
  }
  // Cache hits repeat the same answer; each distinct explanation is scored once.
  const identity = `${run.name}\0${shown.subject}\0${text}`;
  if (seen.has(identity)) continue;
  seen.add(identity);

  const scored = splice ? `${text}\n\nIt also hands off to \`${splice}\`.` : text;
  // Explanations cached before source paths were recorded are checked strictly.
  if (run.name === "explain-file" && recorded === null) strict += 1;
  const { invented, fromSource } = findInventedPaths(scored, shown.shown, recorded ?? []);
  literals += fromSource.length > 0 ? 1 : 0;
  if (invented.length > 0) {
    failures.push({
      runId: run.id ?? "?", started: run.start_time ?? "?", subject: shown.subject, invented,
      context: sentenceAround(scored, invented[0]), shownCount: shown.shown.length,
    });
  }
}

const distinct = seen.size;
console.log(`Project "${project}": ${runs} recent explanation runs, ${distinct} distinct explanations${skipped ? `, ${skipped} unreadable and skipped` : ""}.`);
if (literals > 0) console.log(`${literals} named a path found only in their source (an import the parser doesn't follow, a file a script writes); counted as shown.`);
if (strict > 0) console.log(`${strict} file explanations predate source-path recording and were checked against resolved paths only.`);
if (splice) console.log(`Spliced "${splice}" into every explanation before checking.`);
if (distinct === 0) {
  console.error("No explanations to check. Explain a file in the app first.");
  process.exit(1);
}
console.log(`Named only paths they were shown: ${distinct - failures.length} of ${distinct} (${percent(distinct - failures.length, distinct)}).`);
for (const failure of failures) {
  console.log(`\n✗ ${failure.subject}  run ${failure.runId}  ${failure.started}`);
  console.log(`  named but never shown: ${failure.invented.join(", ")}  (shown ${failure.shownCount} paths)`);
  console.log(`  "${failure.context}"`);
}
