/**
 * Metric calculations. Pure functions over execution records so they can be
 * unit-tested and audited. See METRIC_DEFINITIONS for the user-facing text.
 *
 * Rules applied everywhere:
 *  - Failed executions are excluded from every rate denominator and reported separately.
 *  - Executions without citation metadata are excluded from the citation-rate
 *    denominator (reported as "unavailable"), never counted as zero.
 *  - A rate with an empty denominator is null ("no data"), never 0%.
 *  - Citation occurrences, unique URLs and unique domains are counted separately.
 */

export type Sentiment = "positive" | "neutral" | "negative" | "mixed" | "insufficient";

export interface ExecRecord {
  snapshotId: string;
  runId: string;
  queryId: string;
  queryText: string;
  status: "success" | "failed";
  provider: string;
  model: string;
  country: string | null;
  region: string | null;
  city: string | null;
  language: string;
  citationsAvailable: boolean;
  mentioned: boolean;
  recommended: boolean; // effective (manual override applied)
  sentiment: Sentiment | null; // effective (manual override applied)
  competitorMentions: Record<string, boolean>;
  citations: Array<{ normalizedUrl: string; domain: string; type: string }>;
}

export interface Rate {
  numerator: number;
  denominator: number;
  value: number | null; // percentage 0-100, null when denominator is 0
}

const rate = (numerator: number, denominator: number): Rate => ({
  numerator,
  denominator,
  value: denominator === 0 ? null : Math.round((numerator / denominator) * 10000) / 100,
});

export interface MetricSet {
  executions: number;
  successful: number;
  failed: number;
  trackedPrompts: number;
  mentionRate: Rate;
  citationRate: Rate; // official-domain citation rate (spec "Citation Rate")
  anyCitationRate: Rate; // executions citing any source
  citationMetadataUnavailable: number;
  officialCitationCount: number;
  officialUniqueUrls: number;
  totalCitationOccurrences: number;
  uniqueCitedUrls: number;
  uniqueCitedDomains: number;
  recommendationRate: Rate;
  sentiment: Record<Sentiment, number>;
  competitorMentionRates: Record<string, Rate>;
  visibilityShare: Rate; // custom metric
}

export function computeMetrics(records: ExecRecord[], competitorNames: string[] = []): MetricSet {
  const ok = records.filter((r) => r.status === "success");
  const withCitations = ok.filter((r) => r.citationsAvailable);
  const official = ok.flatMap((r) => r.citations.filter((c) => c.type === "official"));
  const allCitations = ok.flatMap((r) => r.citations);
  const sentiment: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0, mixed: 0, insufficient: 0 };
  for (const r of ok) if (r.sentiment) sentiment[r.sentiment] += 1;

  const names = new Set(competitorNames);
  for (const r of ok) for (const n of Object.keys(r.competitorMentions)) names.add(n);
  const competitorMentionRates: Record<string, Rate> = {};
  let competitorMentionTotal = 0;
  for (const n of names) {
    const c = ok.filter((r) => r.competitorMentions[n]).length;
    competitorMentionTotal += c;
    competitorMentionRates[n] = rate(c, ok.length);
  }
  const trackedMentions = ok.filter((r) => r.mentioned).length;

  return {
    executions: records.length,
    successful: ok.length,
    failed: records.length - ok.length,
    trackedPrompts: new Set(records.map((r) => r.queryId)).size,
    mentionRate: rate(trackedMentions, ok.length),
    citationRate: rate(withCitations.filter((r) => r.citations.some((c) => c.type === "official")).length, withCitations.length),
    anyCitationRate: rate(withCitations.filter((r) => r.citations.length > 0).length, withCitations.length),
    citationMetadataUnavailable: ok.length - withCitations.length,
    officialCitationCount: official.length,
    officialUniqueUrls: new Set(official.map((c) => c.normalizedUrl)).size,
    totalCitationOccurrences: allCitations.length,
    uniqueCitedUrls: new Set(allCitations.map((c) => c.normalizedUrl)).size,
    uniqueCitedDomains: new Set(allCitations.map((c) => c.domain)).size,
    recommendationRate: rate(ok.filter((r) => r.recommended).length, ok.length),
    sentiment,
    competitorMentionRates,
    visibilityShare: rate(trackedMentions, trackedMentions + competitorMentionTotal),
  };
}

// ---------- Comparison ----------

export interface ComparabilityIssue {
  kind: "query_set" | "provider" | "model" | "location" | "language" | "data_origin";
  detail: string;
}

export interface RunSet {
  runId: string;
  label: string;
  executedAt: Date;
  dataOrigin: "live" | "simulated";
  records: ExecRecord[];
}

function settingsKey(r: ExecRecord) {
  return [r.country ?? "", r.region ?? "", r.city ?? ""].join("|");
}

