import type { ReactNode } from "react";

// The analysis layout, fixed from here on: a narrow rail, the map, and a
// detail pane. Later phases fill these columns; they don't move them, and the
// detail pane is a column, never a drawer or overlay.
export function AnalysisShell({
  rail,
  map,
  detail,
}: {
  rail?: ReactNode;
  map?: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="grid h-dvh grid-cols-[13rem_minmax(0,1fr)_18rem] bg-background text-xs text-foreground">
      <aside aria-label="Categories" className="min-h-0 overflow-y-auto border-r border-border bg-surface">
        {rail}
      </aside>
      <main aria-label="Map" className="relative min-h-0 min-w-0">
        {map}
      </main>
      <aside aria-label="Details" className="min-h-0 overflow-y-auto border-l border-border bg-surface">
        {detail}
      </aside>
    </div>
  );
}
