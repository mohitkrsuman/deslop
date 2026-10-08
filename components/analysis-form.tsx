"use client";

import { useActionState } from "react";
import { submitAnalysis } from "@/app/actions/analysis";

export function AnalysisForm() {
  const [state, action, pending] = useActionState(submitAnalysis, {});
  return (
    <form action={action} className="mt-6 flex flex-col gap-3 border border-border bg-surface p-4 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-xs font-medium">
        Public GitHub repository URL
        <input name="repository_url" type="url" required placeholder="https://github.com/owner/repo"
          className="mt-2 w-full border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground" />
      </label>
      <button disabled={pending} className="bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60">
        {pending ? "Starting…" : "Analyze repository"}
      </button>
      {state.error && <p role="alert" className="text-xs text-failed sm:basis-full">{state.error}</p>}
    </form>
  );
}