export function comparabilityIssues(runs: RunSet[]): ComparabilityIssue[] {
  const issues: ComparabilityIssue[] = [];
  if (runs.length < 2) return issues;
  const querySets = runs.map((r) => new Set(r.records.map((x) => x.queryId)));
  const same = querySets.every((s) => s.size === querySets[0].size && [...s].every((q) => querySets[0].has(q)));
  if (!same) issues.push({ kind: "query_set", detail: "The selected runs did not execute the same set of queries." });
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const providers = uniq(runs.flatMap((r) => r.records.map((x) => x.provider)));
  if (providers.length > 1) issues.push({ kind: "provider", detail: `Different providers: ${providers.join(", ")}` });
  const models = uniq(runs.flatMap((r) => r.records.map((x) => x.model)));
  if (models.length > 1) issues.push({ kind: "model", detail: `Different models: ${models.join(", ")}` });
  const origins = uniq(runs.map((r) => r.dataOrigin));
  if (origins.length > 1) issues.push({ kind: "data_origin", detail: "Mixes live and simulated (demo) data." });

  // per-query settings drift
  const byQuery = new Map<string, { loc: Set<string>; lang: Set<string> }>();
  for (const run of runs)
    for (const r of run.records) {
      const e = byQuery.get(r.queryId) ?? { loc: new Set(), lang: new Set() };
      e.loc.add(settingsKey(r));
      e.lang.add(r.language);
      byQuery.set(r.queryId, e);
    }
  const locDrift = [...byQuery.values()].filter((e) => e.loc.size > 1).length;
  const langDrift = [...byQuery.values()].filter((e) => e.lang.size > 1).length;
  if (locDrift) issues.push({ kind: "location", detail: `${locDrift} query(s) ran with different country/region/city settings.` });
  if (langDrift) issues.push({ kind: "language", detail: `${langDrift} query(s) ran with different language settings.` });
  return issues;
}

export function commonQueryIds(runs: RunSet[]): Set<string> {
  if (!runs.length) return new Set();
  let acc = new Set(runs[0].records.map((r) => r.queryId));
  for (const run of runs.slice(1)) {
    const s = new Set(run.records.map((r) => r.queryId));
    acc = new Set([...acc].filter((q) => s.has(q)));
  }
  return acc;
}

export interface Delta {
  baseline: number | null;
  current: number | null;
  absolute: number | null; // for counts: current - baseline; for rates: percentage points
}

const delta = (a: number | null, b: number | null): Delta => ({
  baseline: a,
  current: b,
  absolute: a == null || b == null ? null : Math.round((b - a) * 100) / 100,
});

export interface RunComparison {
  baseline: { runId: string; label: string; metrics: MetricSet };
  current: { runId: string; label: string; metrics: MetricSet };
  rateDeltasPp: Record<"mentionRate" | "citationRate" | "anyCitationRate" | "recommendationRate" | "visibilityShare", Delta>;
  countDeltas: Record<"successful" | "trackedPrompts" | "officialCitationCount" | "uniqueCitedUrls" | "uniqueCitedDomains", Delta>;
  sentimentDeltas: Record<Sentiment, Delta>;
  newCitations: string[];
  lostCitations: string[];
  newDomains: string[];
  lostDomains: string[];
  newMentions: Array<{ queryId: string; queryText: string }>;
  lostMentions: Array<{ queryId: string; queryText: string }>;
  mentionsNotComparable: number; // queries where one side failed: unknown, not a loss
  competitorDeltasPp: Record<string, Delta>;
}

