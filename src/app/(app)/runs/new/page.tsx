import Link from "next/link";
import { randomUUID } from "node:crypto";
import { startRunAction } from "@/app/actions";
import { Empty, Flash, PageHeader } from "@/components/ui";
import { providersForWorkspace } from "@/lib/providers";
import { requireCtx } from "@/server/session";
import { listBrands } from "@/server/services/brands";
import { listQueries } from "@/server/services/queries";

export const metadata = { title: "Start a run" };

export default async function NewRun({ searchParams }: { searchParams: Promise<{ brandId?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const brands = (await listBrands(ctx)).map((b) => b.brand);
  const brand = brands.find((b) => b.id === sp.brandId) ?? brands[0];
  const providers = providersForWorkspace(ctx.isDemo);
  const configured = providers.filter((p) => p.isConfigured());

  if (!brand) return (<><PageHeader title="Start a run" /><Empty title="Add a brand first" action={<Link className="btn-primary" href="/brands/new">Add brand</Link>} /></>);

  const queries = (await listQueries(ctx, { brandId: brand.id, status: "active", pageSize: 100 })).rows;
  return (
    <>
      <PageHeader title="Start a run" description="Each selected query is sent once. Results are saved as a new snapshot set; earlier runs are never changed." />
      <Flash sp={sp} />
      <form method="get" className="mb-4 flex items-end gap-2">
        <div>
          <label className="label" htmlFor="b">Brand</label>
          <select id="b" name="brandId" defaultValue={brand.id} className="field w-auto">{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </div>
        <button className="btn-secondary">Switch</button>
      </form>

      {configured.length === 0 ? (
        <div className="panel max-w-2xl p-5">
          <h2 className="font-semibold">Live tracking is not set up</h2>
          {providers.map((p) => <p key={p.id} className="mt-2 text-sm text-slate">{p.label}: {p.setupInstructions}</p>)}
          <p className="mt-3 text-sm text-slate">You can still explore the interface in a <Link className="link" href="/settings">demo workspace</Link>.</p>
        </div>
      ) : queries.length === 0 ? (
        <Empty title={`${brand.name} has no active queries`} action={<Link className="btn-primary" href={`/queries?brandId=${brand.id}`}>Add queries</Link>} />
      ) : (
        <form action={startRunAction} className="panel max-w-3xl space-y-5 p-5">
          <input type="hidden" name="brandId" value={brand.id} />
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <input type="hidden" name="back" value={`/runs/new?brandId=${brand.id}`} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="provider">Provider</label>
              <select id="provider" name="provider" className="field">{configured.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            </div>
            <div>
              <label className="label" htmlFor="model">Model</label>
              <input id="model" name="model" className="field" defaultValue={configured[0].defaultModel()} required />
            </div>
            <div>
              <label className="label" htmlFor="label">Label (optional)</label>
              <input id="label" name="label" className="field" placeholder="After pricing page launch" />
            </div>
          </div>
          <p className="text-xs text-slate">{configured[0].description}</p>
          <fieldset>
            <legend className="label">Queries ({queries.length} active). Leave all unticked to run every active query.</legend>
            <div className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {queries.map(({ query }) => (
                <label key={query.id} className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-paper">
                  <input type="checkbox" name="queryIds" value={query.id} className="mt-1" />
                  <span>{query.text}<span className="block text-xs text-slate">{[query.country, query.region, query.city].filter(Boolean).join(", ") || "No location"}, {query.language}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="btn-primary">Start run</button>
        </form>
      )}
    </>
  );
}
