import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import {
  aiResponses,
  brandMentions,
  brands,
  citations,
  labelOverrides,
  sentimentAnalyses,
  snapshots,
  trackingQueries,
  trackingRuns,
} from "@/db/schema";
import { compareRunPair, comparabilityIssues, commonQueryIds, computeMetrics, type ExecRecord, type RunSet, type Sentiment } from "@/lib/metrics";
import type { AuthContext } from "../auth-core";
import { audit } from "../audit";
import { overrideSchema } from "../validation";
import { isUuid, NotFoundError } from "./brands";

export interface ReportFilters {
  brandId?: string;
  runIds?: string[];
  queryId?: string;
  country?: string;
  region?: string;
  from?: Date;
  to?: Date;
}

function snapshotWhere(ctx: AuthContext, f: ReportFilters): SQL | undefined {
  return and(
    eq(snapshots.workspaceId, ctx.workspaceId),
    f.brandId ? eq(snapshots.brandId, f.brandId) : undefined,
    f.runIds?.length ? inArray(snapshots.runId, f.runIds) : undefined,
    f.queryId ? eq(snapshots.queryId, f.queryId) : undefined,
    f.country ? sql`${snapshots.requestedLocation}->>'country' = ${f.country.toUpperCase()}` : undefined,
    f.region ? sql`${snapshots.requestedLocation}->>'region' ilike ${f.region}` : undefined,
    f.from ? gte(snapshots.executedAt, f.from) : undefined,
    f.to ? lte(snapshots.executedAt, f.to) : undefined,
  );
}

/** Latest manual override per snapshot+field. */
async function effectiveOverrides(snapshotIds: string[]) {
  if (!snapshotIds.length) return new Map<string, { sentiment?: string; recommendation?: string }>();
  const rows = await getDb()
    .selectDistinctOn([labelOverrides.snapshotId, labelOverrides.field], {
      snapshotId: labelOverrides.snapshotId,
      field: labelOverrides.field,
      value: labelOverrides.value,
    })
    .from(labelOverrides)
    .where(inArray(labelOverrides.snapshotId, snapshotIds))
    .orderBy(labelOverrides.snapshotId, labelOverrides.field, desc(labelOverrides.createdAt));
  const m = new Map<string, { sentiment?: string; recommendation?: string }>();
  for (const r of rows) {
    const e = m.get(r.snapshotId) ?? {};
    e[r.field] = r.value;
    m.set(r.snapshotId, e);
  }
  return m;
}

/**
 * Build metric input records. Snapshots whose analysis did not complete are
 * treated as failed executions for metric purposes (missing ≠ zero).
 */
