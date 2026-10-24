import Link from "next/link";
import { Empty, fmtDate, OriginBadge, PageHeader, Pagination, RunStatus } from "@/components/ui";
import { requireCtx } from "@/server/session";
import { listBrands } from "@/server/services/brands";
import { listRuns } from "@/server/services/runs";

export const metadata = { title: "Snapshot history" };

export default async function History({ searchParams }: { searchParams: Promise<{ brandId?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const brands = (await listBrands(ctx, { includeArchived: true })).map((b) => b.brand);
  const brandId = brands.find((b) => b.id === sp.brandId)?.id ?? brands[0]?.id;
  if (!brandId) return (<><PageHeader title="Snapshot history" /><Empty title="No brands yet" action={<Link className="btn-primary" href="/brands/new">Add brand</Link>} /></>);
  const runs = await listRuns(ctx, { brandId, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title="Snapshot history" description="Every run is a stored set of immutable snapshots, one per query. Tick two to six runs of the same brand to compare them." />
      <form method="get" className="mb-4 flex gap-2">
        <select name="brandId" defaultValue={brandId} className="field w-auto" aria-label="Brand">{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <button className="btn-secondary">Show</button>
      </form>
      {runs.rows.length === 0 ? (
        <Empty title="No runs for this brand yet" action={<Link className="btn-primary" href={`/runs/new?brandId=${brandId}`}>Start a run</Link>} />
      ) : (
        <form method="get" action="/compare">
          <div className="panel overflow-x-auto">
            <table className="tbl">
              <thead><tr><th className="w-10"><span className="sr-only">Select</span></th><th>Run</th><th>Data</th><th>Provider and model</th><th>Status</th><th className="text-right">Snapshots</th></tr></thead>
              <tbody>
                {runs.rows.map(({ run }) => {
                  const done = run.succeededJobs + run.failedJobs > 0 && !["queued", "running"].includes(run.status);
                  return (
                    <tr key={run.id}>
                      <td><input type="checkbox" name="runs" value={run.id} disabled={!done} aria-label={`Select run ${fmtDate(run.createdAt)}`} /></td>
                      <td><Link className="link" href={`/runs/${run.id}`}>{fmtDate(run.createdAt)}</Link>{run.label && <div className="text-xs text-slate">{run.label}</div>}</td>
                      <td><OriginBadge origin={run.dataOrigin} /></td>
                      <td className="text-slate">{run.provider}, {run.model}</td>
                      <td><RunStatus status={run.status} /></td>
                      <td className="text-right tabular-nums">{run.succeededJobs} ok{run.failedJobs > 0 && <span className="text-fail">, {run.failedJobs} failed</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button className="btn-primary">Compare selected</button>
            <span className="text-xs text-slate">The oldest selected run is the baseline.</span>
          </div>
        </form>
      )}
      <Pagination page={runs.page} pageSize={runs.pageSize} total={runs.total} base={{ brandId }} />
    </>
  );
}
