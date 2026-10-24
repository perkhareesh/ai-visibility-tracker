import { orNotFound } from "@/server/not-found";
import { archiveBrandAction, deleteBrandAction } from "@/app/actions";
import { BrandForm } from "@/components/brand-form";
import { Flash, PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/session";
import { getBrandDetail } from "@/server/services/brands";

export const metadata = { title: "Edit brand" };

export default async function EditBrand({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const d = await orNotFound(getBrandDetail(ctx, id));
  return (
    <>
      <PageHeader title={`Edit ${d.brand.name}`} description="Changes apply to future runs. Past snapshots keep the configuration they were analysed with." />
      <Flash sp={sp} />
      <BrandForm
        v={{
          ...d.brand,
          domains: d.domains.filter((x) => !x.isPrimary || !d.brand.websiteUrl).map((x) => x.domain),
          aliases: d.aliases.map((a) => a.alias),
          competitors: d.competitors,
        }}
      />
      <div className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
        <form action={archiveBrandAction} className="panel p-5">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="archived" value={d.brand.status === "archived" ? "false" : "true"} />
          <h2 className="font-semibold">{d.brand.status === "archived" ? "Restore brand" : "Archive brand"}</h2>
          <p className="mt-1 text-sm text-slate">Archived brands stop running but keep all history.</p>
          <button className="btn-secondary mt-4">{d.brand.status === "archived" ? "Restore" : "Archive"}</button>
        </form>
        {ctx.role !== "member" && (
          <form action={deleteBrandAction} className="panel border-fail/30 p-5">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="expected" value={d.brand.name} />
            <h2 className="font-semibold text-fail">Delete brand</h2>
            <p className="mt-1 text-sm text-slate">Permanently deletes the brand, its queries and every snapshot. Type <strong>{d.brand.name}</strong> to confirm.</p>
            <input className="field mt-3" name="confirm" aria-label="Type the brand name to confirm" autoComplete="off" />
            <button className="btn-danger mt-3">Delete permanently</button>
          </form>
        )}
      </div>
    </>
  );
}
