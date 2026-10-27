import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { citations, jobs, snapshots, trackingRuns } from "@/db/schema";
import { ProviderError } from "@/lib/providers/types";
import { createBrand, getBrandDetail, listBrands, updateBrand, deleteBrand } from "@/server/services/brands";
import { bulkCreateQueries, createQuery, deleteQuery, listQueries } from "@/server/services/queries";
import { retryFailed, startRun, schedulerTick, upsertSchedule } from "@/server/services/runs";
import { addOverride, compareRuns, exportCitationsCsv, loadExecRecords, getSnapshot, listCitations } from "@/server/services/reporting";
import { drainJobs } from "@/server/worker";
import { computeMetrics } from "@/lib/metrics";
import { resolveSession, verifyCredentials } from "@/server/auth-core";
import { makeUser, mockBehaviour, setupTestDb } from "./helpers";

const brandInput = {
  name: "Acme CRM",
  websiteUrl: "https://www.acmecrm.com",
  domains: "",
  aliases: "Acme",
  products: "Acme Pipeline",
  industry: "CRM software",
  targetCountries: "IN, US",
  targetRegions: "Karnataka",
  languages: "en",
  notes: "",
  competitors: [{ name: "HubSpot", aliases: "", domains: "hubspot.com" }, { name: "Zoho", aliases: "Zoho CRM", domains: "zoho.com" }],
};

let key = 0;
const idem = () => `test-key-${++key}-${Date.now()}`;

beforeEach(async () => {
  await setupTestDb();
  mockBehaviour.fail.clear();
  mockBehaviour.calls.length = 0;
});

describe("auth", () => {
  it("verifies credentials and rejects wrong passwords", async () => {
    await makeUser("a@x.io");
    expect(await verifyCredentials("A@X.io", "correct horse battery")).toBeTruthy();
    expect(await verifyCredentials("a@x.io", "wrong password!!")).toBeNull();
    expect(await resolveSession("not-a-token")).toBeNull();
  });
});

describe("brands & queries", () => {
  it("creates and edits a brand with domains, aliases and competitors", async () => {
    const { ctx } = await makeUser("a@x.io");
    const b = await createBrand(ctx, brandInput);
    let d = await getBrandDetail(ctx, b.id);
    expect(d.domains.map((x) => x.domain)).toEqual(["acmecrm.com"]);
    expect(d.domains[0].isPrimary).toBe(true);
    expect(d.aliases.map((a) => a.alias)).toEqual(["Acme"]);
    expect(d.competitors.map((c) => c.name)).toEqual(["HubSpot", "Zoho"]);
    expect(d.brand.targetCountries).toEqual(["IN", "US"]);

    await updateBrand(ctx, b.id, { ...brandInput, industry: "Sales CRM", competitors: [{ name: "HubSpot", aliases: "", domains: "hubspot.com" }] });
    d = await getBrandDetail(ctx, b.id);
    expect(d.brand.industry).toBe("Sales CRM");
    expect(d.competitors).toHaveLength(1);
    await expect(createBrand(ctx, brandInput)).rejects.toThrow(/already exists/);
  });

  it("supports multiple and bulk queries with dedupe", async () => {
    const { ctx } = await makeUser("a@x.io");
    const b = await createBrand(ctx, brandInput);
    await createQuery(ctx, { brandId: b.id, text: "Best CRM tools in India", country: "in", language: "en" });
    const r = await bulkCreateQueries(ctx, { brandId: b.id, lines: "Best CRM tools in India\nAlternatives to HubSpot\nTop CRM for startups", country: "IN", language: "en", intent: "commercial", frequency: "weekly", status: "active" });
    expect(r).toEqual({ requested: 3, created: 2, skipped: 1 });
    expect((await listQueries(ctx, { brandId: b.id })).total).toBe(3);
  });

  it("isolates workspaces", async () => {
    const { ctx: a } = await makeUser("a@x.io");
    const { ctx: other } = await makeUser("b@x.io", "Other");
    const b = await createBrand(a, brandInput);
    await expect(getBrandDetail(other, b.id)).rejects.toThrow(/not found/);
    await expect(createQuery(other, { brandId: b.id, text: "steal this query" })).rejects.toThrow(/not found/);
    await expect(startRun(other, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() })).rejects.toThrow(/not found/);
    expect(await listBrands(other)).toHaveLength(0);
  });

  it("demo workspaces cannot use live providers and live cannot use demo", async () => {
    const { ctx } = await makeUser("a@x.io");
    const b = await createBrand(ctx, brandInput);
    await createQuery(ctx, { brandId: b.id, text: "Best CRM tools" });
    await expect(startRun(ctx, { brandId: b.id, provider: "demo", model: "demo-sim-1", idempotencyKey: idem() })).rejects.toThrow(/not available in live/);
    await expect(startRun({ ...ctx, isDemo: true }, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() })).rejects.toThrow(/Demo workspaces/);
  });
});

