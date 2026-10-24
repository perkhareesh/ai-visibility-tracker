import Link from "next/link";
import { Empty, Flash, fmtDate, OriginBadge, PageHeader, Pagination, RunStatus } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { requireCtx } from "@/server/session";
import { listBrands } from "@/server/services/brands";
import { listRuns } from "@/server/services/runs";

export const metadata = { title: "Run tracker" };

const STATUSES = ["queued", "running", "completed", "partial", "failed", "cancelled"];

export default async function Runs({ searchParams }: { searchParams: Promise<{ brandId?: string; status?: string; page?: string; error?: string; notice?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const brands = (await listBrands(ctx, { includeArchived: true })).map((b) => b.brand);
  const brandId = brands.some((b) => b.id === sp.brandId) ? sp.brandId : undefined;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : undefined;
  const runs = await listRuns(ctx, { brandId, status, page: Number(sp.page) || 1 });
  const inFlight = runs.rows.some((r) => ["queued", "running"].includes(r.run.status));
  return (
    <>
      <PageHeader title="Run tracker" description="Each run sends a brand’s active queries to the provider once and stores every answer as a snapshot." actions={<><AutoRefresh active={inFlight} /><Link className="btn-primary" href="/runs/new">Start a run</Link></>} />
      <Flash sp={sp} />
      <form method="get" className="mb-3 flex flex-wrap gap-2">
        <select name="brandId" defaultValue={brandId ?? ""} className="field w-auto" aria-label="Brand">
          <option value="">All brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select name="status" defaultValue={status ?? ""} className="field w-auto" aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "partial" ? "partly failed" : s}</option>)}
        </select>
        <button className="btn-secondary">Filter</button>
      </form>
      {runs.rows.length === 0 ? (
        <Empty title="No runs yet" action={<Link className="btn-primary" href="/runs/new">Start a run</Link>}>Runs appear here with their status and any failures.</Empty>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Started</th><th>Brand</th><th>Data</th><th>Provider and model</th><th>Trigger</th><th>Status</th><th className="text-right">Progress</th></tr></thead>
            <tbody>
              {runs.rows.map(({ run, brandName }) => (
                <tr key={run.id}>
                  <td className="whitespace-nowrap"><Link className="link" href={`/runs/${run.id}`}>{fmtDate(run.createdAt)}</Link>{run.label && <div className="text-xs text-slate">{run.label}</div>}</td>
                  <td>{brandName}</td>
                  <td><OriginBadge origin={run.dataOrigin} /></td>
                  <td className="text-slate">{run.provider}, {run.model}</td>
                  <td className="text-slate">{run.trigger}</td>
                  <td><RunStatus status={run.status} /></td>
                  <td className="text-right tabular-nums">
                    {run.succeededJobs + run.failedJobs}/{run.totalJobs}
                    {run.failedJobs > 0 && <div className="text-xs text-fail">{run.failedJobs} failed</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={runs.page} pageSize={runs.pageSize} total={runs.total} base={{ brandId, status }} />
    </>
  );
}
