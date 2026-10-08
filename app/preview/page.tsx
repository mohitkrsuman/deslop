import type { Metadata } from "next";
import { PreviewAnalysis } from "@/components/preview-analysis";
import { previewName, previewResult } from "@/data/preview/snapshot";

export const metadata: Metadata = { title: `Preview · ${previewName}` };

export default function PreviewPage() {
  return (
    <PreviewAnalysis
      name={previewName}
      adapter={previewResult.adapter}
      importCount={previewResult.coverage.imports.found}
      files={previewResult.files}
      edges={previewResult.edges}
    />
  );
}