describe("tracking pipeline", () => {
  async function setup() {
    const { ctx } = await makeUser("a@x.io");
    const b = await createBrand(ctx, brandInput);
    const q1 = await createQuery(ctx, { brandId: b.id, text: "Best CRM tools in India", country: "IN", region: "Karnataka" });
    const q2 = await createQuery(ctx, { brandId: b.id, text: "CRM where brand is absent", country: "IN" });
    return { ctx, b, q1, q2 };
  }

  it("executes, stores evidence and analysis on the right snapshot", async () => {
    const { ctx, b, q1 } = await setup();
    const { run } = await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() });
    await drainJobs();
    const [done] = await getDb().select().from(trackingRuns).where(eq(trackingRuns.id, run.id));
    expect(done.status).toBe("completed");
    expect(done.succeededJobs).toBe(2);

    const [snap] = await getDb().select().from(snapshots).where(eq(snapshots.queryId, q1.id));
    expect(snap.requestedLocation).toEqual({ country: "IN", region: "Karnataka", city: null });
    expect(snap.sentLocation).toMatchObject({ country: "IN" });
    expect(snap.providerReportedLocation).toBeNull();
    const detail = await getSnapshot(ctx, snap.id);
    expect(detail.response.responseText).toContain("We recommend Acme CRM");
    const tracked = detail.mentions.find((m) => m.entityType === "tracked")!;
    expect(tracked).toMatchObject({ mentioned: true, recommended: true, linkedViaCitation: true });
    expect(detail.mentions.find((m) => m.entityName === "HubSpot")!.mentioned).toBe(true);
    expect(detail.citations.map((c) => [c.domain, c.citationType])).toEqual([["acmecrm.com", "official"], ["g2.com", "third_party_mention"]]);
    expect(detail.citations[0].originalUrl).toContain("utm_source=openai");
    expect(detail.citations[0].country).toBe("IN");
    expect(detail.sentiment.label).toBe("positive");
    expect(detail.sentiment.snapshotId).toBe(snap.id);

    const m = computeMetrics(await loadExecRecords(ctx, { runIds: [run.id] }));
    expect(m.mentionRate.value).toBe(50);
    expect(m.citationRate.value).toBe(50);
    expect(m.recommendationRate.value).toBe(50);
  });

  it("is idempotent for duplicate submissions", async () => {
    const { ctx, b } = await setup();
    const k = idem();
    const r1 = await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: k });
    const r2 = await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: k });
    expect(r2.created).toBe(false);
    expect(r2.run.id).toBe(r1.run.id);
    await drainJobs();
    await drainJobs();
    const [{ n }] = await getDb().select({ n: sql<number>`count(*)::int` }).from(snapshots);
    expect(n).toBe(2);
  });

  it("never overwrites earlier snapshots; snapshots are immutable", async () => {
    const { ctx, b } = await setup();
    await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() });
    await drainJobs();
    await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() });
    await drainJobs();
    const all = await getDb().select().from(snapshots);
    expect(all).toHaveLength(4);
    const db = getDb();
    await expect(db.update(snapshots).set({ promptText: "tampered" }).where(eq(snapshots.id, all[0].id))).rejects.toThrow();
    await expect(db.update(citations).set({ domain: "x.com" })).rejects.toThrow();
    await expect(db.delete(snapshots).where(eq(snapshots.id, all[0].id))).rejects.toThrow();
  });

  it("retries transient failures, records permanent failures, and recovers via retry run", async () => {
    const { ctx, b, q1 } = await setup();
    mockBehaviour.fail.set("Best CRM tools in India", [new ProviderError("rate limited", "http_429", true, 429)]);
    mockBehaviour.fail.set("CRM where brand is absent", [new ProviderError("bad request", "http_400", false, 400)]);
    const { run } = await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() });
    await drainJobs();
    // retry was scheduled with backoff; make it runnable now
    await getDb().update(jobs).set({ runAfter: new Date(0) }).where(eq(jobs.runId, run.id));
    await drainJobs();
    const [r] = await getDb().select().from(trackingRuns).where(eq(trackingRuns.id, run.id));
    expect(r.status).toBe("partial");
    expect([r.succeededJobs, r.failedJobs]).toEqual([1, 1]);
    const snaps = await getDb().select().from(snapshots).where(eq(snapshots.runId, run.id));
    const failed = snaps.find((s) => s.status === "failed")!;
    expect(failed.errorMessage).toMatch(/http_400/);
    expect(failed.analysisStatus).toBe("skipped");
    expect(snaps.find((s) => s.queryId === q1.id)!.attempt).toBe(2);

    const recs = await loadExecRecords(ctx, { runIds: [run.id] });
    const m = computeMetrics(recs);
    expect(m.failed).toBe(1);
    expect(m.mentionRate.denominator).toBe(1); // failure not counted as zero visibility

    const retry = await retryFailed(ctx, run.id, idem());
    expect(retry.run.trigger).toBe("retry");
    expect(retry.run.totalJobs).toBe(1);
    await drainJobs();
    const [rr] = await getDb().select().from(trackingRuns).where(eq(trackingRuns.id, retry.run.id));
    expect(rr.status).toBe("completed");
  });

  it("compares runs, flags non-comparable sets and finds new/lost citations", async () => {
    const { ctx, b } = await setup();
    const a = await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() });
    await drainJobs();
    await createQuery(ctx, { brandId: b.id, text: "absent new query" });
    const c = await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-2", idempotencyKey: idem() });
    await drainJobs();
    const cmp = await compareRuns(ctx, [a.run.id, c.run.id], { comparableOnly: true });
    expect(cmp.issues.map((i) => i.kind)).toEqual(expect.arrayContaining(["query_set", "model"]));
    expect(cmp.commonQueryCount).toBe(2);
    expect(cmp.pairs[0].current.metrics.trackedPrompts).toBe(2);
    expect(cmp.pairs[0].newCitations).toEqual([]);
    const all = await compareRuns(ctx, [a.run.id, c.run.id], { comparableOnly: false });
    expect(all.pairs[0].current.metrics.trackedPrompts).toBe(3);
  });

  it("manual overrides change effective labels without mutating analysis", async () => {
    const { ctx, b, q1 } = await setup();
    const { run } = await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() });
    await drainJobs();
    const [snap] = await getDb().select().from(snapshots).where(eq(snapshots.queryId, q1.id));
    await addOverride(ctx, { snapshotId: snap.id, field: "sentiment", value: "mixed", note: "reviewed" });
    await addOverride(ctx, { snapshotId: snap.id, field: "recommendation", value: "listed" });
    const recs = await loadExecRecords(ctx, { runIds: [run.id] });
    const rec = recs.find((r) => r.snapshotId === snap.id)!;
    expect(rec.sentiment).toBe("mixed");
    expect(rec.recommended).toBe(false);
    expect((await getSnapshot(ctx, snap.id)).sentiment.label).toBe("positive");
  });

  it("exports filtered citations as safe CSV", async () => {
    const { ctx, b } = await setup();
    await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() });
    await drainJobs();
    const csv = await exportCitationsCsv(ctx, { brandId: b.id, type: "official" });
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^executed_at,data_origin,brand/);
    expect(lines[1]).toContain("acmecrm.com");
    expect(lines[1]).not.toContain("g2.com");
    expect((await listCitations(ctx, { domain: "g2" })).total).toBe(1);
  });

  it("queries with history cannot be deleted", async () => {
    const { ctx, b, q1 } = await setup();
    await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() });
    await drainJobs();
    await expect(deleteQuery(ctx, q1.id)).rejects.toThrow(/Pause it instead/);
  });

  it("scheduler enqueues due runs exactly once", async () => {
    const { ctx, b } = await setup();
    await createQuery(ctx, { brandId: b.id, text: "weekly tracked query", frequency: "weekly" });
    await upsertSchedule(ctx, { brandId: b.id, frequency: "weekly", provider: "mock-live", model: "mock-1", enabled: true });
    const future = new Date(Date.now() + 120_000);
    expect(await schedulerTick(future)).toBe(1);
    expect(await schedulerTick(future)).toBe(0);
    await drainJobs();
    const runs = await getDb().select().from(trackingRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "schedule", totalJobs: 1, status: "completed" });
  });

  it("deleting a brand removes its history (cascade allowed) but nothing else", async () => {
    const { ctx, b } = await setup();
    await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() });
    await drainJobs();
    await deleteBrand(ctx, b.id);
    const [{ n }] = await getDb().select({ n: sql<number>`count(*)::int` }).from(snapshots);
    expect(n).toBe(0);
  });
});

describe("serverless worker", () => {
  it("drainFor processes queued jobs within a time budget", async () => {
    const { ctx } = await makeUser("s@x.io");
    const b = await createBrand(ctx, brandInput);
    await createQuery(ctx, { brandId: b.id, text: "Best CRM tools in India" });
    const { run } = await startRun(ctx, { brandId: b.id, provider: "mock-live", model: "mock-1", idempotencyKey: idem() });
    const { drainFor } = await import("@/server/worker");
    expect(await drainFor(10_000)).toBe(1);
    const [r] = await getDb().select().from(trackingRuns).where(eq(trackingRuns.id, run.id));
    expect(r.status).toBe("completed");
    expect(await drainFor(10_000)).toBe(0);
  });
});
