import type { Category } from "@/lib/canvas/categories";

export function CategoryRail({ name, categories, activeCategory, onCategoryChange }: {
  name: string;
  categories: Category[];
  activeCategory: string | null;
  onCategoryChange: (extension: string | null) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-3 py-2">
        <p className="truncate font-mono text-[11px]" title={name}>{name}</p>
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
          <li key={category.extension}>
            <button
              type="button"
              aria-pressed={activeCategory === category.extension}
              onClick={() => onCategoryChange(activeCategory === category.extension ? null : category.extension)}
              className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-accent/10 ${activeCategory === category.extension ? "bg-accent/10 text-accent" : ""}`}
            >
              <span aria-hidden="true" className="size-2 shrink-0" style={{ background: category.color }} />
              <span className="min-w-0 flex-1 truncate">{category.extension}</span>
              <span className="tabular-nums text-muted">{category.count}</span>
            </button>
          </li>
        ))}
      </ul>
      {activeCategory !== null && <p className="px-3 pt-2 text-[10px] text-muted">Other files are dimmed.</p>}
    </div>
  );
}
