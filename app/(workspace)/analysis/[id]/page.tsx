import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { rerunAnalysis } from "@/app/actions/analysis";
import { AnalysisView } from "@/components/analysis-view";
import { AnalysisSettingsButton } from "@/components/analysis-settings-button";
import { ProgressStream } from "@/components/progress-stream";
import { createServerSupabaseClient } from "@/lib/supabase";
import { tracingStatus } from "@/lib/ai/client";
import { loadAnalysisGraph } from "@/lib/analysis-graph";
import type { ParserCoverage } from "@/lib/parser/types.mts";

export const maxDuration = 900;

export default async function AnalysisPage({ params }: PageProps<"/analysis/[id]">) {
  const { id } = await params;
  const { orgRole } = await auth();
  const client = createServerSupabaseClient();
  const { data: analysis, error } = await client.from("analyses")
    .select("id,name,status,stage,stage_message,stage_started_at,error_message,commit_sha,adapter,coverage,coverage_percent,import_count,labelling_error")
    .eq("id", id).maybeSingle();
  if (error) throw error;
  if (!analysis) notFound();
  const rerun = rerunAnalysis.bind(null, id);

  if (analysis.status !== "complete") return <section className="mx-auto max-w-3xl px-4 py-10">
    <div className="mb-6 flex items-center justify-between gap-4">
      <div><Link href="/" className="text-xs text-muted hover:underline">← All analyses</Link>
        <h1 className="mt-2 text-xl font-semibold">{analysis.name}</h1></div>
      <div className="flex items-center gap-2">
        <AnalysisSettingsButton analysisId={id} projectName={analysis.name} canDelete={orgRole === "org:admin"} />
        <form action={rerun}><button className="border border-border px-3 py-2 text-xs hover:bg-surface">Run again</button></form>
      </div>
    </div>
    <ProgressStream id={id} initial={{ stage: analysis.stage, message: analysis.stage_message,
      stageStartedAt: analysis.stage_started_at, status: analysis.status }} />
    {analysis.status === "failed" && analysis.error_message &&
      <p className="mt-4 text-center text-xs text-failed">{analysis.error_message}</p>}
  </section>;

  const adapter = analysis.adapter ?? "fallback";
  const { files, edges, routes, modelRoles } = await loadAnalysisGraph(client, id, adapter);
  // Analyses stored before route notes existed have none to show.
  const storedCoverage = analysis.coverage as Partial<ParserCoverage> | null;
  const coverage: ParserCoverage = storedCoverage?.imports ? { ...storedCoverage as ParserCoverage, routeNotes: storedCoverage.routeNotes ?? [] } : {
    filesFound: files.length, filesParsed: files.length, filesSkipped: 0,
    skippedFiles: [], skippedDirectories: [], configurationWarnings: [], routeNotes: [],
    imports: { found: edges.length, resolved: edges.length, external: 0,
      excluded: 0, unresolved: 0, unresolvedExamples: [] },
  };

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4 py-2 text-xs">
      <div className="flex items-center gap-4"><Link href="/" className="text-muted hover:underline">← Analyses</Link>
        <span className="font-medium">{analysis.name}</span>
        {analysis.commit_sha && <span className="font-mono text-muted" title="Analyzed commit">{analysis.commit_sha.slice(0, 12)}</span>}
      </div>
      <div className="flex items-center gap-2">
        <AnalysisSettingsButton analysisId={id} projectName={analysis.name} canDelete={orgRole === "org:admin"} />
        <form action={rerun}><button className="border border-border px-3 py-1.5 hover:bg-background">Run again</button></form>
      </div>
    </div>
    <div className="min-h-0 flex-1">
      <AnalysisView analysisId={id} commitSha={analysis.commit_sha} name={analysis.name} adapter={adapter}
        importCount={analysis.import_count ?? 0} files={files} edges={edges} routes={routes}
        coverage={coverage}
        coveragePercent={analysis.coverage_percent ?? 100}
        modelRoles={modelRoles} labellingError={analysis.labelling_error}
        tracing={tracingStatus()} rerun={rerun} />
    </div>
  </div>;
}
