import "server-only";

import { createHash } from "node:crypto";
import { cachedTask } from "@/lib/ai/client";
import type { Folding } from "@/lib/canvas/fold";
import { fetchFileAtCommit, parseGithubUrl } from "@/lib/github-archive";
import type { Edge, FileNode, ImportKind } from "@/lib/parser/types.mts";
import { GENERIC_ROLES, taxonomyFor } from "@/lib/taxonomy.mts";

export interface Explanation {
  text: string;
  // What the model was not shown, stated rather than hidden.
  notes: string[];
}

function isExplanation(value: unknown): value is Explanation {
  if (typeof value !== "object" || value === null) return false;
  const { text, notes } = value as Record<string, unknown>;
  return typeof text === "string" && Array.isArray(notes) && notes.every((note) => typeof note === "string");
}

// Three pieces of formatting are permitted and rendered. Forbidding all of it
// doesn't hold: models emit backticks anyway and they print as backticks.
const FORMAT = [
  "Formatting: you may use `inline code`, bullet lines starting with \"- \", and **bold**. Nothing else:",
  "no headings, no numbered lists, no italics, no tables, no links. Write repository paths exactly as given, inside backticks.",
].join(" ");

const BOUNDARY = [
  "The connections listed were resolved by a parser and are complete. Do not claim any connection that is not listed,",
  "and do not mention any repository path that does not appear in this message.",
  "Describe; do not grade the code, rate it, or suggest changes.",
].join(" ");

function roleLabel(adapter: string, role: string): string {
  if (role === GENERIC_ROLES.other) return "unidentified";
  return taxonomyFor(adapter).categories.find((category) => category.role === role)?.label.toLowerCase() ?? "unidentified";
}

interface Neighbour {
  path: string;
  role: string;
  kinds: ImportKind[];
}

export interface FileExplainInput {
  repository: string;
  framework: string | null;
  path: string;
  role: string;
  sha256: string;
  lineCount: number;
  imports: Neighbour[];
  importedBy: Neighbour[];
  // Where to fetch the source from. Not part of the key: sha256 pins the content.
  origin: { repositoryUrl: string; commitSha: string };
}

function neighbours(edges: Edge[], side: "from" | "to", other: "from" | "to", path: string, describe: (path: string) => string): Neighbour[] {
  const kinds = new Map<string, Set<ImportKind>>();
  for (const edge of edges) {
    if (edge[side] !== path) continue;
    const set = kinds.get(edge[other]) ?? new Set<ImportKind>();
    set.add(edge.kind);
    kinds.set(edge[other], set);
  }
  return [...kinds].sort(([left], [right]) => left.localeCompare(right))
    .map(([neighbour, set]) => ({ path: neighbour, role: describe(neighbour), kinds: [...set].sort() }));
}

export function fileExplainInput(
  analysis: { name: string; adapter: string; repositoryUrl: string; commitSha: string },
  files: FileNode[], edges: Edge[], file: FileNode,
): FileExplainInput {
  const byPath = new Map(files.map((item) => [item.path, item]));
  const describe = (path: string) => roleLabel(analysis.adapter, byPath.get(path)?.kind ?? GENERIC_ROLES.other);
  return {
    repository: analysis.name,
    framework: taxonomyFor(analysis.adapter).framework,
    path: file.path, role: describe(file.path), sha256: file.sha256, lineCount: file.lineCount,
    imports: neighbours(edges, "from", "to", file.path, describe),
    importedBy: neighbours(edges, "to", "from", file.path, describe),
    origin: { repositoryUrl: analysis.repositoryUrl, commitSha: analysis.commitSha },
  };
}

const MAX_SOURCE_LINES = 1500;
const MAX_SOURCE_CHARS = 60000;

async function sourceFor(input: FileExplainInput): Promise<{ source: string; notes: string[] }> {
  const bytes = await fetchFileAtCommit(parseGithubUrl(input.origin.repositoryUrl), input.origin.commitSha, input.path);
  if (!bytes) throw new Error(`${input.path} is missing from the analysed commit.`);
  if (createHash("sha256").update(bytes).digest("hex") !== input.sha256) {
    throw new Error(`${input.path} at the analysed commit does not match what was parsed.`);
  }
  const full = bytes.toString("utf8");
  let source = full.split("\n").slice(0, MAX_SOURCE_LINES).join("\n");
  if (source.length > MAX_SOURCE_CHARS) source = source.slice(0, MAX_SOURCE_CHARS);
  if (source.length === full.length) return { source, notes: [] };
  const shownLines = source.split("\n").length;
  return { source, notes: [`The model was shown the first ${shownLines} of ${input.lineCount} lines of this file.`] };
}

function neighbourLines(list: Neighbour[]): string {
  if (list.length === 0) return "(none)";
  return list.map((item) => `- ${item.path} (${item.role}; ${item.kinds.join(", ")})`).join("\n");
}

function repositoryLine(input: { repository: string; framework: string | null }): string {
  return `Repository: ${input.repository}${input.framework ? ` (${input.framework})` : ""}`;
}

