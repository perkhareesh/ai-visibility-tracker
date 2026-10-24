import Link from "next/link";
import { createQueryAction, queryStatusAction } from "@/app/actions";
import { geoNoteFor, QueryFields } from "@/components/query-fields";
import { Empty, Flash, fmtDate, PageHeader, Pagination, Pill } from "@/components/ui";
import { requireCtx } from "@/server/session";
import { listBrands } from "@/server/services/brands";
import { listQueries } from "@/server/services/queries";

export const metadata = { title: "Tracking queries" };

type SP = { brandId?: string; status?: string; q?: string; country?: string; page?: string; mode?: string; error?: string; notice?: string };

export default async function Queries({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const brands = (await listBrands(ctx)).map((b) => b.brand);
  const brandId = sp.brandId && brands.some((b) => b.id === sp.brandId) ? sp.brandId : undefined;
  const status = sp.status === "active" || sp.status === "paused" ? sp.status : undefined;
  const list = await listQueries(ctx, { brandId, status, search: sp.q?.slice(0, 100), country: sp.country?.slice(0, 2), page: Number(sp.page) || 1 });
  const bulk = sp.mode === "bulk";
  const backQs = new URLSearchParams(Object.entries({ brandId, status, q: sp.q, page: sp.page }).filter((e): e is [string, string] => !!e[1])).toString();
  const back = `/queries${backQs ? `?${backQs}` : ""}`;

  if (!brands.length)
    return (
      <>
        <PageHeader title="Tracking queries" />
        <Empty title="Add a brand first" action={<Link className="btn-primary" href="/brands/new">Add brand</Link>}>Queries belong to a brand.</Empty>
      </>
    );

  return (
    <>
      <PageHeader title="Tracking queries" description="The prompts sent to the AI provider. Each one runs once per tracking run and becomes a snapshot." />
      <Flash sp={sp} />

      <section className="panel mb-8 p-5">
        <div className="mb-4 flex gap-1 text-sm" role="tablist">
          <Link role="tab" aria-selected={!bulk} className={!bulk ? "btn-primary" : "btn-ghost"} href={`?${new URLSearchParams({ ...(brandId ? { brandId } : {}) })}`}>Add one</Link>
          <Link role="tab" aria-selected={bulk} className={bulk ? "btn-primary" : "btn-ghost"} href={`?${new URLSearchParams({ mode: "bulk", ...(brandId ? { brandId } : {}) })}`}>Bulk add</Link>
        </div>
        <form action={createQueryAction} className="space-y-4">
          <input type="hidden" name="mode" value={bulk ? "bulk" : "single"} />
          <input type="hidden" name="back" value={bulk ? `/queries?mode=bulk${brandId ? `&brandId=${brandId}` : ""}` : back} />
          {bulk ? (
            <div>
              <label className="label" htmlFor="lines">Queries, one per line</label>
              <textarea className="field" id="lines" name="lines" rows={6} required placeholder={"Best CRM tools in India\nTop companies offering CRM implementation\nAlternatives to HubSpot"} />
              <p className="hint">Up to 200 at a time. All share the settings below. Duplicates for the same brand, location and language are skipped.</p>
            </div>
          ) : (
            <div>
              <label className="label" htmlFor="text">Query</label>
              <input className="field" id="text" name="text" required minLength={3} maxLength={500} placeholder="Best CRM tools for small businesses in India" />
              <p className="hint">Sent to the provider exactly as written.</p>
            </div>
          )}
          <QueryFields brands={brands} v={{ brandId }} geoNote={geoNoteFor(ctx.isDemo)} />
          <button className="btn-primary">{bulk ? "Add queries" : "Add query"}</button>
        </form>
      </section>

      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <select name="brandId" defaultValue={brandId ?? ""} className="field w-auto" aria-label="Brand">
          <option value="">All brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select name="status" defaultValue={status ?? ""} className="field w-auto" aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search text" className="field w-56" aria-label="Search" />
        <button className="btn-secondary">Filter</button>
      </form>

      {list.rows.length === 0 ? (
        <Empty title="No queries match">Add queries above or change the filters.</Empty>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Query</th><th>Brand</th><th>Location and language</th><th>Intent</th><th>Frequency</th><th>Last run</th><th /></tr></thead>
            <tbody>
              {list.rows.map(({ query, brandName, lastRunAt, snapshotCount }) => (
                <tr key={query.id}>
                  <td className="max-w-sm">
                    <Link className="link" href={`/queries/${query.id}`}>{query.text}</Link>
                    {query.topic && <div className="text-xs text-slate">{query.topic}</div>}
                  </td>
                  <td className="text-slate">{brandName}</td>
                  <td className="text-slate">{[query.country, query.region, query.city].filter(Boolean).join(", ") || "No location"}<div className="text-xs">{query.language}</div></td>
                  <td className="text-slate">{query.intent}</td>
                  <td>{query.status === "paused" ? <Pill>Paused</Pill> : <span className="text-slate">{query.frequency}</span>}</td>
                  <td className="whitespace-nowrap text-slate">{lastRunAt ? fmtDate(lastRunAt, false) : "Never"}<div className="text-xs">{snapshotCount} snapshots</div></td>
                  <td className="whitespace-nowrap text-right">
                    <form action={queryStatusAction} className="inline">
                      <input type="hidden" name="id" value={query.id} />
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="status" value={query.status === "active" ? "paused" : "active"} />
                      <button className="btn-ghost px-2 py-1 text-xs">{query.status === "active" ? "Pause" : "Resume"}</button>
                    </form>
                    {snapshotCount === 0 && (
                      <form action={queryStatusAction} className="inline">
                        <input type="hidden" name="id" value={query.id} />
                        <input type="hidden" name="op" value="delete" />
                        <input type="hidden" name="back" value={back} />
                        <button className="btn-ghost px-2 py-1 text-xs text-fail">Delete</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} base={{ brandId, status, q: sp.q }} />
    </>
  );
}
