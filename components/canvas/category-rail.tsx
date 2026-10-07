import type { Category } from "@/lib/canvas/categories";

export function CategoryRail({ name, categories }: { name: string; categories: Category[] }) {
  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-3 py-2">
        <p className="truncate font-mono text-[11px]" title={name}>{name}</p>
      </div>
      <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-muted">Categories</p>
      <ul>
        {categories.map((category) => (
          <li key={category.kind} className="flex items-center gap-2 px-3 py-1">
            <span aria-hidden="true" className="size-2 shrink-0" style={{ background: category.color }} />
            <span className="min-w-0 flex-1 truncate">{category.kind}</span>
            <span className="tabular-nums text-muted">{category.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
