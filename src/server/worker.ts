import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { aiResponses, brandMentions, citations, jobs, sentimentAnalyses, snapshots, trackingRuns } from "@/db/schema";
import { log } from "@/lib/log";
import { getProvider } from "@/lib/providers";
import { ProviderError, type ProviderResult } from "@/lib/providers/types";
import { rateLimit } from "@/lib/ratelimit";
import { analyzeResponse } from "./pipeline";
import { getBrandEntities } from "./services/brands";
import { schedulerTick, type FrozenQuery } from "./services/runs";

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const STALE_LOCK_MS = 10 * 60 * 1000;

type JobRow = typeof jobs.$inferSelect;

export function backoffMs(attempt: number) {
  return Math.min(5 * 60_000, 5_000 * 2 ** (attempt - 1));
}

/** Atomically claim queued jobs (and reclaim stale locks) using SKIP LOCKED. */
export async function claimJobs(limit = 3): Promise<JobRow[]> {
  const db = getDb();
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'running', locked_at = now(), locked_by = ${WORKER_ID},
      attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT j.id FROM jobs j
      JOIN tracking_runs r ON r.id = j.run_id
      WHERE r.status IN ('queued','running') AND (
        (j.status = 'queued' AND j.run_after <= now())
        OR (j.status = 'running' AND j.locked_at < now() - (${STALE_LOCK_MS} || ' milliseconds')::interval)
      )
      ORDER BY j.run_after
      LIMIT ${limit}
      FOR UPDATE OF j SKIP LOCKED
    )
    RETURNING id`);
  const ids = (res.rows as Array<{ id: string }>).map((r) => r.id);
  if (!ids.length) return [];
  return db.select().from(jobs).where(inArray(jobs.id, ids));
}

async function finalizeRun(runId: string) {
  await getDb().execute(sql`
    UPDATE tracking_runs SET
      status = (CASE WHEN failed_jobs = 0 THEN 'completed' WHEN succeeded_jobs = 0 THEN 'failed' ELSE 'partial' END)::run_status,
      finished_at = now()
    WHERE id = ${runId} AND status IN ('queued','running') AND succeeded_jobs + failed_jobs >= total_jobs`);
}

async function demoRunIndex(workspaceId: string, brandId: string, runCreatedAt: Date) {
  const [{ n }] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(trackingRuns)
    .where(and(eq(trackingRuns.workspaceId, workspaceId), eq(trackingRuns.brandId, brandId), lt(trackingRuns.createdAt, runCreatedAt)));
  return n;
}

export async function processJob(job: JobRow): Promise<"succeeded" | "failed" | "retry" | "deferred" | "skipped"> {
  const db = getDb();
  const [run] = await db.select().from(trackingRuns).where(eq(trackingRuns.id, job.runId));
  if (!run || !["queued", "running"].includes(run.status)) {
    await db.update(jobs).set({ status: "dead", lastError: "Run no longer active", updatedAt: new Date() }).where(eq(jobs.id, job.id));
    return "skipped";
  }
  const q = job.querySnapshot as FrozenQuery;
  const provider = getProvider(run.provider);

  // Per-workspace provider rate limit: defer without consuming an attempt.
  const perMin = Number(process.env.PROVIDER_RATE_LIMIT_PER_MIN || 20);
  const rl = rateLimit(`provider:${run.workspaceId}:${run.provider}`, perMin, 60_000);
  if (!rl.ok) {
    await db
      .update(jobs)
      .set({ status: "queued", attempts: sql`greatest(${jobs.attempts} - 1, 0)`, runAfter: new Date(Date.now() + rl.retryAfterMs + 250), lockedAt: null, lockedBy: null, updatedAt: new Date() })
      .where(eq(jobs.id, job.id));
    return "deferred";
  }

  if (run.status === "queued") await db.update(trackingRuns).set({ status: "running", startedAt: new Date() }).where(and(eq(trackingRuns.id, run.id), eq(trackingRuns.status, "queued")));

  const entities = await getBrandEntities(run.workspaceId, run.brandId);
  const requestedLocation = { country: q.country, region: q.region, city: q.city };
  const executedAt = new Date();
  const base = {
    workspaceId: run.workspaceId,
    runId: run.id,
    brandId: run.brandId,
    queryId: job.queryId,
    provider: run.provider,
    model: run.model,
    dataOrigin: run.dataOrigin,
    promptText: q.text,
    language: q.language,
    requestedLocation,
    executedAt,
    attempt: job.attempts,
  };

  let result: ProviderResult;
  try {
    if (!provider) throw new ProviderError(`Unknown provider "${run.provider}"`, "unknown_provider", false);
    if (!provider.isConfigured()) throw new ProviderError(`${provider.label} is not configured`, "not_configured", false);
    if (provider.dataOrigin !== run.dataOrigin) throw new ProviderError("Provider data origin does not match run", "origin_mismatch", false);
    result = await provider.execute({
      prompt: q.text,
      model: run.model,
      language: q.language,
      country: q.country,
      region: q.region,
      city: q.city,
      seed: job.queryId,
      demoContext:
        provider.dataOrigin === "simulated"
          ? {
              brand: { name: entities.tracked.name, domains: entities.tracked.domains, products: entities.tracked.products },
              competitors: entities.competitors.map((c) => ({ name: c.name, domains: c.domains })),
              runIndex: await demoRunIndex(run.workspaceId, run.brandId, run.createdAt),
            }
          : undefined,
    });
  } catch (e) {
    const err = e instanceof ProviderError ? e : new ProviderError(e instanceof Error ? e.message : String(e), "internal", true);
    if (err.retryable && job.attempts < job.maxAttempts) {
      await db
        .update(jobs)
        .set({ status: "queued", runAfter: new Date(Date.now() + backoffMs(job.attempts)), lastError: err.message, lockedAt: null, lockedBy: null, updatedAt: new Date() })
        .where(eq(jobs.id, job.id));
      log("warn", "job retry scheduled", { jobId: job.id, runId: run.id, attempt: job.attempts, code: err.code });
      return "retry";
    }
    // Final failure: record an explicit FAILED snapshot (no response, no analytics).
    await db.transaction(async (tx) => {
      const [snap] = await tx
        .insert(snapshots)
        .values({ ...base, status: "failed", errorMessage: `[${err.code}] ${err.message}`.slice(0, 2000), citationsAvailable: false, analysisStatus: "skipped" })
        .onConflictDoNothing()
        .returning({ id: snapshots.id });
      await tx.update(jobs).set({ status: "dead", lastError: err.message, lockedAt: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      if (snap) await tx.update(trackingRuns).set({ failedJobs: sql`${trackingRuns.failedJobs} + 1` }).where(eq(trackingRuns.id, run.id));
    });
    await finalizeRun(run.id);
    log("error", "job failed permanently", { jobId: job.id, runId: run.id, code: err.code, error: err.message });
    return "failed";
  }

  // Analysis is pure; if it throws we still keep the raw evidence and mark analysis failed.
  let analysis: ReturnType<typeof analyzeResponse> | null = null;
  let analysisError: string | null = null;
  try {
    analysis = analyzeResponse(result, entities.tracked, entities.competitors);
  } catch (e) {
    analysisError = e instanceof Error ? e.message : String(e);
  }

  await db.transaction(async (tx) => {
    const [snap] = await tx
      .insert(snapshots)
      .values({
        ...base,
        status: "success",
        errorMessage: analysisError ? `Analysis failed: ${analysisError}` : null,
        sentLocation: result.sentLocation,
        providerReportedLocation: result.providerReportedLocation,
        citationsAvailable: result.citationsAvailable,
        analysisStatus: analysis ? "complete" : "failed",
        analysisVersion: analysis?.version ?? null,
        analysisInputs: { tracked: entities.tracked, competitors: entities.competitors },
      })
      .onConflictDoNothing()
      .returning({ id: snapshots.id });
    if (!snap) {
      // Already persisted by an earlier attempt (idempotent).
      await tx.update(jobs).set({ status: "succeeded", lockedAt: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      return;
    }
    await tx.insert(aiResponses).values({
      snapshotId: snap.id,
      workspaceId: run.workspaceId,
      responseText: result.text,
      rawPayload: result.rawPayload as object,
      providerResponseId: result.providerResponseId,
      usage: { ...(result.usage ?? {}), meta: result.meta },
      costUsd: result.costUsd == null ? null : String(result.costUsd),
      latencyMs: result.latencyMs,
    });
    if (analysis) {
      const officialHit = analysis.citations.some((c) => c.citationType === "official");
      const mentionRow = (d: typeof analysis.tracked, entityType: "tracked" | "competitor", competitorId: string | null, linked: boolean) => ({
        workspaceId: run.workspaceId,
        snapshotId: snap.id,
        brandId: run.brandId,
        competitorId,
        entityType,
        entityName: d.name,
        mentioned: d.mentioned,
        mentionCount: d.mentionCount,
        firstOffset: d.firstOffset,
        inList: d.inList,
        listRank: d.listRank,
        recommended: d.recommended,
        viaProduct: d.viaProduct,
        productTerms: d.productTerms,
        linkedViaCitation: linked,
        matches: d.matches,
      });
      await tx.insert(brandMentions).values([
        mentionRow(analysis.tracked, "tracked", null, officialHit),
        ...analysis.competitors.map((c) =>
          mentionRow(c, "competitor", c.key, analysis!.citations.some((x) => x.citationType === "competitor" && x.citedEntity === c.name)),
        ),
      ]);
      if (analysis.citations.length)
        await tx.insert(citations).values(
          analysis.citations.map((c) => ({
            workspaceId: run.workspaceId,
            snapshotId: snap.id,
            runId: run.id,
            brandId: run.brandId,
            queryId: job.queryId,
            originalUrl: c.originalUrl,
            normalizedUrl: c.normalizedUrl,
            domain: c.domain,
            title: c.title,
            position: c.position,
            startIndex: c.startIndex,
            endIndex: c.endIndex,
            citationType: c.citationType,
            citedEntity: c.citedEntity,
            country: q.country,
            region: q.region,
            city: q.city,
            executedAt,
          })),
        );
      const s = analysis.sentiment;
      await tx.insert(sentimentAnalyses).values({
        workspaceId: run.workspaceId,
        snapshotId: snap.id,
        brandId: run.brandId,
        label: s.label,
        confidence: s.confidence,
        recommendationStatus: s.recommendationStatus,
        mentionContext: s.mentionContext,
        positives: s.positives,
        negatives: s.negatives,
        attributes: s.attributes,
        competitorComparisons: s.competitorComparisons,
        explanation: s.explanation,
        excerpt: s.excerpt,
        analysisVersion: s.analysisVersion,
      });
    }
    await tx.update(jobs).set({ status: "succeeded", lastError: null, lockedAt: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
    await tx.update(trackingRuns).set({ succeededJobs: sql`${trackingRuns.succeededJobs} + 1` }).where(eq(trackingRuns.id, run.id));
  });
  await finalizeRun(run.id);
  log("info", "job succeeded", { jobId: job.id, runId: run.id, citations: analysis?.citations.length ?? 0 });
  return "succeeded";
}

/** One worker iteration: schedule due runs, then claim and process a batch. */
export async function workerTick(batch = 3) {
  try {
    await schedulerTick();
  } catch (e) {
    log("error", "scheduler tick failed", { error: String(e) });
  }
  const claimed = await claimJobs(batch);
  const results = await Promise.all(
    claimed.map((j) =>
      processJob(j).catch(async (e) => {
        log("error", "job crashed", { jobId: j.id, error: String(e) });
        await getDb()
          .update(jobs)
          .set({ status: "queued", runAfter: new Date(Date.now() + backoffMs(j.attempts)), lastError: String(e).slice(0, 1000), lockedAt: null, updatedAt: new Date() })
          .where(eq(jobs.id, j.id));
        return "retry" as const;
      }),
    ),
  );
  return results;
}

/** Drain all currently runnable jobs (used by tests and demo seeding). */
export async function drainJobs(maxIterations = 200) {
  const all: string[] = [];
  for (let i = 0; i < maxIterations; i++) {
    const r = await workerTick(5);
    if (!r.length) break;
    all.push(...r);
  }
  return all;
}

let started = false;
export function startWorkerLoop() {
  if (started) return;
  started = true;
  const poll = Number(process.env.WORKER_POLL_MS || 2000);
  log("info", "worker started", { workerId: WORKER_ID, pollMs: poll });
  const loop = async () => {
    try {
      const r = await workerTick();
      setTimeout(loop, r.length ? 50 : poll);
    } catch (e) {
      log("error", "worker tick failed", { error: String(e) });
      setTimeout(loop, poll * 3);
    }
  };
  void loop();
}
