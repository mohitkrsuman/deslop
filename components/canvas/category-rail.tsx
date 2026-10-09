import type { Category } from "@/lib/canvas/categories";

export function CategoryRail({ categories, activeCategory, onCategoryChange }: {
  categories: Category[];
  activeCategory: string | null;
  onCategoryChange: (role: string | null) => void;
}) {
  const availableCategories = categories.filter((category) => category.count > 0);

  return (
    <section aria-labelledby="analysis-categories-heading" className="pb-3">
      <h2 id="analysis-categories-heading" className="px-3 py-3 text-[11px] font-semibold">Categories</h2>
      {availableCategories.length > 0 ? <nav aria-label="File categories">
        <ul className="space-y-0.5 px-1">
          {availableCategories.map((category) => (
            <li key={category.role}>
              <button
                type="button"
                aria-pressed={activeCategory === category.role}
                onClick={() => onCategoryChange(activeCategory === category.role ? null : category.role)}
                className={`flex w-full cursor-pointer items-center gap-2 px-2 py-2 text-left hover:bg-accent/10 ${activeCategory === category.role ? "bg-accent/10 text-accent" : "text-muted"}`}
              >
                {category.color && <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: category.color }} />}
                <span className="min-w-0 flex-1 truncate">{category.label}</span>
                <span className="tabular-nums text-muted">{category.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav> : <p className="px-3 pb-2 text-[10px] text-muted">No categories detected.</p>}
    </section>
  );
}
