import path from "node:path";
import process from "node:process";
import { parseRepository } from "../lib/parser/parse.mts";
import { writeParserResult } from "../lib/parser/result-file.mts";

function usage(): never {
  throw new Error("Usage: pnpm parse:repo <directory> [--output <file.json>]");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) usage();
  const directory = args.shift();
  if (!directory) usage();
  let output: string | undefined;
  while (args.length > 0) {
    const option = args.shift();
    if (option !== "--output" || output || args.length === 0) usage();
    output = args.shift();
  }

  const result = await parseRepository(directory);
  const { coverage } = result;
  const folders = new Set(result.files.map((file) => file.folder));
  const reExports = result.imports.filter((item) => item.kind === "re-export");
  const resolvedReExports = reExports.filter((item) => item.status === "resolved");

  console.log(`Repository: ${result.root}`);
  console.log(`Files found: ${coverage.filesFound}`);
  console.log(`Files parsed: ${coverage.filesParsed}`);
  console.log(`Files skipped: ${coverage.filesSkipped}`);
  console.log(`Distinct folders: ${folders.size}`);
  console.log(`Edges: ${result.edges.length}`);
  console.log(`Imports: ${coverage.imports.found} (${coverage.imports.resolved} resolved, ${coverage.imports.external} external, ${coverage.imports.excluded} excluded, ${coverage.imports.unresolved} unresolved)`);
  console.log(`Re-exports: ${reExports.length} found, ${resolvedReExports.length} resolved`);
  for (const file of coverage.skippedFiles) {
    console.log(`SKIP ${file.path}: ${file.reason} — ${file.detail}`);
  }
  for (const directory of coverage.skippedDirectories) {
    console.log(`SKIP DIRECTORY ${directory.path}: ${directory.reason} — ${directory.detail}`);
  }
  for (const warning of coverage.configurationWarnings) {
    console.log(`CONFIG WARNING ${warning}`);
  }
  for (const item of result.imports) {
    if (item.status === "unresolved") {
      console.log(`UNRESOLVED ${item.from}:${item.line} ${item.specifier}: ${item.reason}`);
    }
  }
  if (output) {
    const absoluteOutput = path.resolve(output);
    await writeParserResult(absoluteOutput, result);
    console.log(`Wrote ${absoluteOutput}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
