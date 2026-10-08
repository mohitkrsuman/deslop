"use client";

import { useState } from "react";
import { GraphWalk } from "@/components/canvas/graph-walk";
import { PathList } from "@/components/canvas/path-list";
import { extensionOf, type Category } from "@/lib/canvas/categories";
import type { DetailIndex } from "@/lib/canvas/details";
import type { Folding, FoldedGroup } from "@/lib/canvas/fold";
import { type HoverTarget, type Selection } from "@/lib/canvas/selection";
import { nodeIdFor } from "@/lib/canvas/view";
import type { FileNode } from "@/lib/parser/types.mts";

interface DetailPaneProps {
  name: string;
  adapter: string;
  importCount: number;
  files: FileNode[];
  categories: Category[];
  folding: Folding;
  index: DetailIndex;
  selection: Selection;
  hovered: HoverTarget;
  onSelectFile: (path: string) => void;
  onHoverChange: (target: HoverTarget) => void;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 border border-border px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {count !== undefined && <span className="font-mono text-[10px] tabular-nums text-muted">{count}</span>}
    </div>
  );
}

function RepositorySummary(props: DetailPaneProps) {
  const { name, adapter, importCount, files, index, folding, hovered, onSelectFile, onHoverChange } = props;
  const framework = adapter === "fallback" ? "Not detected" : adapter;
  return (
    <div className="min-w-0">
      <header className="border-b border-border px-4 py-4">
        <p className="text-[10px] uppercase tracking-wide text-muted">Repository</p>
        <h2 className="mt-1 break-all font-mono text-sm font-semibold">{name}</h2>
        <p className="mt-2 text-[11px] text-muted">Framework: {framework}</p>
      </header>
      <dl className="grid grid-cols-2 gap-2 px-4 py-4">
        <Metric label="Files" value={files.length} />
        <Metric label="Imports" value={importCount} />
        <Metric label="Routes" value={index.routeCount} />
        <Metric label="Unidentified" value={index.unidentifiedCount} />
      </dl>
      <section className="border-t border-border px-4 py-4">
        <SectionTitle title="Most depended on" count={Math.min(index.mostDependedOn.length, 10)} />
        <p className="mt-1 text-[11px] text-muted">Files with the most direct importers.</p>
        <PathList
          paths={index.mostDependedOn.slice(0, 10).map((file) => file.path)}
          folding={folding}
          hovered={hovered}
          onSelectFile={onSelectFile}
          onHoverChange={onHoverChange}
          trailing={(path) => String(index.dependents.get(path)?.length ?? 0)}
          ranked
        />
      </section>
      <section className="border-t border-border px-4 py-4">
        <SectionTitle title="Start reading here" count={index.unimported.length} />
        <p className="mt-1 text-[11px] text-muted">Files nothing in this repository imports, ordered by what they import.</p>
        <PathList
          paths={index.unimported.map((file) => file.path)}
          folding={folding}
          hovered={hovered}
          onSelectFile={onSelectFile}
          onHoverChange={onHoverChange}
          trailing={(path) => String(index.dependencies.get(path)?.length ?? 0)}
          ranked
        />
      </section>
    </div>
  );
}

function FileStructure({ file, props }: { file: FileNode; props: DetailPaneProps }) {
  const { index, folding, hovered, onSelectFile, onHoverChange } = props;
  const dependencies = index.dependencies.get(file.path) ?? [];
  const dependents = index.dependents.get(file.path) ?? [];
  return (
    <>
      <dl className="grid grid-cols-2 gap-2 px-4 py-4">
        <Metric label="Type" value={extensionOf(file.path)} />
        <Metric label="Lines" value={file.lineCount} />
        <Metric label="Depends on" value={dependencies.length} />
        <Metric label="Depended on by" value={dependents.length} />
      </dl>
      <p className="px-4 pb-4 text-[11px] text-muted">Convention: {file.kind === "module" ? "Unidentified" : file.kind}</p>
      <GraphWalk key={file.path} path={file.path} graph={index} folding={folding} hovered={hovered} onSelectFile={onSelectFile} onHoverChange={onHoverChange} />
      <section className="border-t border-border px-4 py-4">
        <SectionTitle title="Depends on" count={dependencies.length} />
        {dependencies.length > 0 ? <PathList paths={dependencies} folding={folding} hovered={hovered} onSelectFile={onSelectFile} onHoverChange={onHoverChange} />
          : <p className="mt-2 text-[11px] text-muted">No internal dependencies.</p>}
      </section>
      <section className="border-t border-border px-4 py-4">
        <SectionTitle title="Depended on by" count={dependents.length} />
        {dependents.length > 0 ? <PathList paths={dependents} folding={folding} hovered={hovered} onSelectFile={onSelectFile} onHoverChange={onHoverChange} />
          : <p className="mt-2 text-[11px] text-muted">No internal dependents.</p>}
      </section>
    </>
  );
}

