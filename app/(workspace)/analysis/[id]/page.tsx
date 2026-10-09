import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { rerunAnalysis } from "@/app/actions/analysis";
import { AnalysisView } from "@/components/analysis-view";
import { AnalysisSettingsButton } from "@/components/analysis-settings-button";
import { ProgressStream } from "@/components/progress-stream";
import { createServerSupabaseClient } from "@/lib/supabase";
import type { RouteRow } from "@/components/canvas/route-table";
import type { Edge, FileNode, ImportKind, ParserCoverage } from "@/lib/parser/types.mts";
import { normalizeRole } from "@/lib/taxonomy.mts";

export const maxDuration = 900;

export default async function AnalysisPage({ params }: PageProps<"/analysis/[id]">) {
  const { id } = await params;
  const { orgRole } = await auth();
  const client = createServerSupabaseClient();
  const { data: analysis, error } = await client.from("analyses")
    .select("id,name,status,stage,stage_message,stage_started_at,error_message,commit_sha,adapter,coverage,coverage_percent,import_count")
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
  const files: FileNode[] = [];
  const idToPath = new Map<string, string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error: fileError } = await client.from("files")
      .select("id,path,folder,module_id,kind,line_count,sha256,fan_in,fan_out")
      .eq("analysis_id", id).order("path").range(offset, offset + 999);
    if (fileError) throw fileError;
    for (const row of data ?? []) {
      idToPath.set(row.id, row.path);
      files.push({ path: row.path, folder: row.folder ?? ".", moduleId: row.module_id ?? row.path,
        kind: normalizeRole(adapter, row.kind ?? ""), lineCount: row.line_count ?? 0, sha256: row.sha256 ?? "",
        fanIn: row.fan_in ?? 0, fanOut: row.fan_out ?? 0 });
    }
    if (!data || data.length < 1000) break;
  }
  const edges: Edge[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error: edgeError } = await client.from("edges")
      .select("source_file_id,target_file_id,kind")
      .eq("analysis_id", id).order("id").range(offset, offset + 999);
    if (edgeError) throw edgeError;
    for (const row of data ?? []) {
      const from = idToPath.get(row.source_file_id);
      const to = idToPath.get(row.target_file_id);
      if (from && to) edges.push({ from, to, kind: row.kind as ImportKind });
    }
    if (!data || data.length < 1000) break;
  }

  const routes: RouteRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error: routeError } = await client.from("routes")
      .select("file_id,method,path")
      .eq("analysis_id", id).order("path").order("method").range(offset, offset + 999);
    if (routeError) throw routeError;
    for (const row of data ?? []) {
      const file = idToPath.get(row.file_id);
      if (file) routes.push({ file, method: row.method, path: row.path });
    }
    if (!data || data.length < 1000) break;
  }
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
      <AnalysisView name={analysis.name} adapter={adapter}
        importCount={analysis.import_count ?? 0} files={files} edges={edges} routes={routes}
        coverage={coverage}
        coveragePercent={analysis.coverage_percent ?? 100} />
    </div>
  </div>;
}
