"use client";

import { useActionState } from "react";
import { inviteMember, type InviteState } from "@/app/actions/invite";

const initial: InviteState = {};

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMember, initial);

  return (
    <form action={action} className="flex items-center gap-2">
      <label className="sr-only" htmlFor="invite-email">
        Email to invite
      </label>
      <input
        id="invite-email"
        name="email"
        type="email"
        required
        placeholder="Invite by email"
        className="h-7 w-44 border border-border bg-surface px-2 text-xs text-foreground outline-none placeholder:text-muted"
      />
      <button
        type="submit"
        disabled={pending}
        className="h-7 bg-accent px-2 text-xs text-white disabled:opacity-60"
      >
        Invite
      </button>
      {state.error ? (
        <span className="text-xs text-foreground">{state.error}</span>
      ) : null}
      {state.sent ? (
        <span className="text-xs text-muted">Sent to {state.sent}</span>
      ) : null}
    </form>
  );
}
