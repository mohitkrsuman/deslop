import { CATEGORY_SECTION_PREFIX, type Category } from "@/lib/canvas/categories";
import { ROLE_SECTIONS } from "@/lib/taxonomy.mts";

export function CategoryRail({ name, framework, categories, activeCategory, onCategoryChange }: {
  name: string;
  framework: string | null;
  categories: Category[];
  activeCategory: string | null;
  onCategoryChange: (role: string | null) => void;
}) {
  const groups = Array.from(new Set(categories.map((category) => category.section))).map((section) => {
    const members = categories.filter((category) => category.section === section);
    return {
      section,
      filter: `${CATEGORY_SECTION_PREFIX}${section}`,
      members,
      count: members.reduce((total, category) => total + category.count, 0),
    };
  });

  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-3 py-2">
        <p className="truncate font-mono text-[11px]" title={name}>{name}</p>
        <p className="mt-0.5 text-[10px] text-muted">{framework ?? "No framework detected"}</p>
      </div>
      <h2 className="px-3 pt-3 pb-1 text-[10px] font-semibold text-muted">Files</h2>
      <nav aria-label="File categories">
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
        </ul>
        {groups.map((group) => (
          <section key={group.section} aria-labelledby={`category-section-${group.section}`} className="mt-2 border-t border-border pt-2">
            <h3 id={`category-section-${group.section}`} className="px-1 pb-1">
              <button
                type="button"
                disabled={group.count === 0}
                aria-pressed={activeCategory === group.filter}
                onClick={() => onCategoryChange(activeCategory === group.filter ? null : group.filter)}
                className={`flex w-full items-center justify-between px-2 py-1 text-left text-[10px] font-semibold ${
                  group.count === 0 ? "text-muted opacity-50" : "cursor-pointer text-muted hover:bg-accent/10"
                } ${activeCategory === group.filter ? "bg-accent/10 text-accent" : ""}`}
              >
                <span>{ROLE_SECTIONS[group.section]}</span>
                <span className="tabular-nums">{group.count}</span>
              </button>
            </h3>
            <ul>
              {group.members.map((category) => (
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
          </section>
        ))}
      </nav>
      {activeCategory !== null && <p className="px-3 pt-2 text-[10px] text-muted">Files outside this selection are dimmed.</p>}
    </div>
  );
}
