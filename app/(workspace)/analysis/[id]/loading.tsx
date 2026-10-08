import { AnalysisShell } from "@/components/analysis-shell";

function PlaceholderLines({ widths }: { widths: string[] }) {
  return <div aria-hidden="true" className="space-y-3 px-4 py-5 motion-safe:animate-pulse">
    {widths.map((width, index) =>
      <div key={index} className="h-2.5 rounded-sm bg-border" style={{ width }} />)}
  </div>;
}

export default function Loading() {
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-4 border-b border-border bg-surface px-4 py-3">
      <div aria-hidden="true" className="h-2.5 w-16 rounded-sm bg-border" />
      <div aria-hidden="true" className="h-2.5 w-36 rounded-sm bg-border" />
    </div>
    <div className="min-h-0 flex-1">
      <AnalysisShell
        rail={<PlaceholderLines widths={["65%", "80%", "55%", "70%", "60%"]} />}
        map={<div className="flex h-full items-center justify-center">
          <div role="status" className="flex items-center gap-3 text-sm text-muted">
            <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none" />
            Opening analysis…
          </div>
        </div>}
        detail={<PlaceholderLines widths={["75%", "60%", "85%", "55%", "70%", "65%"]} />}
      />
    </div>
  </div>;
}
