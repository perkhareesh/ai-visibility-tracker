import { orNotFound } from "@/server/not-found";
import Link from "next/link";
import { after } from "next/server";
import { drainFor, serverlessWorker } from "@/server/worker";
import { randomUUID } from "node:crypto";
import { cancelRunAction, retryRunAction } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { Flash, fmtDate, fmtRate, Metric, OriginBadge, PageHeader, Pill, RunStatus, Section, SentimentPill } from "@/components/ui";
import { computeMetrics } from "@/lib/metrics";
import { requireCtx } from "@/server/session";
import { listSnapshotsForRun, loadExecRecords } from "@/server/services/reporting";
import { getRun } from "@/server/services/runs";

export const metadata = { title: "Run" };

export default async function RunDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const { run, brandName, jobs } = await orNotFound(getRun(ctx, id));
  const [snaps, records] = await Promise.all([listSnapshotsForRun(ctx, id), loadExecRecords(ctx, { runIds: [id] })]);
  const m = computeMetrics(records);
  const inFlight = ["queued", "running"].includes(run.status);
  // Serverless: if nothing is currently processing this run, resume it in the background.
  if (inFlight && serverlessWorker() && !jobs.some((j) => j.job.status === "running")) after(() => drainFor(240_000).then(() => undefined));
  const bySnap = new Map(snaps.map((s) => [s.s.queryId, s]));

  return (
    <>
      <PageHeader
        title={`${brandName} run`}
        description={<>{fmtDate(run.createdAt)}, {run.provider}, model <code>{run.model}</code>, {run.trigger} {run.label && <>, “{run.label}”</>}</>}
        actions={
          <>
            <AutoRefresh active={inFlight} />
            <OriginBadge origin={run.dataOrigin} />
            <RunStatus status={run.status} />
            {inFlight && (
              <form action={cancelRunAction}><input type="hidden" name="id" value={id} /><button className="btn-secondary">Cancel run</button></form>
            )}
            {!inFlight && run.failedJobs > 0 && (
              <form action={retryRunAction}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <button className="btn-primary">Retry {run.failedJobs} failed</button>
              </form>
            )}
          </>
        }
      />
      <Flash sp={sp} />

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Executions" value={`${run.succeededJobs + run.failedJobs}/${run.totalJobs}`} detail={`${run.failedJobs} failed`} tone={run.failedJobs ? "fail" : "ink"} />
        <Metric label="Mention rate" tone="brand" value={fmtRate(m.mentionRate)} detail={`${m.mentionRate.numerator}/${m.mentionRate.denominator} successful`} href={`/metrics/mentionRate?run=${id}`} />
        <Metric label="Official-domain citation rate" tone="official" value={fmtRate(m.citationRate)} detail={`${m.officialCitationCount} official citations`} href={`/metrics/citationRate?run=${id}`} />
        <Metric label="Recommendation rate" value={fmtRate(m.recommendationRate)} href={`/metrics/recommendationRate?run=${id}`} />
      </div>

      <Section title="Executions" description="Open a row to read the full answer, citations and analysis.">
        <div className="panel overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Query</th><th>Location</th><th>Status</th><th>Mentioned</th><th>Recommended</th><th className="text-right">Citations</th><th>Sentiment</th></tr></thead>
            <tbody>
              {jobs.map(({ job, queryText }) => {
                const s = bySnap.get(job.queryId);
                const q = job.querySnapshot as { country?: string; region?: string; city?: string };
                return (
                  <tr key={job.id}>
                    <td className="max-w-sm">{s ? <Link className="link" href={`/snapshots/${s.s.id}`}>{s.s.promptText}</Link> : queryText}</td>
                    <td className="text-slate">{[q.country, q.region, q.city].filter(Boolean).join(", ") || "–"}</td>
                    <td>
                      {s ? (
                        s.s.status === "success" ? (
                          s.s.analysisStatus === "complete" ? <Pill tone="ok">Saved</Pill> : <Pill tone="third">Analysis failed</Pill>
                        ) : (
                          <span title={s.s.errorMessage ?? ""}><Pill tone="fail">Failed</Pill><div className="mt-1 max-w-56 text-xs text-fail">{s.s.errorMessage}</div></span>
                        )
                      ) : job.status === "dead" ? (
                        <Pill>Cancelled</Pill>
                      ) : (
                        <span>
                          <Pill tone="brand">{job.status === "running" ? "Running" : job.attempts > 0 ? `Retrying (attempt ${job.attempts + 1})` : "Queued"}</Pill>
                          {job.lastError && <div className="mt-1 max-w-56 text-xs text-third">{job.lastError}</div>}
                        </span>
                      )}
                    </td>
                    <td>{s?.s.status === "success" ? (s.mentioned ? <span className="text-brand">Yes{s.inList ? ", listed" : ""}</span> : "No") : "–"}</td>
                    <td>{s?.s.status === "success" ? (s.recommended ? "Yes" : "No") : "–"}</td>
                    <td className="text-right tabular-nums">{s?.s.status === "success" ? (s.s.citationsAvailable ? <>{s.citationCount}{s.officialCount > 0 && <span className="text-official"> ({s.officialCount} official)</span>}</> : <span className="text-slate">unavailable</span>) : "–"}</td>
                    <td><SentimentPill label={s?.s.status === "success" ? s.sentiment : null} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
