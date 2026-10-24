import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { brandAliases, brandDomains, brands, competitors, trackingQueries } from "@/db/schema";
import { normalizeDomain } from "@/lib/url";
import type { AuthContext } from "../auth-core";
import { audit } from "../audit";
import { brandSchema, type BrandInput } from "../validation";

export class NotFoundError extends Error {
  constructor(what = "Resource") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function assertBrandInWorkspace(ctx: AuthContext, brandId: string) {
  if (!isUuid(brandId)) throw new NotFoundError("Brand");
  const [b] = await getDb()
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.workspaceId, ctx.workspaceId)));
  if (!b) throw new NotFoundError("Brand");
  return b;
}

export async function listBrands(ctx: AuthContext, opts: { includeArchived?: boolean } = {}) {
  const db = getDb();
  const rows = await db
    .select({
      brand: brands,
      queryCount: sql<number>`(select count(*)::int from ${trackingQueries} q where q.brand_id = ${brands.id})`,
      activeQueryCount: sql<number>`(select count(*)::int from ${trackingQueries} q where q.brand_id = ${brands.id} and q.status = 'active')`,
      competitorCount: sql<number>`(select count(*)::int from ${competitors} c where c.brand_id = ${brands.id})`,
      primaryDomain: sql<string | null>`(select d.domain from ${brandDomains} d where d.brand_id = ${brands.id} order by d.is_primary desc, d.created_at limit 1)`,
    })
    .from(brands)
    .where(and(eq(brands.workspaceId, ctx.workspaceId), opts.includeArchived ? undefined : eq(brands.status, "active")))
    .orderBy(asc(brands.status), asc(brands.name));
  return rows;
}

export async function getBrandDetail(ctx: AuthContext, brandId: string) {
  const brand = await assertBrandInWorkspace(ctx, brandId);
  const db = getDb();
  const [domains, aliases, comps] = await Promise.all([
    db.select().from(brandDomains).where(eq(brandDomains.brandId, brandId)).orderBy(desc(brandDomains.isPrimary), asc(brandDomains.domain)),
    db.select().from(brandAliases).where(eq(brandAliases.brandId, brandId)).orderBy(asc(brandAliases.alias)),
    db.select().from(competitors).where(eq(competitors.brandId, brandId)).orderBy(asc(competitors.name)),
  ]);
  return { brand, domains, aliases, competitors: comps };
}

/** Entity descriptions used by the analyzers. */
export async function getBrandEntities(workspaceId: string, brandId: string) {
  const db = getDb();
  const [brand] = await db.select().from(brands).where(and(eq(brands.id, brandId), eq(brands.workspaceId, workspaceId)));
  if (!brand) throw new NotFoundError("Brand");
  const [domains, aliases, comps] = await Promise.all([
    db.select().from(brandDomains).where(eq(brandDomains.brandId, brandId)),
    db.select().from(brandAliases).where(eq(brandAliases.brandId, brandId)),
    db.select().from(competitors).where(eq(competitors.brandId, brandId)),
  ]);
  return {
    brand,
    tracked: {
      key: brand.id,
      name: brand.name,
      aliases: aliases.map((a) => a.alias),
      domains: domains.map((d) => d.domain),
      products: brand.products,
    },
    competitors: comps.map((c) => ({ key: c.id, name: c.name, aliases: c.aliases, domains: c.domains, products: [] as string[] })),
  };
}

