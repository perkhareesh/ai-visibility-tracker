import { describe, expect, it } from "vitest";
import { compareRunPair, comparabilityIssues, computeMetrics, type ExecRecord, type RunSet } from "@/lib/metrics";

let n = 0;
const rec = (p: Partial<ExecRecord>): ExecRecord => ({
  snapshotId: `s${n++}`, runId: "r1", queryId: "q1", queryText: "q", status: "success", provider: "openai", model: "m",
  country: "IN", region: null, city: null, language: "en", citationsAvailable: true, mentioned: false, recommended: false,
  sentiment: "neutral", competitorMentions: {}, citations: [], ...p,
});
const off = (u: string) => ({ normalizedUrl: u, domain: "acme.com", type: "official" });

describe("computeMetrics", () => {
  it("excludes failed executions from denominators", () => {
    const m = computeMetrics([rec({ mentioned: true }), rec({ queryId: "q2" }), rec({ queryId: "q3", status: "failed" })]);
    expect(m.mentionRate).toEqual({ numerator: 1, denominator: 2, value: 50 });
    expect(m.failed).toBe(1);
    expect(m.trackedPrompts).toBe(3);
  });

  it("returns null (not 0) when there is no successful data", () => {
    const m = computeMetrics([rec({ status: "failed" })]);
    expect(m.mentionRate.value).toBeNull();
    expect(m.citationRate.value).toBeNull();
    expect(computeMetrics([]).mentionRate.value).toBeNull();
  });

  it("excludes executions without citation metadata from citation rate", () => {
    const m = computeMetrics([
      rec({ citations: [off("https://acme.com/a")] }),
      rec({ queryId: "q2" }),
      rec({ queryId: "q3", citationsAvailable: false }),
    ]);
    expect(m.citationRate).toEqual({ numerator: 1, denominator: 2, value: 50 });
    expect(m.citationMetadataUnavailable).toBe(1);
  });

  it("separates occurrences, unique URLs and unique domains", () => {
    const m = computeMetrics([
      rec({ citations: [off("https://acme.com/a"), off("https://acme.com/a"), { normalizedUrl: "https://g2.com/x", domain: "g2.com", type: "third_party_mention" }] }),
      rec({ queryId: "q2", citations: [off("https://acme.com/a")] }),
    ]);
    expect(m.officialCitationCount).toBe(3);
    expect(m.officialUniqueUrls).toBe(1);
    expect(m.totalCitationOccurrences).toBe(4);
    expect(m.uniqueCitedUrls).toBe(2);
    expect(m.uniqueCitedDomains).toBe(2);
    expect(m.citationRate.value).toBe(100);
  });

  it("third-party mentions do not count toward official citation rate", () => {
    const m = computeMetrics([rec({ citations: [{ normalizedUrl: "https://g2.com/x", domain: "g2.com", type: "third_party_mention" }] })]);
    expect(m.citationRate.value).toBe(0);
    expect(m.anyCitationRate.value).toBe(100);
  });

  it("computes visibility share across tracked entities", () => {
    const m = computeMetrics([
      rec({ mentioned: true, competitorMentions: { Rival: true } }),
      rec({ queryId: "q2", mentioned: false, competitorMentions: { Rival: true } }),
    ]);
    expect(m.visibilityShare).toEqual({ numerator: 1, denominator: 3, value: 33.33 });
    expect(m.competitorMentionRates.Rival.value).toBe(100);
  });

  it("counts sentiment and recommendation", () => {
    const m = computeMetrics([rec({ sentiment: "positive", recommended: true }), rec({ queryId: "q2", sentiment: "mixed" })]);
    expect(m.sentiment.positive).toBe(1);
    expect(m.sentiment.mixed).toBe(1);
    expect(m.recommendationRate.value).toBe(50);
  });
});

const set = (runId: string, records: ExecRecord[], dataOrigin: "live" | "simulated" = "live"): RunSet => ({
  runId, label: runId, executedAt: new Date(), dataOrigin, records: records.map((r) => ({ ...r, runId })),
});

describe("comparison", () => {
  const A = set("A", [
    rec({ queryId: "q1", mentioned: true, citations: [off("https://acme.com/old")] }),
    rec({ queryId: "q2", mentioned: true }),
    rec({ queryId: "q3", mentioned: false }),
  ]);
  const B = set("B", [
    rec({ queryId: "q1", mentioned: true, citations: [off("https://acme.com/new")] }),
    rec({ queryId: "q2", mentioned: false }),
    rec({ queryId: "q3", status: "failed" }),
    rec({ queryId: "q4", mentioned: true }),
  ]);

  it("flags differing query sets", () => {
    expect(comparabilityIssues([A, B]).map((i) => i.kind)).toContain("query_set");
  });

  it("flags provider/model/location/origin drift", () => {
    const C = set("C", [rec({ queryId: "q1", model: "other", country: "US" })], "simulated");
    const kinds = comparabilityIssues([A, C]).map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["model", "location", "data_origin"]));
  });

  it("comparable view uses only shared queries", () => {
    const c = compareRunPair(A, B, { comparableOnly: true });
    expect(c.current.metrics.trackedPrompts).toBe(3); // q4 excluded
    expect(c.baseline.metrics.mentionRate.value).toBe(66.67);
    expect(c.current.metrics.mentionRate.value).toBe(50); // q3 failed -> excluded from denominator
    expect(c.rateDeltasPp.mentionRate.absolute).toBe(-16.67);
  });

  it("identifies new and lost citations and mentions; failed is not a loss", () => {
    const c = compareRunPair(A, B, { comparableOnly: true });
    expect(c.newCitations).toEqual(["https://acme.com/new"]);
    expect(c.lostCitations).toEqual(["https://acme.com/old"]);
    expect(c.lostMentions.map((m) => m.queryId)).toEqual(["q2"]);
    expect(c.newMentions).toEqual([]);
    expect(c.mentionsNotComparable).toBe(1);
  });

  it("non-comparable view includes all queries", () => {
    const c = compareRunPair(A, B, { comparableOnly: false });
    expect(c.current.metrics.trackedPrompts).toBe(4);
    expect(c.countDeltas.trackedPrompts.absolute).toBe(1);
  });
});
