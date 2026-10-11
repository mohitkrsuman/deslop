"use client";

import { useActionState, useState, useTransition } from "react";
import { removeModelKey, saveModelKey, type ModelKeyState } from "@/app/actions/model-key";
import type { Provider } from "@/lib/ai/client";

const initial: ModelKeyState = {};

export interface StoredModelKey {
  provider: Provider;
  lastFour: string;
}

// Shown on the dashboard. The key itself never reaches this component; only
// which provider is in use and its last four characters.
export function ModelKeySettings({ stored, canEdit, labels, models }: {
  stored: StoredModelKey | null;
  canEdit: boolean;
  labels: Record<Provider, string>;
  models: Record<Provider, string>;
}) {
  const [state, save, saving] = useActionState(saveModelKey, initial);
  const [removeError, setRemoveError] = useState<string>();
  const [removing, startRemoving] = useTransition();
  const [provider, setProvider] = useState<Provider>(stored?.provider ?? "anthropic");

  const current = stored
    ? <>The organization&apos;s {labels[stored.provider]} key <span className="font-mono">…{stored.lastFour}</span>, answering with <span className="font-mono">{models[stored.provider]}</span>.</>
    : <>The app&apos;s Claude key, answering with <span className="font-mono">{models.anthropic}</span>.</>;

  return (
    <section className="mt-5 border border-border bg-surface px-3 py-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="font-semibold">Model key</h2>
        <p className="text-muted">Explanations and labelling run on {current}</p>
      </div>
      {canEdit ? (
        <form action={save} className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="model-key-provider">Provider</label>
          <select
            id="model-key-provider"
            name="provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value === "openai" ? "openai" : "anthropic")}
            className="h-7 border border-border bg-background px-1 text-xs"
          >
            <option value="anthropic">{labels.anthropic}</option>
            <option value="openai">{labels.openai}</option>
          </select>
          <label className="sr-only" htmlFor="model-key-value">{labels[provider]} API key</label>
          <input
            id="model-key-value"
            name="apiKey"
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={stored ? `Replace with a new ${labels[provider]} key` : `${labels[provider]} API key`}
            className="h-7 w-72 border border-border bg-background px-2 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted"
          />
          <button type="submit" disabled={saving} className="h-7 bg-accent px-2 text-xs text-white disabled:opacity-60">
            {saving ? "Checking…" : "Save"}
          </button>
          {stored && (
            <button
              type="button"
              disabled={removing}
              onClick={() => startRemoving(async () => setRemoveError((await removeModelKey()).error))}
              className="h-7 border border-border px-2 text-xs hover:bg-background disabled:opacity-60"
            >
              Remove
            </button>
          )}
          <span className="text-muted">Uses <span className="font-mono">{models[provider]}</span>. Checked before saving.</span>
          {state.error && <p role="alert" className="basis-full text-failed">{state.error}</p>}
          {removeError && <p role="alert" className="basis-full text-failed">{removeError}</p>}
        </form>
      ) : (
        <p className="mt-1 text-muted">Only organization admins can change this.</p>
      )}
    </section>
  );
}