async function writeChildren(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  ctx: AuthContext,
  brandId: string,
  data: ReturnType<typeof brandSchema.parse>,
) {
  const domains = [...data.domains];
  const siteDomain = data.websiteUrl ? normalizeDomain(data.websiteUrl) : null;
  if (siteDomain && !domains.includes(siteDomain)) domains.unshift(siteDomain);

  await tx.delete(brandDomains).where(eq(brandDomains.brandId, brandId));
  if (domains.length)
    await tx.insert(brandDomains).values(
      domains.map((d, i) => ({ workspaceId: ctx.workspaceId, brandId, domain: d, isPrimary: siteDomain ? d === siteDomain : i === 0 })),
    );

  await tx.delete(brandAliases).where(eq(brandAliases.brandId, brandId));
  const aliases = [...new Map(data.aliases.filter((a) => a.toLowerCase() !== data.name.toLowerCase()).map((a) => [a.toLowerCase(), a])).values()];
  if (aliases.length) await tx.insert(brandAliases).values(aliases.map((alias) => ({ workspaceId: ctx.workspaceId, brandId, alias })));

  // Competitors are upserted by name so historical mention rows keep their competitor_id.
  const existing = await tx.select().from(competitors).where(eq(competitors.brandId, brandId));
  const wanted = new Map(data.competitors.map((c) => [c.name.toLowerCase(), c]));
  const toDelete = existing.filter((c) => !wanted.has(c.name.toLowerCase())).map((c) => c.id);
  if (toDelete.length) await tx.delete(competitors).where(inArray(competitors.id, toDelete));
  for (const c of data.competitors) {
    const ex = existing.find((e) => e.name.toLowerCase() === c.name.toLowerCase());
    if (ex) await tx.update(competitors).set({ name: c.name, aliases: c.aliases, domains: c.domains }).where(eq(competitors.id, ex.id));
    else await tx.insert(competitors).values({ workspaceId: ctx.workspaceId, brandId, name: c.name, aliases: c.aliases, domains: c.domains });
  }
}

function fields(data: ReturnType<typeof brandSchema.parse>) {
  return {
    name: data.name,
    websiteUrl: data.websiteUrl,
    industry: data.industry,
    products: data.products,
    targetCountries: data.targetCountries,
    targetRegions: data.targetRegions,
    languages: data.languages,
    notes: data.notes,
  };
}

function uniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export async function createBrand(ctx: AuthContext, input: BrandInput) {
  const data = brandSchema.parse(input);
  try {
    const brand = await getDb().transaction(async (tx) => {
      const [b] = await tx.insert(brands).values({ workspaceId: ctx.workspaceId, ...fields(data) }).returning();
      await writeChildren(tx, ctx, b.id, data);
      return b;
    });
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "brand.create", entityType: "brand", entityId: brand.id });
    return brand;
  } catch (e) {
    if (uniqueViolation(e)) throw new Error("A brand with this name already exists in the workspace");
    throw e;
  }
}

export async function updateBrand(ctx: AuthContext, brandId: string, input: BrandInput) {
  await assertBrandInWorkspace(ctx, brandId);
  const data = brandSchema.parse(input);
  try {
    await getDb().transaction(async (tx) => {
      await tx
        .update(brands)
        .set({ ...fields(data), updatedAt: new Date() })
        .where(and(eq(brands.id, brandId), eq(brands.workspaceId, ctx.workspaceId)));
      await writeChildren(tx, ctx, brandId, data);
    });
  } catch (e) {
    if (uniqueViolation(e)) throw new Error("A brand with this name already exists in the workspace");
    throw e;
  }
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "brand.update", entityType: "brand", entityId: brandId });
}

export async function setBrandArchived(ctx: AuthContext, brandId: string, archived: boolean) {
  await assertBrandInWorkspace(ctx, brandId);
  await getDb()
    .update(brands)
    .set({ status: archived ? "archived" : "active", updatedAt: new Date() })
    .where(and(eq(brands.id, brandId), eq(brands.workspaceId, ctx.workspaceId)));
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: archived ? "brand.archive" : "brand.restore", entityType: "brand", entityId: brandId });
}

/** Permanently deletes a brand and ALL of its history (snapshots cascade). Owners/admins only. */
export async function deleteBrand(ctx: AuthContext, brandId: string) {
  const b = await assertBrandInWorkspace(ctx, brandId);
  if (ctx.role === "member") throw new Error("Only owners and admins can delete brands");
  await getDb().delete(brands).where(and(eq(brands.id, brandId), eq(brands.workspaceId, ctx.workspaceId)));
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "brand.delete", entityType: "brand", entityId: brandId, meta: { name: b.name } });
}
