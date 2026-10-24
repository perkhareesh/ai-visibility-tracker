/**
 * Rule-based sentiment + recommendation analyzer ("rules-v1").
 *
 * Measures how the AI response portrays the tracked brand, using only the
 * sentences / list items that reference it. It does not use review data.
 * Output is deterministic so historical results are reproducible; the
 * version string is stored with every analysis.
 */
import type { EntityDetection } from "./detect";

export const ANALYZER_VERSION = "rules-v1.1";

export type SentimentLabel = "positive" | "neutral" | "negative" | "mixed" | "insufficient";
export type RecommendationStatus = "recommended" | "listed" | "mentioned" | "not_recommended" | "absent";

export interface SentimentResult {
  label: SentimentLabel;
  confidence: number | null;
  recommendationStatus: RecommendationStatus;
  mentionContext: string | null;
  positives: string[];
  negatives: string[];
  attributes: string[];
  competitorComparisons: string[];
  explanation: string;
  excerpt: string | null;
  analysisVersion: string;
}

const POSITIVE = [
  "excellent", "great", "strong", "robust", "powerful", "reliable", "intuitive", "easy to use", "user-friendly",
  "affordable", "popular", "leading", "trusted", "best", "top", "comprehensive", "flexible", "scalable", "fast",
  "well-regarded", "highly rated", "standout", "stands out", "impressive", "seamless", "innovative", "excels",
  "praised", "solid", "recommended", "ideal", "versatile", "secure", "accurate", "efficient", "good value",
];
const NEGATIVE = [
  "expensive", "pricey", "costly", "limited", "lacks", "lacking", "complex", "complicated", "steep learning curve",
  "slow", "buggy", "unreliable", "outdated", "poor", "weak", "difficult", "clunky", "criticized", "complaints",
  "drawback", "downside", "issues", "problems", "not ideal", "avoid", "frustrating", "confusing", "hidden fees",
  "overpriced", "restrictive", "inconsistent", "lags", "falls short",
];
const NEGATORS = /\b(?:not|no|never|isn't|aren't|wasn't|doesn't|don't|hardly|without)\s+(?:\w+\s+){0,2}$/i;

const ATTRIBUTES: Record<string, RegExp> = {
  pricing: /\b(?:price|pricing|cost|costly|expensive|affordable|cheap|free (?:plan|tier)|subscription|value)\b/i,
  "ease of use": /\b(?:easy to use|user-friendly|intuitive|learning curve|interface|ux|ui)\b/i,
  features: /\b(?:features?|functionality|capabilit(?:y|ies)|tools?)\b/i,
  integrations: /\b(?:integrat(?:e|es|ion|ions)|api|plugins?|ecosystem)\b/i,
  support: /\b(?:support|customer service|help desk|documentation)\b/i,
  performance: /\b(?:fast|speed|performance|slow|latency)\b/i,
  scalability: /\b(?:scal(?:e|able|ability)|enterprise|large teams?)\b/i,
  security: /\b(?:secur(?:e|ity)|compliance|privacy|gdpr|soc ?2)\b/i,
  reliability: /\b(?:reliab(?:le|ility)|uptime|stable|stability|buggy)\b/i,
  customization: /\b(?:customi[sz](?:e|able|ation)|flexib(?:le|ility))\b/i,
};

function score(sentence: string, lexicon: string[]): string[] {
  const s = sentence.toLowerCase();
  const hits: string[] = [];
  for (const w of lexicon) {
    const re = new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "gi");
    for (const m of s.matchAll(re)) {
      const before = s.slice(Math.max(0, m.index! - 30), m.index!);
      if (!NEGATORS.test(before)) hits.push(w);
    }
  }
  return hits;
}

/** Readable excerpt: drops citation chips and link targets, markdown emphasis and list markers. */
export function cleanExcerpt(s: string) {
  return s
    .replace(/\s*\(\[[^\]\n]+\]\((?:[^()\s]|\([^()\s]*\))+\)\)/g, "")
    .replace(/\[([^\]\n]+)\]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/^\s*(?:[-*•+]|\d{1,3}[.)])\s+/, "");
}

function clip(s: string, n = 280) {
  const t = cleanExcerpt(s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

export function analyzeSentiment(
  tracked: EntityDetection,
  competitors: EntityDetection[],
): SentimentResult {
  const recommendationStatus: RecommendationStatus = !tracked.mentioned && !tracked.viaProduct
    ? "absent"
    : tracked.notRecommended && !tracked.recommended
      ? "not_recommended"
      : tracked.recommended
        ? "recommended"
        : tracked.inList
          ? "listed"
          : "mentioned";

  const sentences = tracked.sentences;
  if (sentences.length === 0) {
    return {
      label: "insufficient",
      confidence: null,
      recommendationStatus,
      mentionContext: null,
      positives: [],
      negatives: [],
      attributes: [],
      competitorComparisons: [],
      explanation: "The response does not reference the brand, so there is no evidence to classify how it is portrayed.",
      excerpt: null,
      analysisVersion: ANALYZER_VERSION,
    };
  }

  const positives: string[] = [];
  const negatives: string[] = [];
  let pos = 0;
  let neg = 0;
  for (const s of sentences) {
    const p = score(s, POSITIVE).length;
    const n = score(s, NEGATIVE).length;
    pos += p;
    neg += n;
    if (p > n) positives.push(clip(s));
    else if (n > p) negatives.push(clip(s));
    else if (p > 0 && n > 0) {
      positives.push(clip(s));
      negatives.push(clip(s));
    }
  }
  const attributes = Object.entries(ATTRIBUTES)
    .filter(([, re]) => sentences.some((s) => re.test(s)))
    .map(([k]) => k);
  const competitorComparisons = sentences
    .filter((s) => competitors.some((c) => c.mentioned && c.sentences.includes(s)))
    .map((s) => clip(s));

  const total = pos + neg;
  let label: SentimentLabel;
  if (total === 0) label = "neutral";
  else if (pos > 0 && neg > 0 && Math.min(pos, neg) / total >= 0.3) label = "mixed";
  else label = pos >= neg ? "positive" : "negative";

  // Confidence grows with evidence volume and polarity margin. It is a heuristic,
  // not a calibrated probability, and is labelled as such in the UI.
  const evidence = Math.min(1, total / 4);
  const margin = total === 0 ? 0.5 : Math.abs(pos - neg) / total;
  const confidence = Math.round((0.35 + 0.35 * evidence + 0.3 * (label === "mixed" ? 1 - margin : margin)) * 100) / 100;

  const mentionContext = tracked.inList
    ? `Listed${tracked.listRank ? ` at position ${tracked.listRank}` : ""} in a list or comparison`
    : tracked.mentioned
      ? "Mentioned in prose"
      : "Referenced only through a product or service";

  const explanation =
    `${sentences.length} passage(s) reference the brand: ${pos} positive and ${neg} negative cue(s) found` +
    (attributes.length ? `; attributes discussed: ${attributes.join(", ")}` : "") +
    `. Recommendation status: ${recommendationStatus.replace("_", " ")}.`;

  return {
    label,
    confidence,
    recommendationStatus,
    mentionContext,
    positives: positives.slice(0, 5),
    negatives: negatives.slice(0, 5),
    attributes,
    competitorComparisons: competitorComparisons.slice(0, 5),
    explanation,
    excerpt: clip(sentences[0], 400),
    analysisVersion: ANALYZER_VERSION,
  };
}