export async function loadExecRecords(ctx: AuthContext, f: ReportFilters): Promise<ExecRecord[]> {
  const db = getDb();
  const snaps = await db
    .select({
      id: snapshots.id,
      runId: snapshots.runId,
      queryId: snapshots.queryId,
      promptText: snapshots.promptText,
      status: snapshots.status,
      analysisStatus: snapshots.analysisStatus,
      provider: snapshots.provider,
      model: snapshots.model,
      loc: snapshots.requestedLocation,
      language: snapshots.language,
      citationsAvailable: snapshots.citationsAvailable,
    })
    .from(snapshots)
    .where(snapshotWhere(ctx, f))
    .orderBy(asc(snapshots.executedAt));
  const ids = snaps.map((s) => s.id);
  if (!ids.length) return [];
  const [mentions, sentiments, cits, overrides] = await Promise.all([
    db.select().from(brandMentions).where(inArray(brandMentions.snapshotId, ids)),
    db.select({ snapshotId: sentimentAnalyses.snapshotId, label: sentimentAnalyses.label, rec: sentimentAnalyses.recommendationStatus }).from(sentimentAnalyses).where(inArray(sentimentAnalyses.snapshotId, ids)),
    db.select({ snapshotId: citations.snapshotId, normalizedUrl: citations.normalizedUrl, domain: citations.domain, type: citations.citationType }).from(citations).where(inArray(citations.snapshotId, ids)),
    effectiveOverrides(ids),
  ]);
  const group = <T extends { snapshotId: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(x.snapshotId, [...(m.get(x.snapshotId) ?? []), x]);
    return m;
  };
  const mBy = group(mentions);
  const sBy = new Map(sentiments.map((s) => [s.snapshotId, s]));
  const cBy = group(cits);
  return snaps.map((s) => {
    const ms = mBy.get(s.id) ?? [];
    const tracked = ms.find((m) => m.entityType === "tracked");
    const sent = sBy.get(s.id);
    const ov = overrides.get(s.id);
    const loc = s.loc as { country?: string | null; region?: string | null; city?: string | null };
    const ok = s.status === "success" && s.analysisStatus === "complete";
    const recStatus = ov?.recommendation ?? sent?.rec;
    return {
      snapshotId: s.id,
      runId: s.runId,
      queryId: s.queryId,
      queryText: s.promptText,
      status: ok ? "success" : "failed",
      provider: s.provider,
      model: s.model,
      country: loc.country ?? null,
      region: loc.region ?? null,
      city: loc.city ?? null,
      language: s.language,
      citationsAvailable: s.citationsAvailable,
      mentioned: !!tracked?.mentioned,
      recommended: recStatus ? recStatus === "recommended" : !!tracked?.recommended,
      sentiment: ((ov?.sentiment ?? sent?.label) as Sentiment | undefined) ?? null,
      competitorMentions: Object.fromEntries(ms.filter((m) => m.entityType === "competitor").map((m) => [m.entityName, m.mentioned])),
      citations: (cBy.get(s.id) ?? []).map((c) => ({ normalizedUrl: c.normalizedUrl, domain: c.domain, type: c.type })),
    } satisfies ExecRecord;
  });
}

export async function getDashboard(ctx: AuthContext, f: ReportFilters) {
  const db = getDb();
  const records = await loadExecRecords(ctx, f);
  const metrics = computeMetrics(records);

  const [counts] = await db
    .select({
      brands: sql<number>`(select count(*)::int from brands where workspace_id = ${ctx.workspaceId} and status = 'active')`,
      activeQueries: sql<number>`(select count(*)::int from tracking_queries where workspace_id = ${ctx.workspaceId} and status = 'active')`,
      completedRuns: sql<number>`(select count(*)::int from tracking_runs where workspace_id = ${ctx.workspaceId} and status in ('completed','partial'))`,
    })
    .from(sql`(select 1) as one`);

  // Trend: one point per run in the filtered window.
  const runIds = [...new Set(records.map((r) => r.runId))];
  const runs = runIds.length
    ? await db.select().from(trackingRuns).where(and(eq(trackingRuns.workspaceId, ctx.workspaceId), inArray(trackingRuns.id, runIds))).orderBy(asc(trackingRuns.createdAt))
    : [];
  const trend = runs.map((run) => {
    const m = computeMetrics(records.filter((r) => r.runId === run.id));
    return {
      runId: run.id,
      date: run.createdAt.toISOString(),
      mentionRate: m.mentionRate.value,
      citationRate: m.citationRate.value,
      recommendationRate: m.recommendationRate.value,
      successful: m.successful,
    };
  });

  const topDomains = await citationDomainStats(ctx, f, 8);
  const recentRuns = await db
    .select({ run: trackingRuns, brandName: brands.name })
    .from(trackingRuns)
    .innerJoin(brands, eq(brands.id, trackingRuns.brandId))
    .where(and(eq(trackingRuns.workspaceId, ctx.workspaceId), f.brandId ? eq(trackingRuns.brandId, f.brandId) : undefined))
    .orderBy(desc(trackingRuns.createdAt))
    .limit(6);
  const failedRuns = await db
    .select({ run: trackingRuns, brandName: brands.name })
    .from(trackingRuns)
    .innerJoin(brands, eq(brands.id, trackingRuns.brandId))
    .where(and(eq(trackingRuns.workspaceId, ctx.workspaceId), sql`${trackingRuns.failedJobs} > 0`, f.brandId ? eq(trackingRuns.brandId, f.brandId) : undefined))
    .orderBy(desc(trackingRuns.createdAt))
    .limit(5);

  // New / lost citations between the last two completed runs of the brand.
  let citationChanges: { baseline: string; current: string; newCitations: string[]; lostCitations: string[] } | null = null;
  if (runs.length >= 2) {
    const [a, b] = runs.slice(-2);
    const cmp = compareRunPair(toRunSet(a, records), toRunSet(b, records), { comparableOnly: true });
    citationChanges = { baseline: a.createdAt.toISOString(), current: b.createdAt.toISOString(), newCitations: cmp.newCitations.slice(0, 6), lostCitations: cmp.lostCitations.slice(0, 6) };
  }
  return { counts, metrics, trend, topDomains, recentRuns, failedRuns, citationChanges, multiBrand: !f.brandId };
}

