import type { FileNavigationProps } from "@/components/canvas/path-list";
import type { Route } from "@/lib/parser/types.mts";

export type RouteRow = Pick<Route, "file" | "method" | "path">;

export function RouteTable({ routes, notes, selectedPath, folding, hovered, onSelectFile, onHoverChange }: FileNavigationProps & {
  routes: RouteRow[];
  notes: string[];
  selectedPath: string | null;
}) {
  return (
    <div className="analysis-side-scroll h-full overflow-y-auto">
      {routes.length > 0 ? (
        <table className="w-full border-collapse text-left font-mono text-[11px]">
          <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <th className="w-20 px-3 py-2 font-normal">Method</th>
              <th className="px-3 py-2 font-normal">Pattern</th>
              <th className="px-3 py-2 font-normal">File</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => {
              const highlighted = selectedPath === route.file ||
                (hovered?.kind === "file" ? hovered.path === route.file
                  : hovered?.kind === "folder" && folding.groupOf.get(route.file) === hovered.folder);
              return (
                <tr
                  key={`${route.method} ${route.path} ${route.file}`}
                  onClick={() => onSelectFile(route.file)}
                  onMouseEnter={() => onHoverChange({ kind: "file", path: route.file })}
                  onMouseLeave={() => onHoverChange(null)}
                  className={`cursor-pointer border-b border-border hover:bg-accent/10 ${highlighted ? "bg-accent/10 text-accent" : ""}`}
                >
                  <td className="px-3 py-1.5 align-top">{route.method}</td>
                  <td className="break-all px-3 py-1.5 align-top">{route.path}</td>
                  <td className="px-3 py-1.5 align-top">
                    <button type="button" title={route.file} onClick={(event) => { event.stopPropagation(); onSelectFile(route.file); }}
                      onFocus={() => onHoverChange({ kind: "file", path: route.file })} onBlur={() => onHoverChange(null)}
                      className="cursor-pointer break-all text-left text-muted">{route.file}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="px-4 pt-4 text-[11px] text-muted">No routes.</p>
      )}
      <div className="px-4 py-4 text-[11px] text-muted">
        <p>A route is listed only when its method and full path are both written in the code.</p>
        {notes.length > 0 && (
          <ul className="mt-2 space-y-1 font-mono text-[10px]">
            {notes.map((note, index) => <li key={index} className="break-all">{note}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
