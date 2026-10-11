import { auth } from "@clerk/nextjs/server";
import { mintAgentGrant } from "@/lib/agent/grant";
import type { AskEvent } from "@/lib/agent/events";
import { createAgentClient, resolveThread, streamAnswer } from "@/lib/agent/service";
import { createServerSupabaseClient } from "@/lib/supabase";

export const maxDuration = 300;

const MAX_QUESTION_LENGTH = 4000;

interface AskBody {
  analysisId: string;
  threadId: string | null;
  question: string;
  selection: { kind: "file" | "folder"; path: string } | null;
}

function parseBody(body: unknown): AskBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { analysisId, threadId, question, selection } = body as Record<string, unknown>;
  if (typeof analysisId !== "string" || typeof question !== "string") return null;
  if (!question.trim() || question.length > MAX_QUESTION_LENGTH) return null;
  if (threadId !== null && typeof threadId !== "string") return null;
  let parsedSelection: AskBody["selection"] = null;
  if (selection !== null && selection !== undefined) {
    if (typeof selection !== "object") return null;
    const { kind, path } = selection as Record<string, unknown>;
    if ((kind !== "file" && kind !== "folder") || typeof path !== "string") return null;
    parsedSelection = { kind, path };
  }
  return { analysisId, threadId, question: question.trim(), selection: parsedSelection };
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to ask." }, { status: 401 });
  const body = parseBody(await request.json().catch(() => null));
  if (!body) return Response.json({ error: "Malformed question." }, { status: 400 });

  const grant = await mintAgentGrant(createServerSupabaseClient(), body.analysisId);
  if (!grant) return Response.json({ error: "Analysis not found." }, { status: 404 });

  const agent = createAgentClient(userId);
  if (!agent) return Response.json({ error: "The agent service isn't configured. Set AGENT_URL and MDA_INGRESS_SECRET." }, { status: 503 });
  let threadId: string;
  try {
    threadId = await resolveThread(agent, body.threadId, body.analysisId);
  } catch {
    return Response.json({ error: "The agent service is unreachable." }, { status: 503 });
  }

  // The selection is a path the user is looking at, not the analysis identity.
  const content = body.selection
    ? `[Selected in the map: ${body.selection.kind} \`${body.selection.path}\`]\n\n${body.question}`
    : body.question;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AskEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      send({ type: "thread", threadId });
      try {
        for await (const event of streamAnswer(agent, threadId, content, grant, request.signal)) send(event);
        send({ type: "done" });
      } catch (cause) {
        // A closed tab cancels the run; there is no one left to tell.
        if (request.signal.aborted) return;
        send({ type: "error", message: cause instanceof Error ? cause.message : "The agent run failed." });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
