import snapshot from "./excalidraw.json";
import { isParserResult } from "@/lib/parser/result-file.mts";
import type { ParserResult } from "@/lib/parser/types.mts";

// Scaffolding: parser output for Excalidraw, checked in
// so the interface can be built without an account, a database or a network.
// It goes away once analyses are stored. It is exactly what the parser wrote;
// the canvas derives what it needs instead of this being reshaped.
export const previewName = "Excalidraw";

const value: unknown = snapshot;
if (!isParserResult(value)) {
  throw new Error("data/preview/excalidraw.json no longer matches the parser schema.");
}
export const previewResult: ParserResult = value;
