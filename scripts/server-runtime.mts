import { register } from "node:module";

// Next resolves "server-only" itself, to fail client bundles that import server
// code. A plain script is server code by definition, so the marker resolves to
// an empty module here. Load with: node --import ./scripts/server-runtime.mts
const hook = `export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);