function toRunSet(run: typeof trackingRuns.$inferSelect, records: ExecRecord[]): RunSet {
  return {
    runId: run.id,
    label: run.label ?? run.createdAt.toISOString().slice(0, 16).replace("T", " "),
    executedAt: run.createdAt,
    dataOrigin: run.dataOrigin,
    records: records.filter((r) => r.runId === run.id),
  };
}

export async function compareRuns(ctx: AuthContext, runIds: string[], opts: { comparableOnly: boolean }) {
  if (runIds.length < 2) throw new Error("Select at least two runs to compare.");
  if (runIds.length > 6) throw new Error("Compare at most six runs at once.");
  const db = getDb();
  const runs = await db
    .select()
    .from(trackingRuns)
    .where(and(eq(trackingRuns.workspaceId, ctx.workspaceId), inArray(trackingRuns.id, runIds)))
    .orderBy(asc(trackingRuns.createdAt));
  if (runs.length !== runIds.length) throw new NotFoundError("Run");
  const brandIds = [...new Set(runs.map((r) => r.brandId))];
  if (brandIds.length > 1) throw new Error("Runs must belong to the same brand to be compared.");
  const records = await loadExecRecords(ctx, { runIds });
  const sets = runs.map((r) => toRunSet(r, records));
  const issues = comparabilityIssues(sets);
  const common = commonQueryIds(sets);
  const baseline = sets[0];
  const pairs = sets.slice(1).map((s) => compareRunPair(baseline, s, { comparableOnly: opts.comparableOnly, queryFilter: opts.comparableOnly ? common : undefined }));
  return { runs, sets, issues, commonQueryCount: common.size, pairs, baselineMetrics: pairs[0]?.baseline.metrics };
}

// ---------- Citations ----------

export interface CitationFilters extends ReportFilters {
  domain?: string;
  type?: string;
  page?: number;
  pageSize?: number;
}

function citationWhere(ctx: AuthContext, f: CitationFilters) {
  return and(
    eq(citations.workspaceId, ctx.workspaceId),
    f.brandId ? eq(citations.brandId, f.brandId) : undefined,
    f.runIds?.length ? inArray(citations.runId, f.runIds) : undefined,
    f.queryId ? eq(citations.queryId, f.queryId) : undefined,
    f.country ? eq(citations.country, f.country.toUpperCase()) : undefined,
    f.region ? sql`${citations.region} ilike ${f.region}` : undefined,
    f.domain ? sql`${citations.domain} ilike ${"%" + f.domain.replace(/[%_\\]/g, "\\$&") + "%"}` : undefined,
    f.type ? sql`${citations.citationType} = ${f.type}` : undefined,
    f.from ? gte(citations.executedAt, f.from) : undefined,
    f.to ? lte(citations.executedAt, f.to) : undefined,
  );
}

