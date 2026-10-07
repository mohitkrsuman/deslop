import snapshot from "./react-hook-form.json";
import { isParserResult } from "@/lib/parser/result-file.mts";
import type { ParserResult } from "@/lib/parser/types.mts";

// Scaffolding: parser output for react-hook-form (commit 36e5329), checked in
// so the interface can be built without an account, a database or a network.
// It goes away once analyses are stored. It is exactly what the parser wrote;
// the canvas derives what it needs instead of this being reshaped.
export const previewName = "react-hook-form";

const value: unknown = snapshot;
if (!isParserResult(value)) {
  throw new Error("data/preview/react-hook-form.json no longer matches the parser schema.");
}
export const previewResult: ParserResult = value;
