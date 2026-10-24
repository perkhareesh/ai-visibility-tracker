import Link from "next/link";
import { SafeLink } from "@/components/evidence";
import { Empty, fmtDate, fmtDelta, fmtPp, fmtRate, OriginBadge, PageHeader, Section, SENT_LABEL } from "@/components/ui";
import type { MetricSet, RunComparison } from "@/lib/metrics";
import { requireCtx } from "@/server/session";
import { compareRuns } from "@/server/services/reporting";
import { errorMessage } from "@/app/actions/util";

export const metadata = { title: "Compare snapshots" };

export default async function Compare({ searchParams }: { searchParams: Promise<{ runs?: string | string[]; all?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const runIds = [...new Set((Array.isArray(sp.runs) ? sp.runs : sp.runs ? [sp.runs] : []).filter((r) => /^[0-9a-f-]{36}$/i.test(r)))];
  const comparableOnly = sp.all !== "1";
  if (runIds.length < 2)
    return (
      <>
        <PageHeader title="Compare snapshots" />
        <Empty title="Pick two or more runs" action={<Link className="btn-primary" href="/history">Open snapshot history</Link>}>Select runs of the same brand in the snapshot history.</Empty>
      </>
    );

  let data: Awaited<ReturnType<typeof compareRuns>>;
  try {
    data = await compareRuns(ctx, runIds, { comparableOnly });
  } catch (e) {
    return (<><PageHeader title="Compare snapshots" /><Empty title="These runs cannot be compared">{errorMessage(e)}</Empty></>);
  }
  const { runs, issues, pairs, commonQueryCount } = data;
  const base = pairs[0].baseline.metrics;
  const toggle = new URLSearchParams(runIds.map((r) => ["runs", r]));
  if (comparableOnly) toggle.set("all", "1");

  const rows: Array<{ label: string; denom: string; get: (m: MetricSet) => string; delta: (p: RunComparison) => string }> = [
    { label: "Brand mention rate", denom: "successful executions", get: (m) => fmtRate(m.mentionRate), delta: (p) => fmtPp(p.rateDeltasPp.mentionRate.absolute) },
    { label: "Official-domain citation rate", denom: "successful executions with citation data", get: (m) => fmtRate(m.citationRate), delta: (p) => fmtPp(p.rateDeltasPp.citationRate.absolute) },
    { label: "AI citation rate (any source)", denom: "successful executions with citation data", get: (m) => fmtRate(m.anyCitationRate), delta: (p) => fmtPp(p.rateDeltasPp.anyCitationRate.absolute) },
    { label: "Recommendation rate", denom: "successful executions", get: (m) => fmtRate(m.recommendationRate), delta: (p) => fmtPp(p.rateDeltasPp.recommendationRate.absolute) },
    { label: "Visibility share (custom)", denom: "mentions of all tracked entities", get: (m) => fmtRate(m.visibilityShare), delta: (p) => fmtPp(p.rateDeltasPp.visibilityShare.absolute) },
    { label: "Tracked prompts", denom: "count", get: (m) => String(m.trackedPrompts), delta: (p) => fmtDelta(p.countDeltas.trackedPrompts.absolute) },
    { label: "Successful executions", denom: "count", get: (m) => `${m.successful} (${m.failed} failed)`, delta: (p) => fmtDelta(p.countDeltas.successful.absolute) },
    { label: "Official-domain citations", denom: "occurrences", get: (m) => String(m.officialCitationCount), delta: (p) => fmtDelta(p.countDeltas.officialCitationCount.absolute) },
    { label: "Unique cited URLs", denom: "count", get: (m) => String(m.uniqueCitedUrls), delta: (p) => fmtDelta(p.countDeltas.uniqueCitedUrls.absolute) },
    { label: "Unique cited domains", denom: "count", get: (m) => String(m.uniqueCitedDomains), delta: (p) => fmtDelta(p.countDeltas.uniqueCitedDomains.absolute) },
  ];

  return (
    <>
      <PageHeader
        title="Compare snapshots"
        description={<>Baseline {fmtDate(runs[0].createdAt)}, compared with {runs.length - 1} later run{runs.length > 2 ? "s" : ""}. Rate changes are percentage points (pp); counts are absolute.</>}
        actions={<Link className="btn-secondary" href={`/compare?${toggle}`}>{comparableOnly ? "Include all queries" : "Shared queries only"}</Link>}
      />

      {issues.length > 0 ? (
        <div className="mb-6 rounded-md border border-third/30 bg-third-soft p-4 text-sm text-third" role="alert">
          <strong className="font-semibold">Not fully comparable.</strong>
          <ul className="mt-1 list-disc pl-5">{issues.map((i) => <li key={i.kind}>{i.detail}</li>)}</ul>
          <p className="mt-2">{comparableOnly ? `Showing only the ${commonQueryCount} queries present in every selected run.` : "Showing all queries. Switch to shared queries for a like-for-like view."}</p>
        </div>
      ) : (
        <p className="mb-6 text-sm text-official">Same queries, provider, model, location and language in every run.</p>
      )}

      <Section title="Metrics">
        <div className="panel overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Metric and denominator</th>
                <th className="text-right">Baseline<div className="font-normal">{fmtDate(runs[0].createdAt)} <OriginBadge origin={runs[0].dataOrigin} /></div></th>
                {pairs.map((p, i) => <th key={p.current.runId} className="text-right">Run {i + 2}<div className="font-normal">{fmtDate(runs[i + 1].createdAt)} <OriginBadge origin={runs[i + 1].dataOrigin} /></div></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}<div className="text-xs text-slate">{["count", "occurrences"].includes(r.denom) ? r.denom : `per ${r.denom}`}</div></td>
                  <td className="text-right tabular-nums">{r.get(base)}</td>
                  {pairs.map((p) => (
                    <td key={p.current.runId} className="text-right tabular-nums">{r.get(p.current.metrics)}<div className="text-xs text-slate">{r.delta(p)}</div></td>
                  ))}
                </tr>
              ))}
              {(["positive", "neutral", "mixed", "negative", "insufficient"] as const).map((k) => (
                <tr key={k}>
                  <td>Sentiment: {SENT_LABEL[k]}<div className="text-xs text-slate">executions</div></td>
                  <td className="text-right tabular-nums">{base.sentiment[k]}</td>
                  {pairs.map((p) => <td key={p.current.runId} className="text-right tabular-nums">{p.current.metrics.sentiment[k]}<div className="text-xs text-slate">{fmtDelta(p.sentimentDeltas[k].absolute)}</div></td>)}
                </tr>
              ))}
              {Object.keys(base.competitorMentionRates).map((name) => (
                <tr key={name}>
                  <td>Competitor: {name}<div className="text-xs text-slate">mention rate</div></td>
                  <td className="text-right tabular-nums">{fmtRate(base.competitorMentionRates[name])}</td>
                  {pairs.map((p) => <td key={p.current.runId} className="text-right tabular-nums">{fmtRate(p.current.metrics.competitorMentionRates[name])}<div className="text-xs text-slate">{fmtPp(p.competitorDeltasPp[name]?.absolute ?? null)}</div></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {pairs.map((p, i) => (
        <Section key={p.current.runId} title={`Changes: baseline → run ${i + 2}`} description={p.mentionsNotComparable ? `${p.mentionsNotComparable} query(s) failed in one of the runs and are not counted as gained or lost.` : undefined}>
          <div className="grid gap-4 md:grid-cols-2">
            <ChangeList title="New brand mentions" items={p.newMentions.map((m) => m.queryText)} tone="text-official" />
            <ChangeList title="Lost brand mentions" items={p.lostMentions.map((m) => m.queryText)} tone="text-fail" />
            <ChangeList title="New cited URLs" items={p.newCitations} tone="text-official" links />
            <ChangeList title="Lost cited URLs" items={p.lostCitations} tone="text-fail" links />
            <ChangeList title="New cited domains" items={p.newDomains} tone="text-official" />
            <ChangeList title="Lost cited domains" items={p.lostDomains} tone="text-fail" />
          </div>
        </Section>
      ))}
    </>
  );
}

function ChangeList({ title, items, tone, links }: { title: string; items: string[]; tone: string; links?: boolean }) {
  return (
    <div className="panel min-w-0 p-4 text-sm">
      <div className={`mb-2 font-medium ${tone}`}>{title} ({items.length})</div>
      {items.length ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto">{items.map((x) => <li key={x} className="truncate">{links ? <SafeLink href={x}>{x.replace("https://", "")}</SafeLink> : x}</li>)}</ul>
      ) : <p className="text-slate">None</p>}
    </div>
  );
}
