// What the ask endpoint streams to the browser, one JSON object per line. The
// panel never sees the agent service's own protocol.
export type AskEvent =
  | { type: "thread"; threadId: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_done"; id: string; ok: boolean }
  | { type: "error"; message: string }
  | { type: "done" };
