import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { brands, snapshots, trackingQueries } from "@/db/schema";
import type { AuthContext } from "../auth-core";
import { audit } from "../audit";
import { bulkQuerySchema, querySchema, type QueryInput } from "../validation";
import { assertBrandInWorkspace, isUuid, NotFoundError } from "./brands";

export async function assertQueryInWorkspace(ctx: AuthContext, queryId: string) {
  if (!isUuid(queryId)) throw new NotFoundError("Query");
  const [q] = await getDb()
    .select()
    .from(trackingQueries)
    .where(and(eq(trackingQueries.id, queryId), eq(trackingQueries.workspaceId, ctx.workspaceId)));
  if (!q) throw new NotFoundError("Query");
  return q;
}

export interface QueryFilters {
  brandId?: string;
  status?: "active" | "paused";
  country?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listQueries(ctx: AuthContext, f: QueryFilters = {}) {
  const db = getDb();
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const where = and(
    eq(trackingQueries.workspaceId, ctx.workspaceId),
    f.brandId ? eq(trackingQueries.brandId, f.brandId) : undefined,
    f.status ? eq(trackingQueries.status, f.status) : undefined,
    f.country ? eq(trackingQueries.country, f.country.toUpperCase()) : undefined,
    f.search ? sql`${trackingQueries.text} ilike ${"%" + f.search.replace(/[%_\\]/g, "\\$&") + "%"}` : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        query: trackingQueries,
        brandName: brands.name,
        lastRunAt: sql<Date | null>`(select max(s.executed_at) from ${snapshots} s where s.query_id = ${trackingQueries.id})`,
        snapshotCount: sql<number>`(select count(*)::int from ${snapshots} s where s.query_id = ${trackingQueries.id})`,
      })
      .from(trackingQueries)
      .innerJoin(brands, eq(brands.id, trackingQueries.brandId))
      .where(where)
      .orderBy(asc(brands.name), desc(trackingQueries.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(trackingQueries).where(where),
  ]);
  return { rows, total, page, pageSize };
}

function isUnique(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export async function createQuery(ctx: AuthContext, input: QueryInput) {
  const data = querySchema.parse(input);
  await assertBrandInWorkspace(ctx, data.brandId);
  try {
    const [q] = await getDb().insert(trackingQueries).values({ workspaceId: ctx.workspaceId, ...data }).returning();
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "query.create", entityType: "query", entityId: q.id });
    return q;
  } catch (e) {
    if (isUnique(e)) throw new Error("This query already exists for the brand with the same location and language");
    throw e;
  }
}

/** Bulk create; duplicates (same text+location+language for the brand) are skipped, not errors. */
export async function bulkCreateQueries(ctx: AuthContext, input: unknown) {
  const data = bulkQuerySchema.parse(input);
  await assertBrandInWorkspace(ctx, data.brandId);
  const { lines, ...rest } = data;
  const inserted = await getDb()
    .insert(trackingQueries)
    .values(lines.map((text) => ({ workspaceId: ctx.workspaceId, ...rest, text })))
    .onConflictDoNothing()
    .returning({ id: trackingQueries.id });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "query.bulk_create", entityType: "brand", entityId: data.brandId, meta: { requested: lines.length, created: inserted.length } });
  return { requested: lines.length, created: inserted.length, skipped: lines.length - inserted.length };
}

export async function updateQuery(ctx: AuthContext, queryId: string, input: QueryInput) {
  await assertQueryInWorkspace(ctx, queryId);
  const data = querySchema.parse(input);
  await assertBrandInWorkspace(ctx, data.brandId);
  try {
    await getDb()
      .update(trackingQueries)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(trackingQueries.id, queryId), eq(trackingQueries.workspaceId, ctx.workspaceId)));
  } catch (e) {
    if (isUnique(e)) throw new Error("This query already exists for the brand with the same location and language");
    throw e;
  }
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "query.update", entityType: "query", entityId: queryId });
}

export async function setQueryStatus(ctx: AuthContext, queryId: string, status: "active" | "paused") {
  await assertQueryInWorkspace(ctx, queryId);
  await getDb()
    .update(trackingQueries)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(trackingQueries.id, queryId), eq(trackingQueries.workspaceId, ctx.workspaceId)));
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: `query.${status}`, entityType: "query", entityId: queryId });
}

/** Queries with history cannot be deleted (that would erase snapshots). Pause them instead. */
export async function deleteQuery(ctx: AuthContext, queryId: string) {
  await assertQueryInWorkspace(ctx, queryId);
  const db = getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(snapshots).where(eq(snapshots.queryId, queryId));
  if (n > 0) throw new Error("This query has tracking history. Pause it instead of deleting so past snapshots are preserved.");
  await db.delete(trackingQueries).where(and(eq(trackingQueries.id, queryId), eq(trackingQueries.workspaceId, ctx.workspaceId)));
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "query.delete", entityType: "query", entityId: queryId });
}
