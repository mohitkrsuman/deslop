"use client";

import { useActionState, useState, useTransition } from "react";
import { removeGithubToken, saveGithubToken, type GithubTokenState } from "@/app/actions/github-token";

const initial: GithubTokenState = {};
const formatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export interface StoredGithubToken {
  lastFour: string;
  expiresAt: string | null;
}

// Shown on the dashboard. The token itself never reaches this component. Admins
// see its last four characters and expiry; members only that one is set.
export function GithubTokenSettings({ stored, canEdit }: { stored: StoredGithubToken | null; canEdit: boolean }) {
  const [state, save, saving] = useActionState(saveGithubToken, initial);
  const [removeError, setRemoveError] = useState<string>();
  const [removing, startRemoving] = useTransition();

  const current = !stored ? <>None set. Only public repositories can be analyzed.</>
    : !canEdit ? <>A token is set. Private repositories it was given can be analyzed.</>
    : <>The organization&apos;s token <span className="font-mono">…{stored.lastFour}</span>
      {stored.expiresAt ? <>, expiring {formatter.format(new Date(stored.expiresAt))} (UTC)</> : <>, no expiry reported by GitHub</>}.
      Every GitHub read for this organization uses it.</>;

  return (
    <section className="mt-3 border border-border bg-surface px-3 py-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="font-semibold">GitHub token</h2>
        <p className="text-muted">{current}</p>
      </div>
      {canEdit ? (
        <form action={save} className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="github-token-value">Fine-grained GitHub token</label>
          <input
            id="github-token-value"
            name="token"
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={stored ? "Replace with a new fine-grained token" : "github_pat_…"}
            className="h-7 w-72 border border-border bg-background px-2 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted"
          />
          <button type="submit" disabled={saving} className="h-7 bg-accent px-2 text-xs text-white disabled:opacity-60">
            {saving ? "Checking…" : "Save"}
          </button>
          {stored && (
            <button
              type="button"
              disabled={removing}
              onClick={() => startRemoving(async () => setRemoveError((await removeGithubToken()).error))}
              className="h-7 border border-border px-2 text-xs hover:bg-background disabled:opacity-60"
            >
              Remove
            </button>
          )}
          <span className="text-muted">Fine-grained only, with read-only Contents on the repositories to analyze. Checked with GitHub before saving.</span>
          {state.error && <p role="alert" className="basis-full text-failed">{state.error}</p>}
          {removeError && <p role="alert" className="basis-full text-failed">{removeError}</p>}
        </form>
      ) : (
        <p className="mt-1 text-muted">Only organization admins can change this.</p>
      )}
    </section>
  );
}
