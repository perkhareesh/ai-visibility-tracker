import Link from "next/link";
import { EntityBars, TrendChart } from "@/components/charts";
import { FilterBar, parseFilters } from "@/components/filters";
import { Empty, Flash, fmtDate, fmtRate, Metric, OriginBadge, PageHeader, RunStatus, Section, SENT_LABEL } from "@/components/ui";
import { requireCtx } from "@/server/session";
import { listBrands } from "@/server/services/brands";
import { listQueries } from "@/server/services/queries";
import { getDashboard } from "@/server/services/reporting";

export const metadata = { title: "Overview" };

type SP = Record<string, string | string[] | undefined>;

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { values, report } = parseFilters(sp);
  const [brands, queries, d] = await Promise.all([
    listBrands(ctx),
    values.brandId ? listQueries(ctx, { brandId: values.brandId, pageSize: 100 }) : Promise.resolve(null),
    getDashboard(ctx, report),
  ]);
  const m = d.metrics;
  const qs = new URLSearchParams(Object.entries(values).filter((e): e is [string, string] => !!e[1])).toString();
  const evidence = (metric: string) => `/metrics/${metric}?${qs}`;

  if (!brands.length) {
    return (
      <>
        <PageHeader title="Overview" />
        <Flash sp={sp as { error?: string; notice?: string }} />
        <Empty title="No brands yet" action={<><Link className="btn-primary" href="/brands/new">Add a brand</Link>{!ctx.isDemo && <Link className="btn-secondary" href="/settings">Explore a demo workspace</Link>}</>}>
          Add a brand with its website and competitors, then create the prompts you want to track in AI answers.
        </Empty>
      </>
    );
  }

  const sentimentTotal = Object.values(m.sentiment).reduce((a, b) => a + b, 0);
  const trackedBrand = values.brandId ? brands.find((b) => b.brand.id === values.brandId)?.brand.name : null;

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          d.multiBrand
            ? "Rates below pool every brand in the workspace. Pick a brand to see its own visibility and competitors."
            : `Visibility of ${trackedBrand} across ${m.executions} recorded executions.`
        }
        actions={<Link href="/runs/new" className="btn-primary">Run tracker</Link>}
      />
      <Flash sp={sp as { error?: string; notice?: string }} />
      <FilterBar values={values} brands={brands.map((b) => b.brand)} queries={queries?.rows.map((r) => r.query)} show={["brand", "query", "country", "date"]} />

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Tracked brands" value={String(d.counts.brands)} href="/brands" />
        <Metric label="Active queries" value={String(d.counts.activeQueries)} href="/queries?status=active" />
        <Metric label="Completed runs" value={String(d.counts.completedRuns)} href="/runs" detail="Includes runs where some queries failed" />
        <Metric
          label="Failed executions"
          value={String(m.failed)}
          tone={m.failed ? "fail" : "ink"}
          detail={`Excluded from every rate below`}
          href={`/runs?status=partial`}
        />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Brand mention rate" tone="brand" value={fmtRate(m.mentionRate)} detail={`${m.mentionRate.numerator} of ${m.mentionRate.denominator} successful executions`} href={evidence("mentionRate")} />
        <Metric
          label="AI citation rate (any source)"
          value={fmtRate(m.anyCitationRate)}
          detail={`${m.anyCitationRate.numerator} of ${m.anyCitationRate.denominator} with citation data${m.citationMetadataUnavailable ? `; ${m.citationMetadataUnavailable} without` : ""}`}
          href={evidence("anyCitationRate")}
        />
        <Metric
          label="Official-domain citation rate"
          tone="official"
          value={fmtRate(m.citationRate)}
          detail={`${m.officialCitationCount} official citations, ${m.officialUniqueUrls} unique URLs`}
          href={evidence("citationRate")}
        />
        <Metric label="Recommendation rate" value={fmtRate(m.recommendationRate)} detail={`${m.recommendationRate.numerator} explicit recommendations`} href={evidence("recommendationRate")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Section title="Visibility by run" description="One point per tracking run in the selected window. Gaps mean no successful data, not zero.">
          <div className="panel p-4">
            {d.trend.length >= 2 ? (
              <TrendChart data={d.trend.map((t, i) => ({ ...t, label: `Run ${i + 1}, ${fmtDate(t.date).replace(" UTC", "")}` }))} />
            ) : (
              <p className="py-16 text-center text-sm text-slate">A trend appears after two or more runs in this window.</p>
            )}
          </div>
        </Section>
        <Section title="How answers portray the brand" description={`Sentiment of ${sentimentTotal} successful executions, including your manual corrections.`}>
          <div className="panel p-4">
            {sentimentTotal ? (
              <div className="space-y-2.5">
                {(["positive", "neutral", "mixed", "negative", "insufficient"] as const).map((k) => (
                  <div key={k} className="grid grid-cols-[130px_1fr_44px] items-center gap-3 text-sm">
                    <span className="text-slate">{SENT_LABEL[k]}</span>
                    <div className="h-2 rounded bg-sunken">
                      <div className="h-2 rounded bg-ink" style={{ width: `${(m.sentiment[k] / sentimentTotal) * 100}%`, opacity: k === "insufficient" ? 0.3 : k === "negative" ? 1 : 0.75 }} />
                    </div>
                    <span className="text-right tabular-nums">{m.sentiment[k]}</span>
                  </div>
                ))}
                <p className="pt-1 text-xs text-slate">“Not enough evidence” means the answer did not reference the brand.</p>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate">No analysed answers yet.</p>
            )}
          </div>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Competitor comparison"
          description={d.multiBrand ? "Select a single brand to compare it with its competitors." : `Share of successful executions mentioning each entity. Visibility share (custom): ${fmtRate(m.visibilityShare)}.`}
          actions={!d.multiBrand && <Link className="link text-sm" href={`/competitors?${qs}`}>Details</Link>}
        >
          <div className="panel p-4">
            {!d.multiBrand && m.successful ? (
              <EntityBars
                data={[
                  { name: trackedBrand ?? "Brand", rate: m.mentionRate.value, tracked: true },
                  ...Object.entries(m.competitorMentionRates).map(([name, r]) => ({ name, rate: r.value, tracked: false })),
                ]}
              />
            ) : (
              <p className="py-10 text-center text-sm text-slate">{d.multiBrand ? "Pick a brand in the filter above." : "No successful executions yet."}</p>
            )}
          </div>
        </Section>
        <Section title="Most cited domains" actions={<Link className="link text-sm" href={`/citations?${qs}`}>Citation explorer</Link>}>
          <div className="panel overflow-x-auto">
            {d.topDomains.length ? (
              <table className="tbl">
                <thead><tr><th>Domain</th><th className="text-right">Citations</th><th className="text-right">Unique URLs</th><th className="text-right">Answers</th></tr></thead>
                <tbody>
                  {d.topDomains.map((t) => (
                    <tr key={t.domain}>
                      <td><Link className="link" href={`/citations?${qs}&domain=${encodeURIComponent(t.domain)}`}>{t.domain}</Link>{t.types.includes("official") && <span className="ml-2 text-xs text-official">official</span>}</td>
                      <td className="text-right tabular-nums">{t.occurrences}</td>
                      <td className="text-right tabular-nums">{t.uniqueUrls}</td>
                      <td className="text-right tabular-nums">{t.snapshots}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-10 text-center text-sm text-slate">No citations recorded in this window.</p>
            )}
          </div>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Recent runs" actions={<Link className="link text-sm" href="/runs">All runs</Link>}>
          <div className="panel overflow-x-auto">
            {d.recentRuns.length ? (
              <table className="tbl">
                <tbody>
                  {d.recentRuns.map(({ run, brandName }) => (
                    <tr key={run.id}>
                      <td><Link className="link" href={`/runs/${run.id}`}>{brandName}</Link><div className="text-xs text-slate">{fmtDate(run.createdAt)}</div></td>
                      <td><OriginBadge origin={run.dataOrigin} /></td>
                      <td><RunStatus status={run.status} /></td>
                      <td className="text-right text-xs text-slate tabular-nums">{run.succeededJobs}/{run.totalJobs} ok</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-8 text-center text-sm text-slate">No runs yet. <Link className="link" href="/runs/new">Start one</Link>.</p>
            )}
          </div>
        </Section>
        <Section
          title="New and lost citations"
          description={d.citationChanges ? `Latest run (${fmtDate(d.citationChanges.current)}) vs the one before, shared queries only.` : "Needs two runs in the selected window."}
        >
          <div className="panel p-4 text-sm">
            {d.citationChanges ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <UrlList title={`New (${d.citationChanges.newCitations.length})`} urls={d.citationChanges.newCitations} tone="text-official" />
                <UrlList title={`Lost (${d.citationChanges.lostCitations.length})`} urls={d.citationChanges.lostCitations} tone="text-fail" />
              </div>
            ) : (
              <p className="py-6 text-center text-slate">Nothing to compare yet.</p>
            )}
          </div>
        </Section>
      </div>

      {d.failedRuns.length > 0 && (
        <Section title="Runs needing attention" description="These runs have failed executions. Open a run to see errors and retry.">
          <div className="panel overflow-x-auto">
            <table className="tbl">
              <tbody>
                {d.failedRuns.map(({ run, brandName }) => (
                  <tr key={run.id}>
                    <td><Link className="link" href={`/runs/${run.id}`}>{brandName}</Link></td>
                    <td className="text-slate">{fmtDate(run.createdAt)}</td>
                    <td><RunStatus status={run.status} /></td>
                    <td className="text-right text-fail tabular-nums">{run.failedJobs} failed</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}

function UrlList({ title, urls, tone }: { title: string; urls: string[]; tone: string }) {
  return (
    <div>
      <div className={`mb-2 font-medium ${tone}`}>{title}</div>
      {urls.length ? (
        <ul className="space-y-1.5">
          {urls.map((u) => (
            <li key={u} className="truncate"><a className="link" href={u} target="_blank" rel="noopener noreferrer nofollow">{u.replace(/^https:\/\//, "")}</a></li>
          ))}
        </ul>
      ) : (
        <p className="text-slate">None</p>
      )}
    </div>
  );
}
