"use client";

import { useCallback, useMemo, useState } from "react";
import { AnalysisShell } from "@/components/analysis-shell";
import { CategoryRail } from "@/components/canvas/category-rail";
import { DependencyMap } from "@/components/canvas/dependency-map";
import { DetailPane } from "@/components/canvas/detail-pane";
import { categoriesOf } from "@/lib/canvas/categories";
import { buildDetailIndex } from "@/lib/canvas/details";
import { foldDirectories } from "@/lib/canvas/fold";
import { type HoverTarget, type Selection } from "@/lib/canvas/selection";
import { nodeIdFor } from "@/lib/canvas/view";
import type { Edge, FileNode } from "@/lib/parser/types.mts";

export function PreviewAnalysis({
  name,
  adapter,
  importCount,
  files,
  edges,
}: {
  name: string;
  adapter: string;
  importCount: number;
  files: FileNode[];
  edges: Edge[];
}) {
  const categories = useMemo(() => categoriesOf(files), [files]);
  const folding = useMemo(() => foldDirectories(files), [files]);
  const index = useMemo(() => buildDetailIndex(files, edges), [files, edges]);
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [hovered, setHovered] = useState<HoverTarget>(null);

  const selectFile = useCallback((path: string) => {
    const folder = folding.groupOf.get(path);
    if (!folder) return;
    setOpenFolders((current) => current.has(folder) ? current : new Set(current).add(folder));
    setHovered(null);
    setSelection({ kind: "row", node: nodeIdFor(folder, true), path });
  }, [folding]);

  return (
    <AnalysisShell
      rail={<CategoryRail name={name} categories={categories} />}
      map={
        <DependencyMap
          files={files}
          edges={edges}
          categories={categories}
          folding={folding}
          openFolders={openFolders}
          onOpenFoldersChange={setOpenFolders}
          selection={selection}
          onSelectionChange={setSelection}
          hovered={hovered}
          onHoverChange={setHovered}
        />
      }
      detail={
        <DetailPane
          name={name}
          adapter={adapter}
          importCount={importCount}
          files={files}
          categories={categories}
          folding={folding}
          index={index}
          selection={selection}
          hovered={hovered}
          onSelectFile={selectFile}
          onHoverChange={setHovered}
        />
      }
    />
  );
}
