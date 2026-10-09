"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Settings } from "lucide-react";
import { deleteAnalysis, type DeleteAnalysisState } from "@/app/actions/analysis";

const initialState: DeleteAnalysisState = {};

export function AnalysisSettingsButton({
  analysisId,
  projectName,
  canDelete,
  preferAbove = false,
}: {
  analysisId: string;
  projectName: string;
  canDelete: boolean;
  preferAbove?: boolean;
}) {
  const action = deleteAnalysis.bind(null, analysisId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedName, setTypedName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const requiredProjectName = state.projectName ?? projectName;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onScroll = () => setMenuOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menuOpen]);

  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = Math.min(208, window.innerWidth - 16);
    const menuHeight = canDelete ? 80 : 92;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = (preferAbove && rect.top >= menuHeight + 8) ||
      (spaceBelow < menuHeight + 8 && rect.top > spaceBelow);
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    setMenuPosition(openAbove
      ? { left, bottom: window.innerHeight - rect.top + 4 }
      : { left, top: rect.bottom + 4 });
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!confirmOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [confirmOpen]);

  return <div ref={rootRef} className="relative inline-flex">
    <button ref={buttonRef} type="button" aria-label={`Settings for ${projectName}`} aria-haspopup="true"
      aria-expanded={menuOpen} title="Analysis settings" onClick={toggleMenu}
      className="inline-flex size-8 items-center justify-center border border-border text-muted hover:bg-background hover:text-foreground">
      <Settings aria-hidden="true" strokeWidth={1.7} className="block size-4 shrink-0" />
    </button>

    {menuOpen && menuPosition && typeof document !== "undefined" && createPortal(<div ref={menuRef}
      aria-label="Analysis settings" style={menuPosition}
      className="fixed z-[1000] w-52 max-w-[calc(100vw-1rem)] border border-border bg-surface p-1 shadow-lg">
      <p className="px-3 py-2 text-[11px] font-medium text-muted">Analysis settings</p>
      {canDelete ? <button type="button" onClick={() => {
        setMenuOpen(false);
        setTypedName("");
        setConfirmOpen(true);
      }} className="w-full px-3 py-2 text-left text-xs text-failed hover:bg-background">
        Delete analysis
      </button> : <p className="px-3 py-2 text-[11px] text-muted">Only organization admins can delete analyses.</p>}
    </div>, document.body)}

    {confirmOpen && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[9999] grid place-items-center bg-black/40 p-4"
      onKeyDown={(event) => { if (event.key === "Escape" && !pending) setConfirmOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={`delete-analysis-title-${analysisId}`}
        className="analysis-dialog-scroll max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto border border-border bg-surface p-5 shadow-xl">
        <h2 id={`delete-analysis-title-${analysisId}`} className="text-base font-semibold">Delete analysis?</h2>
        <p className="mt-2 text-sm text-muted">This permanently removes this analysis and its results from the workspace.</p>
        <p className="mt-4 text-xs">Type <span className="font-semibold text-foreground">{requiredProjectName}</span> to confirm.</p>
        <form action={formAction} className="mt-2">
          <label htmlFor={`delete-project-name-${analysisId}`} className="sr-only">Project name</label>
          <input id={`delete-project-name-${analysisId}`} name="project_name" value={typedName}
            onChange={(event) => setTypedName(event.target.value)} autoComplete="off" autoFocus required
            className="w-full border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground" />
          {state.error && <p role="alert" className="mt-2 text-xs text-failed">{state.error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={pending} onClick={() => setConfirmOpen(false)}
              className="border border-border px-3 py-2 text-xs hover:bg-background disabled:opacity-60">Cancel</button>
            <button type="submit" disabled={pending || typedName !== requiredProjectName}
              className="border border-failed px-3 py-2 text-xs text-failed hover:bg-failed/10 disabled:cursor-not-allowed disabled:opacity-50">
              {pending ? "Deleting..." : "Delete this analysis"}
            </button>
          </div>
        </form>
      </section>
    </div>, document.body)}
  </div>;
}
