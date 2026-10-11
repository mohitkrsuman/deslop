import type { NextRequest } from "next/server";
import { createGrantClient } from "@/lib/agent/grant";
import { organizationChoice } from "@/lib/ai/keys";

// Called by the agent service at the start of a question, never by a browser.
// The grant names one analysis; the database function turns that into its
// organization's sealed key or none. The decrypted key goes back only on this
// response, and the agent keeps it in memory for the life of the grant.
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return Response.json({ error: "Missing grant." }, { status: 401 });

  const { data: rows, error } = await createGrantClient(token).rpc("agent_grant_model_key");
  if (error) return Response.json({ error: "Could not read the model key." }, { status: 502 });
  if (!rows || rows.length === 0) return Response.json({ error: "Grant is invalid or expired." }, { status: 401 });
  if (rows.length > 1) return Response.json({ error: "Grant resolved to more than one organization." }, { status: 500 });

  const [row] = rows;
  const noStore = { "cache-control": "no-store" };
  if (!row.provider || !row.ciphertext) return Response.json({ source: "app" }, { headers: noStore });
  try {
    const { provider, model, apiKey } = organizationChoice(row.organization_id, row.provider, row.ciphertext);
    return Response.json({ source: "organization", provider, model, apiKey }, { headers: noStore });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 409 });
  }
}
