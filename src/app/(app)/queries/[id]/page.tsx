import { orNotFound } from "@/server/not-found";
import Link from "next/link";
import { updateQueryAction } from "@/app/actions";
import { geoNoteFor, QueryFields } from "@/components/query-fields";
import { Flash, fmtDate, PageHeader, SentimentPill } from "@/components/ui";
import { requireCtx } from "@/server/session";
import { listBrands } from "@/server/services/brands";
import { assertQueryInWorkspace } from "@/server/services/queries";
import { loadExecRecords } from "@/server/services/reporting";

export const metadata = { title: "Edit query" };

export default async function EditQuery({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const [q, brands] = await Promise.all([orNotFound(assertQueryInWorkspace(ctx, id)), listBrands(ctx, { includeArchived: true })]);
  const history = (await loadExecRecords(ctx, { queryId: id })).reverse().slice(0, 20);
  return (
    <>
      <PageHeader title="Edit query" description="Edits apply to future runs only. Every past snapshot keeps the exact prompt and settings it ran with." />
      <Flash sp={sp} />
      <form action={updateQueryAction} className="panel mb-8 max-w-3xl space-y-4 p-5">
        <input type="hidden" name="id" value={id} />
        <div>
          <label className="label" htmlFor="text">Query</label>
          <input className="field" id="text" name="text" defaultValue={q.text} required />
        </div>
        <QueryFields brands={brands.map((b) => b.brand)} v={q} geoNote={geoNoteFor(ctx.isDemo)} />
        <button className="btn-primary">Save query</button>
      </form>
      <h2 className="mb-3 text-base font-semibold">Execution history</h2>
      <div className="panel overflow-x-auto">
        {history.length ? (
          <table className="tbl">
            <thead><tr><th>Snapshot</th><th>Prompt as sent</th><th>Status</th><th>Mentioned</th><th>Official citation</th><th>Sentiment</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.snapshotId}>
                  <td><Link className="link" href={`/snapshots/${h.snapshotId}`}>Open</Link></td>
                  <td className="max-w-xs text-slate">{h.queryText}<div className="text-xs">{h.model}, {[h.country, h.region].filter(Boolean).join(", ") || "no location"}</div></td>
                  <td>{h.status === "success" ? "OK" : <span className="text-fail">Failed</span>}</td>
                  <td>{h.status === "success" ? (h.mentioned ? "Yes" : "No") : "–"}</td>
                  <td>{h.status === "success" ? (h.citations.some((c) => c.type === "official") ? "Yes" : "No") : "–"}</td>
                  <td><SentimentPill label={h.status === "success" ? h.sentiment : null} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-8 text-center text-sm text-slate">This query has not run yet. Last edited {fmtDate(q.updatedAt)}.</p>
        )}
      </div>
    </>
  );
}
