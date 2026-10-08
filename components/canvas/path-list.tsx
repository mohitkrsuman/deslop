import type { Folding } from "@/lib/canvas/fold";
import type { HoverTarget } from "@/lib/canvas/selection";

export interface FileNavigationProps {
  folding: Folding;
  hovered: HoverTarget;
  onSelectFile: (path: string) => void;
  onHoverChange: (target: HoverTarget) => void;
}

export function PathList({
  paths, folding, hovered, onSelectFile, onHoverChange, trailing, ranked = false,
}: FileNavigationProps & {
  paths: string[];
  trailing?: (path: string) => string;
  ranked?: boolean;
}) {
  const List = ranked ? "ol" : "ul";
  return (
    <List className="mt-2 space-y-0.5">
      {paths.map((path, index) => {
        const highlighted = hovered?.kind === "file" ? hovered.path === path
          : hovered?.kind === "folder" && folding.groupOf.get(path) === hovered.folder;
        return (
          <li key={`${index}:${path}`}>
            <button
              type="button"
              title={path}
              onClick={() => onSelectFile(path)}
              onMouseEnter={() => onHoverChange({ kind: "file", path })}
              onMouseLeave={() => onHoverChange(null)}
              onFocus={() => onHoverChange({ kind: "file", path })}
              onBlur={() => onHoverChange(null)}
              className={`flex w-full cursor-pointer items-start gap-2 px-1 py-1 text-left hover:bg-accent/10 hover:text-accent focus-visible:bg-accent/10 focus-visible:text-accent ${
                highlighted ? "bg-accent/10 text-accent" : ""
              }`}
            >
              {ranked && <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">{index + 1}.</span>}
              <span className="min-w-0 flex-1 break-all font-mono text-[10px] leading-4">{path}</span>
              {trailing && <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">{trailing(path)}</span>}
            </button>
          </li>
        );
      })}
    </List>
  );
}
