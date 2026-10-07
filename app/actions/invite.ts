"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { headers } from "next/headers";

export type InviteState = {
  error?: string;
  sent?: string;
};

function messageFrom(error: unknown): string {
  if (typeof error === "object" && error !== null && "errors" in error) {
    const errors = error.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      if (typeof first === "object" && first !== null) {
        if ("longMessage" in first && typeof first.longMessage === "string") {
          return first.longMessage;
        }
        if ("message" in first && typeof first.message === "string") {
          return first.message;
        }
      }
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Could not send the invitation.";
}

export async function inviteMember(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  await auth.protect();

  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) {
    return { error: "Enter an email address." };
  }

  const { orgId, userId } = await auth();
  if (!userId || !orgId) {
    return { error: "The session token has no organization." };
  }

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (!host) {
    return { error: "Could not determine this app's login URL." };
  }
  const proto = headerList.get("x-forwarded-proto") ?? "http";

  try {
    const client = await clerkClient();
    await client.organizations.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress: email,
      role: "org:member",
      inviterUserId: userId,
      redirectUrl: `${proto}://${host}/sign-in`,
    });
  } catch (error) {
    return { error: messageFrom(error) };
  }

  return { sent: email };
}
