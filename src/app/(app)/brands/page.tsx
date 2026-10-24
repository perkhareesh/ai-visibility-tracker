import Link from "next/link";
import { Empty, Flash, PageHeader, Pill } from "@/components/ui";
import { requireCtx } from "@/server/session";
import { listBrands } from "@/server/services/brands";

export const metadata = { title: "Brands" };

export default async function Brands({ searchParams }: { searchParams: Promise<{ archived?: string; error?: string; notice?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const showArchived = sp.archived === "1";
  const rows = await listBrands(ctx, { includeArchived: showArchived });
  return (
    <>
      <PageHeader
        title="Brands"
        description="Each brand has official domains, aliases and competitors. These decide what counts as a mention or an official citation."
        actions={
          <>
            <Link className="btn-ghost" href={showArchived ? "/brands" : "/brands?archived=1"}>{showArchived ? "Hide archived" : "Show archived"}</Link>
            <Link className="btn-primary" href="/brands/new">Add brand</Link>
          </>
        }
      />
      <Flash sp={sp} />
      {rows.length === 0 ? (
        <Empty title="No brands yet" action={<Link className="btn-primary" href="/brands/new">Add brand</Link>}>
          Start with the brand you want to track, its website and two or three competitors.
        </Empty>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Brand</th><th>Official domain</th><th>Industry</th><th>Markets</th><th className="text-right">Queries</th><th className="text-right">Competitors</th></tr>
            </thead>
            <tbody>
              {rows.map(({ brand, primaryDomain, queryCount, activeQueryCount, competitorCount }) => (
                <tr key={brand.id}>
                  <td>
                    <Link className="font-medium link" href={`/brands/${brand.id}`}>{brand.name}</Link>
                    {brand.status === "archived" && <span className="ml-2"><Pill>Archived</Pill></span>}
                  </td>
                  <td className="text-slate">{primaryDomain ?? <span className="text-fail">None set</span>}</td>
                  <td className="text-slate">{brand.industry ?? "–"}</td>
                  <td className="text-slate">{brand.targetCountries.join(", ") || "–"}</td>
                  <td className="text-right tabular-nums">{activeQueryCount}<span className="text-mute">/{queryCount}</span></td>
                  <td className="text-right tabular-nums">{competitorCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
