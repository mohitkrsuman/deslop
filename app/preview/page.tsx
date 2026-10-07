import type { Metadata } from "next";
import { AnalysisShell } from "@/components/analysis-shell";
import { CategoryRail } from "@/components/canvas/category-rail";
import { DependencyMap } from "@/components/canvas/dependency-map";
import { previewName, previewResult } from "@/data/preview/snapshot";
import { categoriesOf } from "@/lib/canvas/categories";

export const metadata: Metadata = { title: `Preview · ${previewName}` };

export default function PreviewPage() {
  // Only files and edges cross to the browser; the import log and coverage
  // aren't used by the canvas yet.
  const { files, edges } = previewResult;
  const categories = categoriesOf(files);

  return (
    <AnalysisShell
      rail={<CategoryRail name={previewName} categories={categories} />}
      map={<DependencyMap files={files} edges={edges} categories={categories} />}
      detail={null}
    />
  );
}
