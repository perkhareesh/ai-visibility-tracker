import Link from "next/link";
import { EntityBars } from "@/components/charts";
import { FilterBar, parseFilters } from "@/components/filters";
import { Empty, fmtDate, fmtRate, PageHeader, Section } from "@/components/ui";
import { requireCtx } from "@/server/session";
import { listBrands } from "@/server/services/brands";
import { competitorAnalysis } from "@/server/services/reporting";

export const metadata = { title: "Competitor analysis" };

export default async function Competitors({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const brands = (await listBrands(ctx)).map((b) => b.brand);
  const { values, report } = parseFilters(sp);
  const brandId = values.brandId ?? brands[0]?.id;
  if (!brandId) return (<><PageHeader title="Competitor analysis" /><Empty title="Add a brand first" action={<Link className="btn-primary" href="/brands/new">Add brand</Link>} /></>);
  const data = await competitorAnalysis(ctx, { ...report, brandId });

  return (
    <>
      <PageHeader title="Competitor analysis" description={`Measured over ${data.executions} successful executions of this brand’s queries. Competitors are only detected if they are listed on the brand.`} />
      <FilterBar values={{ ...values, brandId }} brands={brands} show={["brand", "country", "date"]} />
      {data.executions === 0 ? (
        <Empty title="No successful executions in this window">Run the tracker for this brand, or widen the date range.</Empty>
      ) : (
        <>
          <Section title="Mention rate by entity">
            <div className="panel p-4"><EntityBars data={data.entities.map((e) => ({ name: e.name, rate: e.mentionRate, tracked: e.tracked }))} /></div>
          </Section>
          <Section title="Side by side" description="All rates share one denominator: successful executions in the window.">
            <div className="panel overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Entity</th><th className="text-right">Mention rate</th><th className="text-right">In lists</th><th className="text-right">Recommended</th><th className="text-right">Avg list position</th><th className="text-right">Own site cited</th></tr></thead>
                <tbody>
                  {data.entities.map((e) => (
                    <tr key={`${e.tracked}-${e.name}`} className={e.tracked ? "bg-brand-soft/40" : ""}>
                      <td className={e.tracked ? "font-semibold text-brand" : ""}>{e.name}{e.tracked && <span className="ml-2 text-xs font-normal text-slate">tracked brand</span>}</td>
                      <td className="text-right tabular-nums">{fmtRate(e.mentionRate)}</td>
                      <td className="text-right tabular-nums">{fmtRate(e.listRate)}</td>
                      <td className="text-right tabular-nums">{fmtRate(e.recommendationRate)}</td>
                      <td className="text-right tabular-nums">{e.avgListRank ?? "–"}</td>
                      <td className="text-right tabular-nums">{fmtRate(e.ownDomainCitedRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          {data.byRun.length > 1 && (
            <Section title="Mention rate per run">
              <div className="panel overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Run</th>{data.entities.map((e) => <th key={e.name} className="text-right">{e.name}</th>)}</tr></thead>
                  <tbody>
                    {data.byRun.map((r) => (
                      <tr key={r.runId}>
                        <td><Link className="link" href={`/runs/${r.runId}`}>{fmtDate(r.date)}</Link></td>
                        {data.entities.map((e) => <td key={e.name} className="text-right tabular-nums">{fmtRate(r.rates[e.name])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      )}
    </>
  );
}
