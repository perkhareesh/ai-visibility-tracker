import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { brands, jobs, snapshots, trackingQueries, trackingRuns, trackingSchedules } from "@/db/schema";
import { getProvider, providersForWorkspace } from "@/lib/providers";
import { rateLimit } from "@/lib/ratelimit";
import type { AuthContext } from "../auth-core";
import { audit } from "../audit";
import { startRunSchema } from "../validation";
import { assertBrandInWorkspace, isUuid, NotFoundError } from "./brands";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type QueryRow = typeof trackingQueries.$inferSelect;

export interface FrozenQuery {
  text: string;
  topic: string | null;
  intent: string;
  country: string | null;
  region: string | null;
  city: string | null;
  language: string;
}

export const freezeQuery = (q: QueryRow): FrozenQuery => ({
  text: q.text,
  topic: q.topic,
  intent: q.intent,
  country: q.country,
  region: q.region,
  city: q.city,
  language: q.language,
});

/**
 * Creates a run and one job per query in a single transaction. The
 * (workspace, idempotencyKey) unique index guarantees a double-submit or a
 * duplicate scheduler tick returns the existing run instead of creating another.
 */
export async function enqueueRun(
  db: DB | Tx,
  args: {
    workspaceId: string;
    brandId: string;
    provider: string;
    model: string;
    dataOrigin: "live" | "simulated";
    trigger: "manual" | "schedule" | "retry";
    idempotencyKey: string;
    label?: string | null;
    createdBy?: string | null;
    queries: QueryRow[];
  },
) {
  return (db as DB).transaction(async (tx) => {
    const [run] = await tx
      .insert(trackingRuns)
      .values({
        workspaceId: args.workspaceId,
        brandId: args.brandId,
        provider: args.provider,
        model: args.model,
        dataOrigin: args.dataOrigin,
        trigger: args.trigger,
        idempotencyKey: args.idempotencyKey,
        label: args.label ?? null,
        createdBy: args.createdBy ?? null,
        totalJobs: args.queries.length,
      })
      .onConflictDoNothing()
      .returning();
    if (!run) {
      const [existing] = await tx
        .select()
        .from(trackingRuns)
        .where(and(eq(trackingRuns.workspaceId, args.workspaceId), eq(trackingRuns.idempotencyKey, args.idempotencyKey)));
      return { run: existing, created: false };
    }
    if (args.queries.length)
      await tx
        .insert(jobs)
        .values(args.queries.map((q) => ({ workspaceId: args.workspaceId, runId: run.id, queryId: q.id, querySnapshot: freezeQuery(q) })))
        .onConflictDoNothing();
    return { run, created: true };
  });
}

export async function startRun(ctx: AuthContext, input: unknown) {
  const data = startRunSchema.parse(input);
  const brand = await assertBrandInWorkspace(ctx, data.brandId);
  if (brand.status !== "active") throw new Error("Archived brands cannot be tracked. Restore the brand first.");
  const provider = getProvider(data.provider);
  if (!provider || !providersForWorkspace(ctx.isDemo).some((p) => p.id === provider.id))
    throw new Error(ctx.isDemo ? "Demo workspaces can only use the simulated demo provider." : "This provider is not available in live workspaces.");
  if (!provider.isConfigured()) throw new Error(`${provider.label} is not configured. ${provider.setupInstructions}`);

  const limit = rateLimit(`runs:${ctx.workspaceId}`, 10, 60_000);
  if (!limit.ok) throw new Error(`Too many runs started. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.`);

  const db = getDb();
  let queries = await db
    .select()
    .from(trackingQueries)
    .where(and(eq(trackingQueries.workspaceId, ctx.workspaceId), eq(trackingQueries.brandId, brand.id), eq(trackingQueries.status, "active")));
  if (data.queryIds?.length) {
    const wanted = new Set(data.queryIds);
    queries = queries.filter((q) => wanted.has(q.id));
  }
  if (!queries.length) throw new Error("No active queries selected for this brand.");

  const result = await enqueueRun(db, {
    workspaceId: ctx.workspaceId,
    brandId: brand.id,
    provider: provider.id,
    model: data.model,
    dataOrigin: provider.dataOrigin,
    trigger: "manual",
    idempotencyKey: data.idempotencyKey,
    label: data.label,
    createdBy: ctx.userId,
    queries,
  });
  if (result.created)
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "run.start", entityType: "run", entityId: result.run.id, meta: { queries: queries.length, provider: provider.id, model: data.model } });
  return result;
}

