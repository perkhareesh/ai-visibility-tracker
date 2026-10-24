import Link from "next/link";
import { SafeLink } from "@/components/evidence";
import { FilterBar, parseFilters } from "@/components/filters";
import { CitationType, Empty, fmtDate, OriginBadge, PageHeader, Pagination, Section } from "@/components/ui";
import { requireCtx } from "@/server/session";
import { listBrands } from "@/server/services/brands";
import { listQueries } from "@/server/services/queries";
import { citationDomainStats, citationFootprint, compareRuns, listCitations, repeatedPages } from "@/server/services/reporting";
import { listRuns } from "@/server/services/runs";

export const metadata = { title: "Citation explorer" };

export default async function Citations({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { values, report, page } = parseFilters(sp);
  const [brands, queries] = await Promise.all([
    listBrands(ctx, { includeArchived: true }),
    values.brandId ? listQueries(ctx, { brandId: values.brandId, pageSize: 100 }) : Promise.resolve(null),
  ]);
  const [list, domains, repeated, footprint] = await Promise.all([
    listCitations(ctx, { ...report, page }),
    citationDomainStats(ctx, report, 12),
    repeatedPages(ctx, report, 10),
    values.brandId ? citationFootprint(ctx, report) : Promise.resolve([]),
  ]);
  // New / lost between the two latest finished runs of the selected brand.
  let changes: Awaited<ReturnType<typeof compareRuns>>["pairs"][number] | null = null;
  let changeRuns: Date[] = [];
  if (values.brandId) {
    const runs = (await listRuns(ctx, { brandId: values.brandId, pageSize: 20 })).rows.filter((r) => ["completed", "partial"].includes(r.run.status));
    if (runs.length >= 2) {
      const cmp = await compareRuns(ctx, [runs[1].run.id, runs[0].run.id], { comparableOnly: true });
      changes = cmp.pairs[0];
      changeRuns = [runs[1].run.createdAt, runs[0].run.createdAt];
    }
  }
  const qs = new URLSearchParams(Object.entries(values).filter((e): e is [string, string] => !!e[1])).toString();
  const footprintMax = Math.max(1, ...footprint.map((f) => f.occurrences));

  return (
    <>
      <PageHeader
        title="Citation explorer"
        description="Every source the AI answers linked to. Official means the host is one of the brand’s official domains; a third-party page that names the brand is a third-party mention."
        actions={<a className="btn-secondary" href={`/api/citations/export?${qs}`}>Export CSV</a>}
      />
      <FilterBar values={values} brands={brands.map((b) => b.brand)} queries={queries?.rows.map((r) => r.query)} show={["brand", "query", "country", "region", "domain", "type", "date"]} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Frequently cited domains" description="Occurrences count every citation; answers count distinct snapshots.">
          <div className="panel overflow-x-auto">
            {domains.length ? (
              <table className="tbl">
                <thead><tr><th>Domain</th><th className="text-right">Occurrences</th><th className="text-right">Unique URLs</th><th className="text-right">Answers</th></tr></thead>
                <tbody>
                  {domains.map((d) => (
                    <tr key={d.domain}>
                      <td><Link className="link" href={`?${qs}&domain=${encodeURIComponent(d.domain)}`}>{d.domain}</Link> <span className="ml-1 inline-flex gap-1">{d.types.map((t) => <CitationType key={t} type={t} />)}</span></td>
                      <td className="text-right tabular-nums">{d.occurrences}</td>
                      <td className="text-right tabular-nums">{d.uniqueUrls}</td>
                      <td className="text-right tabular-nums">{d.snapshots}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="p-8 text-center text-sm text-slate">No citations match these filters.</p>}
          </div>
        </Section>
        <Section title="Pages that keep appearing" description="Normalised URLs cited in more than one answer.">
          <div className="panel overflow-x-auto">
            {repeated.length ? (
              <table className="tbl">
                <thead><tr><th>Page</th><th className="text-right">Answers</th><th className="text-right">Queries</th><th className="text-right">Runs</th></tr></thead>
                <tbody>
                  {repeated.map((r) => (
                    <tr key={r.normalizedUrl}>
                      <td className="max-w-xs"><SafeLink href={r.normalizedUrl}>{r.title ?? r.normalizedUrl.replace("https://", "")}</SafeLink><div className="mt-0.5"><CitationType type={r.type} /></div></td>
                      <td className="text-right tabular-nums">{r.answers}</td>
                      <td className="text-right tabular-nums">{r.queries}</td>
                      <td className="text-right tabular-nums">{r.runs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="p-8 text-center text-sm text-slate">No page has been cited in more than one answer yet.</p>}
          </div>
        </Section>
      </div>

      {values.brandId && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Citation footprint" description="Citations grouped by whose site or which brand they point to.">
            <div className="panel space-y-2.5 p-4 text-sm">
              {footprint.length ? footprint.map((f) => (
                <div key={`${f.entity}-${f.type}`} className="grid grid-cols-[160px_1fr_40px] items-center gap-3">
                  <span className="truncate">{f.entity}<span className="block text-xs text-slate"><CitationType type={f.type} /></span></span>
                  <div className="h-2 rounded bg-sunken"><div className={`h-2 rounded ${f.type === "official" ? "bg-official" : f.type === "competitor" ? "bg-rival" : f.type === "third_party_mention" ? "bg-third" : "bg-line-strong"}`} style={{ width: `${(f.occurrences / footprintMax) * 100}%` }} /></div>
                  <span className="text-right tabular-nums">{f.occurrences}</span>
                </div>
              )) : <p className="py-6 text-center text-slate">No citations yet.</p>}
            </div>
          </Section>
          <Section title="New and lost citations" description={changes ? `${fmtDate(changeRuns[0])} → ${fmtDate(changeRuns[1])}, queries present in both runs.` : "Needs two finished runs for this brand."}>
            <div className="panel grid gap-4 p-4 text-sm sm:grid-cols-2">
              {changes ? (
                <>
                  <UrlCol title={`New (${changes.newCitations.length})`} urls={changes.newCitations} tone="text-official" />
                  <UrlCol title={`Lost (${changes.lostCitations.length})`} urls={changes.lostCitations} tone="text-fail" />
                </>
              ) : <p className="text-slate">Nothing to compare yet.</p>}
            </div>
          </Section>
        </div>
      )}

      <Section title={`Citation records (${list.total})`}>
        {list.rows.length === 0 ? (
          <Empty title="No citations match">Run the tracker, or widen the filters.</Empty>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Source</th><th>Type</th><th>Query</th><th>Location</th><th className="text-right">Pos.</th><th>When</th></tr></thead>
              <tbody>
                {list.rows.map(({ c, queryText, brandName, dataOrigin }) => (
                  <tr key={c.id}>
                    <td className="max-w-xs"><div className="font-medium">{c.domain}</div><SafeLink href={c.originalUrl}><span className="text-xs">{c.title ?? c.normalizedUrl}</span></SafeLink></td>
                    <td><CitationType type={c.citationType} />{c.citedEntity && <div className="mt-0.5 text-xs text-slate">{c.citedEntity}</div>}</td>
                    <td className="max-w-xs"><Link className="link" href={`/snapshots/${c.snapshotId}#cite-${c.position}`}>{queryText}</Link><div className="text-xs text-slate">{brandName}</div></td>
                    <td className="text-slate">{[c.country, c.region, c.city].filter(Boolean).join(", ") || "–"}</td>
                    <td className="text-right tabular-nums">{c.position ?? "–"}</td>
                    <td className="whitespace-nowrap text-slate">{fmtDate(c.executedAt)}<div className="mt-0.5"><OriginBadge origin={dataOrigin} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} base={values as Record<string, string | undefined>} />
      </Section>
    </>
  );
}

function UrlCol({ title, urls, tone }: { title: string; urls: string[]; tone: string }) {
  return (
    <div className="min-w-0">
      <div className={`mb-2 font-medium ${tone}`}>{title}</div>
      {urls.length ? <ul className="space-y-1">{urls.slice(0, 15).map((u) => <li key={u} className="truncate"><SafeLink href={u}>{u.replace("https://", "")}</SafeLink></li>)}</ul> : <p className="text-slate">None</p>}
    </div>
  );
}