export async function listCitations(ctx: AuthContext, f: CitationFilters) {
  const db = getDb();
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200);
  const page = Math.max(f.page ?? 1, 1);
  const where = citationWhere(ctx, f);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ c: citations, queryText: trackingQueries.text, brandName: brands.name, dataOrigin: snapshots.dataOrigin, model: snapshots.model })
      .from(citations)
      .innerJoin(trackingQueries, eq(trackingQueries.id, citations.queryId))
      .innerJoin(brands, eq(brands.id, citations.brandId))
      .innerJoin(snapshots, eq(snapshots.id, citations.snapshotId))
      .where(where)
      .orderBy(desc(citations.executedAt), asc(citations.position))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(citations).where(where),
  ]);
  return { rows, total, page, pageSize };
}

export async function citationDomainStats(ctx: AuthContext, f: CitationFilters, limit = 20) {
  return getDb()
    .select({
      domain: citations.domain,
      occurrences: sql<number>`count(*)::int`,
      uniqueUrls: sql<number>`count(distinct ${citations.normalizedUrl})::int`,
      snapshots: sql<number>`count(distinct ${citations.snapshotId})::int`,
      types: sql<string[]>`array_agg(distinct ${citations.citationType}::text)`,
    })
    .from(citations)
    .where(citationWhere(ctx, f))
    .groupBy(citations.domain)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
}

/** Pages that recur across distinct executions (answers), not just repeated within one. */
export async function repeatedPages(ctx: AuthContext, f: CitationFilters, limit = 20) {
  return getDb()
    .select({
      normalizedUrl: citations.normalizedUrl,
      domain: citations.domain,
      title: sql<string | null>`max(${citations.title})`,
      type: sql<string>`max(${citations.citationType}::text)`,
      answers: sql<number>`count(distinct ${citations.snapshotId})::int`,
      queries: sql<number>`count(distinct ${citations.queryId})::int`,
      runs: sql<number>`count(distinct ${citations.runId})::int`,
      firstSeen: sql<string>`min(${citations.executedAt})`,
      lastSeen: sql<string>`max(${citations.executedAt})`,
    })
    .from(citations)
    .where(citationWhere(ctx, f))
    .groupBy(citations.normalizedUrl, citations.domain)
    .having(sql`count(distinct ${citations.snapshotId}) > 1`)
    .orderBy(desc(sql`count(distinct ${citations.snapshotId})`))
    .limit(limit);
}

export async function citationFootprint(ctx: AuthContext, f: CitationFilters) {
  return getDb()
    .select({
      entity: sql<string>`coalesce(${citations.citedEntity}, 'Other sources')`,
      type: citations.citationType,
      occurrences: sql<number>`count(*)::int`,
      uniqueUrls: sql<number>`count(distinct ${citations.normalizedUrl})::int`,
      answers: sql<number>`count(distinct ${citations.snapshotId})::int`,
    })
    .from(citations)
    .where(citationWhere(ctx, f))
    .groupBy(sql`coalesce(${citations.citedEntity}, 'Other sources')`, citations.citationType)
    .orderBy(desc(sql`count(*)`));
}

export async function exportCitationsCsv(ctx: AuthContext, f: CitationFilters) {
  const rows = await getDb()
    .select({ c: citations, queryText: trackingQueries.text, brandName: brands.name, dataOrigin: snapshots.dataOrigin, provider: snapshots.provider, model: snapshots.model })
    .from(citations)
    .innerJoin(trackingQueries, eq(trackingQueries.id, citations.queryId))
    .innerJoin(brands, eq(brands.id, citations.brandId))
    .innerJoin(snapshots, eq(snapshots.id, citations.snapshotId))
    .where(citationWhere(ctx, f))
    .orderBy(desc(citations.executedAt), asc(citations.position))
    .limit(50_000);
  const header = [
    "executed_at", "data_origin", "brand", "query", "provider", "model", "country", "region", "city", "position",
    "citation_type", "cited_entity", "domain", "normalized_url", "original_url", "title", "snapshot_id", "run_id",
  ];
  const lines = rows.map(({ c, queryText, brandName, dataOrigin, provider, model }) =>
    [
      c.executedAt.toISOString(), dataOrigin, brandName, queryText, provider, model, c.country, c.region, c.city, c.position,
      c.citationType, c.citedEntity, c.domain, c.normalizedUrl, c.originalUrl, c.title, c.snapshotId, c.runId,
    ].map(csvCell).join(","),
  );
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "citations.export", meta: { rows: rows.length } });
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/** RFC 4180 quoting plus spreadsheet formula-injection protection. */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- Snapshots ----------

