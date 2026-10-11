// What the ask endpoint streams to the browser, one JSON object per line. The
// panel never sees the agent service's own protocol.
export type AskEvent =
  | { type: "thread"; threadId: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; args: Record<string, unknown> }
  // For graph tools, the files the tool returned and how many hops each is
  // from the file it started at (0 for the start). Only what a tool returned
  // is ever put on the map; nothing the model wrote.
  | { type: "tool_done"; id: string; ok: boolean; reached?: { path: string; hops: number }[] }
  | { type: "error"; message: string }
  | { type: "done" };