export const explainFile = cachedTask<FileExplainInput, Explanation>({
  name: "explain-file",
  version: 1,
  keyOf: ({ repository, framework, path, role, sha256, lineCount, imports, importedBy }) =>
    ({ repository, framework, path, role, sha256, lineCount, imports, importedBy }),
  async prepare(input) {
    const { source, notes } = await sourceFor(input);
    return {
      read: (text) => ({ text, notes }),
      request: {
        maxTokens: 16000,
        system: [
          "You explain one file of a TypeScript or JavaScript repository to a developer who did not write it.",
          "Say what the file does and what part it plays among the files around it: what it relies on, and what relies on it.",
          "Two or three short paragraphs, under 200 words. Bullets only where a list is genuinely clearer.",
          BOUNDARY, FORMAT,
        ].join(" "),
        messages: [
          {
            role: "user",
            content: [
              repositoryLine(input),
              `File: ${input.path} (${input.role}, ${input.lineCount} lines)`,
              `It imports these ${input.imports.length} repository files:`, neighbourLines(input.imports),
              `These ${input.importedBy.length} repository files import it:`, neighbourLines(input.importedBy),
              notes.length > 0 ? `Source, truncated (${notes[0]}):` : "Source:",
              "<source>", source, "</source>",
            ].join("\n"),
          },
        ],
      },
    };
  },
  isOutput: isExplanation,
});

interface FolderLink {
  folder: string;
  // Distinct files on the far side, and distinct file-to-file imports.
  files: number;
  imports: number;
}

export interface FolderExplainInput {
  repository: string;
  framework: string | null;
  folder: string;
  files: { path: string; role: string; lineCount: number; sha256: string; importedFromOutside: number; importsOutside: number }[];
  internalImports: number;
  incoming: FolderLink[];
  outgoing: FolderLink[];
}

// Every number here is arithmetic over the parser's edges; the model is
// handed counts, never asked to find them.
export function folderExplainInput(
  analysis: { name: string; adapter: string },
  files: FileNode[], edges: Edge[], folding: Folding, folder: string, members: string[],
): FolderExplainInput {
  const inside = new Set(members);
  const pairs = new Map<string, { from: string; to: string }>();
  for (const edge of edges) pairs.set(`${edge.from}\0${edge.to}`, edge);

  const importers = new Map<string, Set<string>>();
  const importsOutside = new Map<string, number>();
  const tally = (links: Map<string, { files: Set<string>; imports: number }>, group: string, file: string) => {
    const link = links.get(group) ?? { files: new Set<string>(), imports: 0 };
    link.files.add(file);
    link.imports += 1;
    links.set(group, link);
  };
  const incoming = new Map<string, { files: Set<string>; imports: number }>();
  const outgoing = new Map<string, { files: Set<string>; imports: number }>();
  let internalImports = 0;
  for (const { from, to } of pairs.values()) {
    const fromInside = inside.has(from);
    const toInside = inside.has(to);
    if (fromInside && toInside) internalImports += 1;
    else if (toInside) {
      importers.set(to, (importers.get(to) ?? new Set()).add(from));
      tally(incoming, folding.groupOf.get(from) ?? ".", from);
    } else if (fromInside) {
      importsOutside.set(from, (importsOutside.get(from) ?? 0) + 1);
      tally(outgoing, folding.groupOf.get(to) ?? ".", to);
    }
  }
  const links = (map: Map<string, { files: Set<string>; imports: number }>): FolderLink[] =>
    [...map].map(([group, link]) => ({ folder: group, files: link.files.size, imports: link.imports }))
      .sort((left, right) => right.imports - left.imports || left.folder.localeCompare(right.folder));

  const byPath = new Map(files.map((file) => [file.path, file]));
  return {
    repository: analysis.name,
    framework: taxonomyFor(analysis.adapter).framework,
    folder,
    files: members.flatMap((path) => {
      const file = byPath.get(path);
      return file ? [{
        path, role: roleLabel(analysis.adapter, file.kind), lineCount: file.lineCount, sha256: file.sha256,
        importedFromOutside: importers.get(path)?.size ?? 0, importsOutside: importsOutside.get(path) ?? 0,
      }] : [];
    }).sort((left, right) => right.importedFromOutside - left.importedFromOutside || left.path.localeCompare(right.path)),
    internalImports,
    incoming: links(incoming),
    outgoing: links(outgoing),
  };
}

function linkLines(list: FolderLink[]): string {
  if (list.length === 0) return "(none)";
  return list.map((link) => `- ${link.folder}: ${link.imports} imports across ${link.files} files`).join("\n");
}

export const explainFolder = cachedTask<FolderExplainInput, Explanation>({
  name: "explain-folder",
  version: 1,
  keyOf: (input) => input,
  async prepare(input) {
    const name = input.folder === "." ? "the repository root" : input.folder;
    return {
      read: (text) => ({ text, notes: [] }),
      request: {
        maxTokens: 16000,
        system: [
          "You explain one folder of a TypeScript or JavaScript repository, as it appears on a dependency map, to a developer who did not write it.",
          "Answer two questions about the folder as a whole: what lives in it, and why the rest of the repository points at it as much as it does, or why little does.",
          "Talk about the folder, not any one file in it; name individual files only as examples of a pattern.",
          "Two or three short paragraphs, under 200 words.",
          BOUNDARY, FORMAT,
        ].join(" "),
        messages: [
          {
            role: "user",
            content: [
              repositoryLine(input),
              `Folder: ${name}. On the map it holds ${input.files.length} files: its own, plus those of small subfolders merged into it.`,
              `Files, most imported from outside the folder first (role; lines; outside files importing it; imports it makes to outside files):`,
              input.files.map((file) => `- ${file.path} (${file.role}; ${file.lineCount}; ${file.importedFromOutside}; ${file.importsOutside})`).join("\n"),
              `Imports between files inside the folder: ${input.internalImports}.`,
              "Map folders importing into this one:", linkLines(input.incoming),
              "Map folders this one imports from:", linkLines(input.outgoing),
            ].join("\n"),
          },
        ],
      },
    };
  },
  isOutput: isExplanation,
});