export async function listSnapshotsForRun(ctx: AuthContext, runId: string) {
  const db = getDb();
  return db
    .select({
      s: snapshots,
      mentioned: brandMentions.mentioned,
      recommended: brandMentions.recommended,
      inList: brandMentions.inList,
      sentiment: sentimentAnalyses.label,
      citationCount: sql<number>`(select count(*)::int from citations c where c.snapshot_id = ${snapshots.id})`,
      officialCount: sql<number>`(select count(*)::int from citations c where c.snapshot_id = ${snapshots.id} and c.citation_type = 'official')`,
    })
    .from(snapshots)
    .leftJoin(brandMentions, and(eq(brandMentions.snapshotId, snapshots.id), eq(brandMentions.entityType, "tracked")))
    .leftJoin(sentimentAnalyses, eq(sentimentAnalyses.snapshotId, snapshots.id))
    .where(and(eq(snapshots.workspaceId, ctx.workspaceId), eq(snapshots.runId, runId)))
    .orderBy(asc(snapshots.promptText));
}

export async function getSnapshot(ctx: AuthContext, snapshotId: string) {
  if (!isUuid(snapshotId)) throw new NotFoundError("Snapshot");
  const db = getDb();
  const [row] = await db
    .select({ s: snapshots, brandName: brands.name, run: trackingRuns })
    .from(snapshots)
    .innerJoin(brands, eq(brands.id, snapshots.brandId))
    .innerJoin(trackingRuns, eq(trackingRuns.id, snapshots.runId))
    .where(and(eq(snapshots.id, snapshotId), eq(snapshots.workspaceId, ctx.workspaceId)));
  if (!row) throw new NotFoundError("Snapshot");
  const [response] = await db.select().from(aiResponses).where(eq(aiResponses.snapshotId, snapshotId));
  const [mentions, cits, [sentiment], overrides] = await Promise.all([
    db.select().from(brandMentions).where(eq(brandMentions.snapshotId, snapshotId)).orderBy(asc(brandMentions.entityType), asc(brandMentions.entityName)),
    db.select().from(citations).where(eq(citations.snapshotId, snapshotId)).orderBy(asc(citations.position)),
    db.select().from(sentimentAnalyses).where(eq(sentimentAnalyses.snapshotId, snapshotId)),
    db.select().from(labelOverrides).where(eq(labelOverrides.snapshotId, snapshotId)).orderBy(desc(labelOverrides.createdAt)),
  ]);
  return { ...row, response, mentions, citations: cits, sentiment, overrides };
}

export async function addOverride(ctx: AuthContext, input: unknown) {
  const data = overrideSchema.parse(input);
  const [s] = await getDb().select({ id: snapshots.id }).from(snapshots).where(and(eq(snapshots.id, data.snapshotId), eq(snapshots.workspaceId, ctx.workspaceId)));
  if (!s) throw new NotFoundError("Snapshot");
  await getDb().insert(labelOverrides).values({ workspaceId: ctx.workspaceId, snapshotId: data.snapshotId, field: data.field, value: data.value, note: data.note, userId: ctx.userId });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "label.override", entityType: "snapshot", entityId: data.snapshotId, meta: { field: data.field, value: data.value } });
}

