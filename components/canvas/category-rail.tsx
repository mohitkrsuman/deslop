import type { Category } from "@/lib/canvas/categories";

export function CategoryRail({ name, framework, categories, activeCategory, onCategoryChange }: {
  name: string;
  framework: string | null;
  categories: Category[];
  activeCategory: string | null;
  onCategoryChange: (role: string | null) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-3 py-2">
        <p className="truncate font-mono text-[11px]" title={name}>{name}</p>
        <p className="mt-0.5 text-[10px] text-muted">{framework ?? "No framework detected"}</p>
      </div>
      <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-muted">Categories</p>
      <ul>
        <li>
          <button
            type="button"
            aria-pressed={activeCategory === null}
            onClick={() => onCategoryChange(null)}
            className={`flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left hover:bg-accent/10 ${activeCategory === null ? "text-accent" : "text-muted"}`}
          >
            <span>All files</span>
            <span className="tabular-nums">{categories.reduce((total, category) => total + category.count, 0)}</span>
          </button>
        </li>
        {categories.map((category) => (
          <li key={category.role}>
            {/* Empty roles stay listed so every category keeps its place. */}
            <button
              type="button"
              disabled={category.count === 0}
              aria-pressed={activeCategory === category.role}
              onClick={() => onCategoryChange(activeCategory === category.role ? null : category.role)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                category.count === 0 ? "text-muted opacity-50" : "cursor-pointer hover:bg-accent/10"
              } ${activeCategory === category.role ? "bg-accent/10 text-accent" : ""}`}
            >
              <span aria-hidden="true" className="size-2 shrink-0" style={{ background: category.color ?? "transparent" }} />
              <span className="min-w-0 flex-1 truncate">{category.label}</span>
              <span className="tabular-nums text-muted">{category.count}</span>
            </button>
          </li>
        ))}
      </ul>
      {activeCategory !== null && <p className="px-3 pt-2 text-[10px] text-muted">Other files are dimmed.</p>}
    </div>
  );
}