export function compareRunPair(
  baseline: RunSet,
  current: RunSet,
  opts: { comparableOnly: boolean; queryFilter?: Set<string>; competitorNames?: string[] } = { comparableOnly: true },
): RunComparison {
  const keep = opts.queryFilter ?? (opts.comparableOnly ? commonQueryIds([baseline, current]) : null);
  const a = keep ? baseline.records.filter((r) => keep.has(r.queryId)) : baseline.records;
  const b = keep ? current.records.filter((r) => keep.has(r.queryId)) : current.records;
  const ma = computeMetrics(a, opts.competitorNames);
  const mb = computeMetrics(b, opts.competitorNames);

  const urls = (rs: ExecRecord[]) => new Set(rs.filter((r) => r.status === "success").flatMap((r) => r.citations.map((c) => c.normalizedUrl)));
  const doms = (rs: ExecRecord[]) => new Set(rs.filter((r) => r.status === "success").flatMap((r) => r.citations.map((c) => c.domain)));
  const ua = urls(a), ub = urls(b), da = doms(a), db = doms(b);

  // New/lost mentions are only judged where both sides executed successfully.
  const aBy = new Map(a.map((r) => [r.queryId, r]));
  const newMentions: RunComparison["newMentions"] = [];
  const lostMentions: RunComparison["lostMentions"] = [];
  let mentionsNotComparable = 0;
  for (const rb of b) {
    const ra = aBy.get(rb.queryId);
    if (!ra) continue;
    if (ra.status !== "success" || rb.status !== "success") {
      mentionsNotComparable += 1;
      continue;
    }
    if (!ra.mentioned && rb.mentioned) newMentions.push({ queryId: rb.queryId, queryText: rb.queryText });
    if (ra.mentioned && !rb.mentioned) lostMentions.push({ queryId: rb.queryId, queryText: rb.queryText });
  }

  const compNames = new Set([...Object.keys(ma.competitorMentionRates), ...Object.keys(mb.competitorMentionRates)]);
  const competitorDeltasPp: Record<string, Delta> = {};
  for (const n of compNames)
    competitorDeltasPp[n] = delta(ma.competitorMentionRates[n]?.value ?? null, mb.competitorMentionRates[n]?.value ?? null);

  const sentimentDeltas = Object.fromEntries(
    (Object.keys(ma.sentiment) as Sentiment[]).map((k) => [k, delta(ma.sentiment[k], mb.sentiment[k])]),
  ) as Record<Sentiment, Delta>;

  return {
    baseline: { runId: baseline.runId, label: baseline.label, metrics: ma },
    current: { runId: current.runId, label: current.label, metrics: mb },
    rateDeltasPp: {
      mentionRate: delta(ma.mentionRate.value, mb.mentionRate.value),
      citationRate: delta(ma.citationRate.value, mb.citationRate.value),
      anyCitationRate: delta(ma.anyCitationRate.value, mb.anyCitationRate.value),
      recommendationRate: delta(ma.recommendationRate.value, mb.recommendationRate.value),
      visibilityShare: delta(ma.visibilityShare.value, mb.visibilityShare.value),
    },
    countDeltas: {
      successful: delta(ma.successful, mb.successful),
      trackedPrompts: delta(ma.trackedPrompts, mb.trackedPrompts),
      officialCitationCount: delta(ma.officialCitationCount, mb.officialCitationCount),
      uniqueCitedUrls: delta(ma.uniqueCitedUrls, mb.uniqueCitedUrls),
      uniqueCitedDomains: delta(ma.uniqueCitedDomains, mb.uniqueCitedDomains),
    },
    sentimentDeltas,
    newCitations: [...ub].filter((u) => !ua.has(u)).sort(),
    lostCitations: [...ua].filter((u) => !ub.has(u)).sort(),
    newDomains: [...db].filter((d) => !da.has(d)).sort(),
    lostDomains: [...da].filter((d) => !db.has(d)).sort(),
    newMentions,
    lostMentions,
    mentionsNotComparable,
    competitorDeltasPp,
  };
}

export const METRIC_DEFINITIONS = [
  {
    key: "mentionRate",
    name: "Brand Mention Rate",
    formula: "successful executions where the brand is mentioned ÷ successful executions × 100",
    notes:
      "Mentioned = brand name, alias, or official domain appears in the answer text (link URLs and citation chips excluded). Product-only references are tracked separately. Failed executions are excluded from the denominator.",
  },
  {
    key: "citationRate",
    name: "Citation Rate (official domain)",
    formula:
      "successful executions with ≥1 citation to the brand's official domain ÷ successful executions that returned citation metadata × 100",
    notes:
      "Executions whose provider returned no citation metadata are excluded and shown as 'unavailable'. Third-party pages that mention the brand never count as official citations.",
  },
  {
    key: "anyCitationRate",
    name: "AI Citation Rate (any source)",
    formula: "successful executions with ≥1 citation of any source ÷ successful executions that returned citation metadata × 100",
    notes: "Shows how often answers cite sources at all. Use it to read the official-domain Citation Rate in context.",
  },
  {
    key: "officialCitationCount",
    name: "Official-Domain Citation Count",
    formula: "number of citation occurrences whose host is an official brand domain (or its subdomain)",
    notes: "Counts occurrences, not unique URLs. Unique official URLs are shown alongside.",
  },
  {
    key: "recommendationRate",
    name: "Recommendation Rate",
    formula: "successful executions containing an explicit recommendation of the brand ÷ successful executions × 100",
    notes:
      "Explicit = recommendation language (e.g. 'we recommend', 'top pick', 'best overall') in the same sentence or list item as the brand, without a negating cue. Being listed is not a recommendation. Manual corrections override the analyzer.",
  },
  {
    key: "visibilityShare",
    name: "Visibility Share (custom metric)",
    formula: "executions mentioning the tracked brand ÷ executions mentioning any tracked entity (brand + its competitors), summed per entity × 100",
    notes: "A custom, workspace-relative metric. It depends on which competitors you track and is not an industry-standard score.",
  },
  {
    key: "comparison",
    name: "Run comparisons",
    formula: "rate deltas are percentage points (current − baseline); count deltas are absolute differences",
    notes:
      "By default only queries present in every selected run are compared. Differences in query set, provider, model, location, language, or data origin are flagged. A query that failed in either run is 'not comparable' for new/lost mentions rather than a loss.",
  },
] as const;
