import Link from "next/link";
import { notFound } from "next/navigation";
import { parseFilters } from "@/components/filters";
import { PageHeader } from "@/components/ui";
import { METRIC_DEFINITIONS, type ExecRecord } from "@/lib/metrics";
import { requireCtx } from "@/server/session";
import { metricEvidence } from "@/server/services/reporting";

const SUPPORTED = ["mentionRate", "citationRate", "anyCitationRate", "recommendationRate"];

export default async function Evidence({ params, searchParams }: { params: Promise<{ metric: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { metric } = await params;
  if (!SUPPORTED.includes(metric)) notFound();
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { report } = parseFilters(sp);
  const run = sp.run && /^[0-9a-f-]{36}$/i.test(sp.run) ? sp.run : undefined;
  const ev = await metricEvidence(ctx, metric, { ...report, runIds: run ? [run] : undefined });
  const def = METRIC_DEFINITIONS.find((d) => d.key === metric)!;
  const denom = ev.numerator.length + ev.denominatorOnly.length;
  return (
    <>
      <PageHeader title={def.name} description={<>{def.formula}. <Link className="link" href={`/metrics#${metric}`}>Definition</Link></>} />
      <p className="mb-6 text-lg">
        <strong>{ev.numerator.length}</strong> of <strong>{denom}</strong> eligible executions {denom ? `(${Math.round((ev.numerator.length / denom) * 1000) / 10}%)` : "(no data)"}
        {run && <span className="ml-2 text-sm text-slate">in <Link className="link" href={`/runs/${run}`}>this run</Link></span>}
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <List title="Counted in the numerator" rows={ev.numerator} />
        <List title="In the denominator only" rows={ev.denominatorOnly} />
        <List title="Excluded: failed or not analysed" rows={ev.excludedFailed} muted />
        {ev.excludedNoCitationData.length > 0 && <List title="Excluded: no citation metadata" rows={ev.excludedNoCitationData} muted />}
      </div>
    </>
  );
}

async function List({ title, rows, muted }: { title: string; rows: ExecRecord[]; muted?: boolean }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{title} ({rows.length})</h2>
      <div className="panel max-h-[480px] overflow-y-auto">
        {rows.length ? (
          <ul className="divide-y divide-line text-sm">
            {rows.map((r) => (
              <li key={r.snapshotId} className="px-4 py-2.5">
                <Link className={muted ? "text-slate hover:underline" : "link"} href={`/snapshots/${r.snapshotId}`}>{r.queryText}</Link>
                <div className="text-xs text-slate">{[r.country, r.region].filter(Boolean).join(", ") || "No location"}, {r.model}</div>
              </li>
            ))}
          </ul>
        ) : <p className="p-6 text-center text-sm text-slate">None</p>}
      </div>
    </section>
  );
}