/** Failed executions are recovered by a new run (snapshots stay immutable). */
export async function retryFailed(ctx: AuthContext, runId: string, idempotencyKey: string) {
  const db = getDb();
  const [run] = await db.select().from(trackingRuns).where(and(eq(trackingRuns.id, runId), eq(trackingRuns.workspaceId, ctx.workspaceId)));
  if (!run) throw new NotFoundError("Run");
  const provider = getProvider(run.provider);
  if (!provider?.isConfigured()) throw new Error("The run's provider is not configured.");
  const failed = await db
    .select({ queryId: snapshots.queryId })
    .from(snapshots)
    .where(and(eq(snapshots.runId, runId), eq(snapshots.status, "failed")));
  if (!failed.length) throw new Error("This run has no failed executions to retry.");
  const queries = await db
    .select()
    .from(trackingQueries)
    .where(and(eq(trackingQueries.workspaceId, ctx.workspaceId), inArray(trackingQueries.id, failed.map((f) => f.queryId))));
  const result = await enqueueRun(db, {
    workspaceId: ctx.workspaceId,
    brandId: run.brandId,
    provider: run.provider,
    model: run.model,
    dataOrigin: run.dataOrigin,
    trigger: "retry",
    idempotencyKey,
    label: `Retry of failed queries from ${run.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    createdBy: ctx.userId,
    queries,
  });
  if (result.created)
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "run.retry", entityType: "run", entityId: result.run.id, meta: { from: runId } });
  return result;
}

export async function cancelRun(ctx: AuthContext, runId: string) {
  const db = getDb();
  const [run] = await db.select().from(trackingRuns).where(and(eq(trackingRuns.id, runId), eq(trackingRuns.workspaceId, ctx.workspaceId)));
  if (!run) throw new NotFoundError("Run");
  if (!["queued", "running"].includes(run.status)) throw new Error("Only queued or running runs can be cancelled.");
  await db.transaction(async (tx) => {
    await tx.update(jobs).set({ status: "dead", lastError: "Cancelled by user", updatedAt: new Date() }).where(and(eq(jobs.runId, runId), eq(jobs.status, "queued")));
    await tx.update(trackingRuns).set({ status: "cancelled", finishedAt: new Date() }).where(eq(trackingRuns.id, runId));
  });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "run.cancel", entityType: "run", entityId: runId });
}

export async function listRuns(ctx: AuthContext, f: { brandId?: string; status?: string; page?: number; pageSize?: number } = {}) {
  const db = getDb();
  const pageSize = Math.min(Math.max(f.pageSize ?? 20, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const where = and(
    eq(trackingRuns.workspaceId, ctx.workspaceId),
    f.brandId ? eq(trackingRuns.brandId, f.brandId) : undefined,
    f.status ? sql`${trackingRuns.status} = ${f.status}` : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ run: trackingRuns, brandName: brands.name })
      .from(trackingRuns)
      .innerJoin(brands, eq(brands.id, trackingRuns.brandId))
      .where(where)
      .orderBy(desc(trackingRuns.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(trackingRuns).where(where),
  ]);
  return { rows, total, page, pageSize };
}

export async function getRun(ctx: AuthContext, runId: string) {
  if (!isUuid(runId)) throw new NotFoundError("Run");
  const db = getDb();
  const [row] = await db
    .select({ run: trackingRuns, brandName: brands.name })
    .from(trackingRuns)
    .innerJoin(brands, eq(brands.id, trackingRuns.brandId))
    .where(and(eq(trackingRuns.id, runId), eq(trackingRuns.workspaceId, ctx.workspaceId)));
  if (!row) throw new NotFoundError("Run");
  const jobRows = await db
    .select({ job: jobs, queryText: trackingQueries.text })
    .from(jobs)
    .innerJoin(trackingQueries, eq(trackingQueries.id, jobs.queryId))
    .where(eq(jobs.runId, runId))
    .orderBy(asc(trackingQueries.text));
  return { ...row, jobs: jobRows };
}

// ---------- Schedules ----------

export function advance(from: Date, frequency: "daily" | "weekly" | "monthly", now = new Date()): Date {
  const d = new Date(from);
  do {
    if (frequency === "daily") d.setUTCDate(d.getUTCDate() + 1);
    else if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  } while (d <= now);
  return d;
}

export async function upsertSchedule(
  ctx: AuthContext,
  input: { brandId: string; frequency: "daily" | "weekly" | "monthly"; provider: string; model: string; enabled: boolean },
) {
  await assertBrandInWorkspace(ctx, input.brandId);
  const provider = getProvider(input.provider);
  if (!provider || !providersForWorkspace(ctx.isDemo).some((p) => p.id === provider.id)) throw new Error("Provider not available in this workspace.");
  if (!/^[\w.:-]{1,100}$/.test(input.model)) throw new Error("Invalid model id");
  const db = getDb();
  await db
    .insert(trackingSchedules)
    .values({ workspaceId: ctx.workspaceId, ...input, nextRunAt: new Date(Date.now() + 60_000) })
    .onConflictDoUpdate({
      target: [trackingSchedules.brandId, trackingSchedules.frequency, trackingSchedules.provider, trackingSchedules.model],
      set: { enabled: input.enabled },
    });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "schedule.upsert", entityType: "brand", entityId: input.brandId, meta: input });
}

export async function listSchedules(ctx: AuthContext, brandId: string) {
  return getDb()
    .select()
    .from(trackingSchedules)
    .where(and(eq(trackingSchedules.workspaceId, ctx.workspaceId), eq(trackingSchedules.brandId, brandId)))
    .orderBy(asc(trackingSchedules.frequency));
}

/** Enqueue due scheduled runs. Safe to call concurrently from several workers. */
export async function schedulerTick(now = new Date()) {
  const db = getDb();
  let created = 0;
  await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(trackingSchedules)
      .where(and(eq(trackingSchedules.enabled, true), lte(trackingSchedules.nextRunAt, now)))
      .for("update", { skipLocked: true })
      .limit(20);
    for (const s of due) {
      const freq = s.frequency as "daily" | "weekly" | "monthly";
      const [brand] = await tx.select().from(brands).where(eq(brands.id, s.brandId));
      const provider = getProvider(s.provider);
      const queries = await tx
        .select()
        .from(trackingQueries)
        .where(and(eq(trackingQueries.brandId, s.brandId), eq(trackingQueries.status, "active"), eq(trackingQueries.frequency, freq)));
      if (brand?.status === "active" && provider?.isConfigured() && queries.length) {
        const r = await enqueueRun(tx as unknown as DB, {
          workspaceId: s.workspaceId,
          brandId: s.brandId,
          provider: s.provider,
          model: s.model,
          dataOrigin: provider.dataOrigin,
          trigger: "schedule",
          idempotencyKey: `sched:${s.id}:${s.nextRunAt.toISOString()}`,
          label: `Scheduled ${freq} run`,
          queries,
        });
        if (r.created) created += 1;
      }
      await tx.update(trackingSchedules).set({ nextRunAt: advance(s.nextRunAt, freq, now), lastRunAt: now }).where(eq(trackingSchedules.id, s.id));
    }
  });
  return created;
}