function FolderStructure({ group, props }: { group: FoldedGroup; props: DetailPaneProps }) {
  const { categories, folding, hovered, index, onSelectFile, onHoverChange } = props;
  const counts = new Map<string, number>();
  for (const path of group.files) {
    const extension = extensionOf(path);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return (
    <>
      <section className="px-4 py-4">
        <SectionTitle title="Files by type" count={group.files.length} />
        <ul className="mt-3 space-y-2">
          {categories.filter((category) => counts.has(category.extension)).map((category) => (
            <li key={category.extension} className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2 shrink-0" style={{ background: category.color }} />
              <span className="min-w-0 flex-1 font-mono text-[11px]">{category.extension}</span>
              <span className="font-mono tabular-nums text-muted">{counts.get(category.extension)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="border-t border-border px-4 py-4">
        <SectionTitle title="Files inside" count={group.files.length} />
        <PathList
          paths={group.files.filter((path) => index.fileByPath.has(path))}
          folding={folding}
          hovered={hovered}
          onSelectFile={onSelectFile}
          onHoverChange={onHoverChange}
        />
      </section>
    </>
  );
}

export function DetailPane(props: DetailPaneProps) {
  const [tab, setTab] = useState<"structure" | "explanation">("structure");
  const { selection, index, folding, hovered, onSelectFile, onHoverChange } = props;
  const file = selection?.kind === "row" ? index.fileByPath.get(selection.path) : undefined;
  const group = selection?.kind === "node"
    ? folding.groups.find((item) => selection.id === nodeIdFor(item.folder, false) || selection.id === nodeIdFor(item.folder, true))
    : undefined;

  if (!file && !group) return <RepositorySummary {...props} />;

  const title = file?.path ?? group?.folder ?? "";
  const titleHovered = file
    ? hovered?.kind === "file" && hovered.path === file.path ||
      hovered?.kind === "folder" && folding.groupOf.get(file.path) === hovered.folder
    : hovered?.kind === "folder" && hovered.folder === group?.folder ||
      hovered?.kind === "file" && folding.groupOf.get(hovered.path) === group?.folder;
  return (
    <div className="min-w-0">
      <header className="border-b border-border px-4 py-4">
        <p className="text-[10px] uppercase tracking-wide text-muted">{file ? "File" : "Folder"}</p>
        {file ? (
          <button
            type="button"
            title={file.path}
            onClick={() => onSelectFile(file.path)}
            onMouseEnter={() => onHoverChange({ kind: "file", path: file.path })}
            onMouseLeave={() => onHoverChange(null)}
            onFocus={() => onHoverChange({ kind: "file", path: file.path })}
            onBlur={() => onHoverChange(null)}
            className={`mt-1 cursor-pointer break-all text-left font-mono text-[11px] leading-4 ${titleHovered ? "text-accent" : ""}`}
          >
            {title}
          </button>
        ) : <h2 className={`mt-1 break-all font-mono text-[11px] leading-4 ${titleHovered ? "text-accent" : ""}`}>{title}</h2>}
        {group && <p className="mt-2 text-[11px] text-muted">{group.files.length} files</p>}
      </header>
      <div role="tablist" aria-label="Detail view" className="flex border-b border-border">
        {(["structure", "explanation"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`flex-1 cursor-pointer border-b-2 px-2 py-3 text-[11px] ${
              tab === value ? "border-accent text-foreground" : "border-transparent text-muted"
            }`}
          >
            {value === "structure" ? "Structure" : "Explanation"}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "explanation" ? (
          <p className="px-4 py-6 text-[11px] text-muted">No explanation yet.</p>
        ) : file ? <FileStructure file={file} props={props} /> : group ? <FolderStructure group={group} props={props} /> : null}
      </div>
    </div>
  );
}