/** Evidence behind a metric: the executions in the numerator and denominator. */
export async function metricEvidence(ctx: AuthContext, metric: string, f: ReportFilters) {
  const records = await loadExecRecords(ctx, f);
  const ok = records.filter((r) => r.status === "success");
  const inNumerator = (r: ExecRecord) =>
    metric === "mentionRate"
      ? r.mentioned
      : metric === "recommendationRate"
        ? r.recommended
        : metric === "citationRate"
          ? r.citations.some((c) => c.type === "official")
          : metric === "anyCitationRate"
            ? r.citations.length > 0
            : false;
  const denom = metric === "citationRate" || metric === "anyCitationRate" ? ok.filter((r) => r.citationsAvailable) : ok;
  return {
    numerator: denom.filter(inNumerator),
    denominatorOnly: denom.filter((r) => !inNumerator(r)),
    excludedFailed: records.filter((r) => r.status === "failed"),
    excludedNoCitationData: metric.includes("itation") ? ok.filter((r) => !r.citationsAvailable) : [],
  };
}

// ---------- Competitors ----------

/** Per-entity visibility over successful, fully analysed executions in the filter window. */
export async function competitorAnalysis(ctx: AuthContext, f: ReportFilters) {
  if (!f.brandId) throw new Error("Select a brand");
  const db = getDb();
  const snaps = await db
    .select({ id: snapshots.id, runId: snapshots.runId })
    .from(snapshots)
    .where(and(snapshotWhere(ctx, f), eq(snapshots.status, "success"), eq(snapshots.analysisStatus, "complete")));
  const ids = snaps.map((s) => s.id);
  if (!ids.length) return { executions: 0, entities: [], byRun: [] as Array<{ runId: string; date: Date; rates: Record<string, number | null> }> };
  const [mentions, cits] = await Promise.all([
    db.select().from(brandMentions).where(inArray(brandMentions.snapshotId, ids)),
    db.select({ snapshotId: citations.snapshotId, type: citations.citationType, entity: citations.citedEntity }).from(citations).where(inArray(citations.snapshotId, ids)),
  ]);
  const names = [...new Set(mentions.map((m) => `${m.entityType}:${m.entityName}`))];
  const entities = names.map((key) => {
    const [type, name] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const rows = mentions.filter((m) => m.entityType === type && m.entityName === name);
    const ment = rows.filter((r) => r.mentioned);
    const ranks = ment.map((r) => r.listRank).filter((x): x is number => x != null);
    const citedIn = new Set(cits.filter((c) => c.entity === name && (type === "tracked" ? c.type === "official" : c.type === "competitor")).map((c) => c.snapshotId));
    const pct = (n: number) => Math.round((n / ids.length) * 10000) / 100;
    return {
      name,
      tracked: type === "tracked",
      executions: ids.length,
      mentions: ment.length,
      mentionRate: pct(ment.length),
      listRate: pct(rows.filter((r) => r.inList).length),
      recommendationRate: pct(rows.filter((r) => r.recommended).length),
      avgListRank: ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10 : null,
      ownDomainCitedRate: pct(citedIn.size),
    };
  });
  entities.sort((a, b) => Number(b.tracked) - Number(a.tracked) || b.mentionRate - a.mentionRate);
  const runIds = [...new Set(snaps.map((s) => s.runId))];
  const runs = await db.select().from(trackingRuns).where(inArray(trackingRuns.id, runIds)).orderBy(asc(trackingRuns.createdAt));
  const byRun = runs.map((run) => {
    const sIds = new Set(snaps.filter((s) => s.runId === run.id).map((s) => s.id));
    const rates: Record<string, number | null> = {};
    for (const e of entities) {
      const rows = mentions.filter((m) => sIds.has(m.snapshotId) && m.entityName === e.name && (m.entityType === "tracked") === e.tracked);
      rates[e.name] = sIds.size ? Math.round((rows.filter((r) => r.mentioned).length / sIds.size) * 10000) / 100 : null;
    }
    return { runId: run.id, date: run.createdAt, rates };
  });
  return { executions: ids.length, entities, byRun };
}
