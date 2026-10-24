import { orNotFound } from "@/server/not-found";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { scheduleAction, startRunAction } from "@/app/actions";
import { Empty, Flash, fmtDate, fmtRate, Metric, OriginBadge, PageHeader, Pill, RunStatus, Section } from "@/components/ui";
import { computeMetrics } from "@/lib/metrics";
import { getProvider, providersForWorkspace } from "@/lib/providers";
import { requireCtx } from "@/server/session";
import { getBrandDetail } from "@/server/services/brands";
import { listQueries } from "@/server/services/queries";
import { loadExecRecords } from "@/server/services/reporting";
import { listRuns, listSchedules } from "@/server/services/runs";

export default async function BrandDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const [d, queries, runs, schedules] = await Promise.all([
    orNotFound(getBrandDetail(ctx, id)),
    listQueries(ctx, { brandId: id, pageSize: 100 }),
    listRuns(ctx, { brandId: id, pageSize: 8 }),
    listSchedules(ctx, id),
  ]);
  const latest = runs.rows.find((r) => ["completed", "partial"].includes(r.run.status));
  const m = latest ? computeMetrics(await loadExecRecords(ctx, { runIds: [latest.run.id] })) : null;
  const providers = providersForWorkspace(ctx.isDemo);
  const ready = providers.find((p) => p.isConfigured());
  const activeCount = queries.rows.filter((r) => r.query.status === "active").length;

  return (
    <>
      <PageHeader
        title={d.brand.name}
        description={
          <>
            {d.brand.industry ?? "No category set"}
            {d.brand.status === "archived" && <span className="ml-2"><Pill>Archived</Pill></span>}
          </>
        }
        actions={
          <>
            <Link className="btn-secondary" href={`/brands/${id}/edit`}>Edit brand</Link>
            <Link className="btn-secondary" href={`/dashboard?brandId=${id}`}>Open in overview</Link>
          </>
        }
      />
      <Flash sp={sp} />

      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        <div className="panel p-5 text-sm lg:col-span-1">
          <dl className="space-y-3">
            <div>
              <dt className="text-slate">Official domains</dt>
              <dd className="mt-0.5">{d.domains.length ? d.domains.map((x) => <span key={x.id} className="mr-2 inline-block">{x.domain}{x.isPrimary && <span className="ml-1 text-xs text-official">primary</span>}</span>) : <span className="text-fail">None. Official citations cannot be detected.</span>}</dd>
            </div>
            <div><dt className="text-slate">Aliases</dt><dd className="mt-0.5">{d.aliases.map((a) => a.alias).join(", ") || "–"}</dd></div>
            <div><dt className="text-slate">Products and services</dt><dd className="mt-0.5">{d.brand.products.join(", ") || "–"}</dd></div>
            <div><dt className="text-slate">Markets</dt><dd className="mt-0.5">{[d.brand.targetCountries.join(", "), d.brand.targetRegions.join(", ")].filter(Boolean).join("; ") || "–"}</dd></div>
            <div><dt className="text-slate">Languages</dt><dd className="mt-0.5">{d.brand.languages.join(", ") || "–"}</dd></div>
            <div>
              <dt className="text-slate">Competitors</dt>
              <dd className="mt-0.5 space-y-1">
                {d.competitors.length ? d.competitors.map((c) => <div key={c.id}>{c.name} <span className="text-slate">{c.domains.join(", ")}</span></div>) : "–"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="lg:col-span-2">
          {m && latest ? (
            <>
              <p className="mb-2 text-sm text-slate">Latest completed run, {fmtDate(latest.run.createdAt)} <OriginBadge origin={latest.run.dataOrigin} /></p>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Mention rate" tone="brand" value={fmtRate(m.mentionRate)} detail={`${m.mentionRate.numerator}/${m.mentionRate.denominator} successful executions`} href={`/metrics/mentionRate?brandId=${id}&run=${latest.run.id}`} />
                <Metric label="Official-domain citation rate" tone="official" value={fmtRate(m.citationRate)} detail={`${m.officialCitationCount} official citations`} href={`/metrics/citationRate?brandId=${id}&run=${latest.run.id}`} />
                <Metric label="Recommendation rate" value={fmtRate(m.recommendationRate)} detail={`${m.recommendationRate.numerator} explicit recommendations`} href={`/metrics/recommendationRate?brandId=${id}&run=${latest.run.id}`} />
                <Metric label="Visibility share (custom)" value={fmtRate(m.visibilityShare)} detail="Brand vs tracked competitors" href="/metrics#visibilityShare" />
              </div>
            </>
          ) : (
            <Empty title="No completed runs yet">{activeCount ? "Run the tracker to collect the first snapshot." : "Add tracking queries first."}</Empty>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Section title={`Tracking queries (${queries.total})`} actions={<Link className="link text-sm" href={`/queries?brandId=${id}`}>Manage queries</Link>}>
          <div className="panel overflow-x-auto">
            {queries.rows.length ? (
              <table className="tbl">
                <tbody>
                  {queries.rows.slice(0, 12).map(({ query, lastRunAt }) => (
                    <tr key={query.id}>
                      <td>{query.text}<div className="text-xs text-slate">{[query.country, query.region, query.city].filter(Boolean).join(", ") || "No location"}, {query.language}, {query.frequency}</div></td>
                      <td className="text-right">{query.status === "paused" ? <Pill>Paused</Pill> : <span className="text-xs text-slate">{lastRunAt ? fmtDate(lastRunAt, false) : "Never run"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-8 text-center text-sm text-slate"><Link className="link" href={`/queries?brandId=${id}`}>Add queries</Link> such as “Best {d.brand.industry ?? "tools"} in India”.</p>
            )}
          </div>
        </Section>

        <div>
          <Section title="Run now">
            {ready && activeCount > 0 && d.brand.status === "active" ? (
              <form action={startRunAction} className="panel space-y-3 p-4">
                <input type="hidden" name="brandId" value={id} />
                <input type="hidden" name="provider" value={ready.id} />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <input type="hidden" name="back" value={`/brands/${id}`} />
                <div>
                  <label className="label" htmlFor="model">Model</label>
                  <input className="field" id="model" name="model" defaultValue={ready.defaultModel()} />
                  <p className="hint">{ready.label}</p>
                </div>
                <button className="btn-primary w-full">Run {activeCount} active {activeCount === 1 ? "query" : "queries"}</button>
              </form>
            ) : (
              <div className="panel p-4 text-sm text-slate">
                {!ready ? <>No provider is configured. <Link className="link" href="/settings">See setup</Link>.</> : d.brand.status !== "active" ? "Restore the brand to run it." : "Add an active query to run."}
              </div>
            )}
          </Section>
          <Section title="Schedules" description="A schedule runs every active query of this brand that has the same frequency.">
            <div className="panel p-4 text-sm">
              {schedules.length > 0 && (
                <ul className="mb-4 space-y-1.5">
                  {schedules.map((s) => (
                    <li key={s.id} className="flex justify-between gap-2">
                      <span>{s.frequency}, {getProvider(s.provider)?.label ?? s.provider}, {s.model}</span>
                      <span className="text-slate">{s.enabled ? `next ${fmtDate(s.nextRunAt)}` : "disabled"}</span>
                    </li>
                  ))}
                </ul>
              )}
              {ready ? (
                <form action={scheduleAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="brandId" value={id} />
                  <input type="hidden" name="provider" value={ready.id} />
                  <input type="hidden" name="model" value={ready.defaultModel()} />
                  <select name="frequency" className="field w-auto" aria-label="Frequency">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  <select name="enabled" className="field w-auto" aria-label="Enabled">
                    <option value="true">Enable</option>
                    <option value="false">Disable</option>
                  </select>
                  <button className="btn-secondary">Save schedule</button>
                </form>
              ) : (
                <p className="text-slate">Configure a provider to schedule runs.</p>
              )}
            </div>
          </Section>
        </div>
      </div>

      <Section title="Recent runs" actions={<Link className="link text-sm" href={`/history?brandId=${id}`}>Snapshot history</Link>}>
        <div className="panel overflow-x-auto">
          {runs.rows.length ? (
            <table className="tbl">
              <thead><tr><th>Started</th><th>Data</th><th>Provider and model</th><th>Status</th><th className="text-right">Succeeded</th><th className="text-right">Failed</th></tr></thead>
              <tbody>
                {runs.rows.map(({ run }) => (
                  <tr key={run.id}>
                    <td><Link className="link" href={`/runs/${run.id}`}>{fmtDate(run.createdAt)}</Link></td>
                    <td><OriginBadge origin={run.dataOrigin} /></td>
                    <td className="text-slate">{run.provider}, {run.model}</td>
                    <td><RunStatus status={run.status} /></td>
                    <td className="text-right tabular-nums">{run.succeededJobs}/{run.totalJobs}</td>
                    <td className={`text-right tabular-nums ${run.failedJobs ? "text-fail" : ""}`}>{run.failedJobs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-8 text-center text-sm text-slate">No runs yet.</p>
          )}
        </div>
      </Section>
    </>
  );
}
