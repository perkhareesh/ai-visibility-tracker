/**
 * Brand / competitor detection over an AI response. Pure and deterministic.
 *
 * Definitions (documented in /metrics):
 *  - mentioned: brand name, an alias, or an official domain appears as text
 *    (outside link URLs). Product references alone do NOT count as a mention.
 *  - viaProduct: one of the brand's configured products/services appears.
 *  - inList: a match sits on a list item line or a table row.
 *  - recommended: an explicit recommendation cue appears in the same sentence
 *    or list item as a match, without a negating cue.
 */

export interface EntityInput {
  key: string; // stable id (brand id or competitor id)
  name: string;
  aliases?: string[];
  domains?: string[];
  products?: string[];
}

export interface MatchSpan {
  start: number;
  end: number;
  term: string;
  kind: "name" | "alias" | "domain" | "product";
}

export interface EntityDetection {
  key: string;
  name: string;
  mentioned: boolean;
  mentionCount: number;
  firstOffset: number | null;
  inList: boolean;
  listRank: number | null;
  recommended: boolean;
  notRecommended: boolean;
  viaProduct: boolean;
  productTerms: string[];
  matches: MatchSpan[];
  sentences: string[]; // sentences / list items containing a name or product match
}

export const DETECTION_VERSION = "detect-v1";

const RECOMMEND_CUES = [
  /\brecommend(?:ed|s|ation)?\b/i,
  /\btop (?:pick|choice)\b/i,
  /\bbest (?:overall|option|choice)\b/i,
  /\bis the best\b/i,
  /\bour pick\b/i,
  /\bgo with\b/i,
  /\b(?:i|we)(?:'d| would) suggest\b/i,
  /\byou should (?:use|choose|try|consider)\b/i,
  /\bstrongly consider\b/i,
  /\bclear winner\b/i,
];
const NEGATIVE_REC_CUES = [
  /\b(?:not|don't|do not|wouldn't|would not) recommend\b/i,
  /\bavoid\b/i,
  /\bnot (?:a )?(?:good|great|ideal) (?:fit|choice|option)\b/i,
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace URLs (markdown link targets and bare URLs) with spaces, preserving offsets. */
export function maskUrls(text: string): string {
  const blank = (m: string) => " ".repeat(m.length);
  return text
    // citation chips such as ([g2.com](https://...)) are citations, not name mentions
    .replace(/\[([^\]\n]{1,80})\]\((?:[^()\s]|\([^()\s]*\))+\)/g, (m, label: string) =>
      /^[\w.-]+\.[a-z]{2,}$/i.test(label.trim()) ? blank(m) : m,
    )
    .replace(/\]\((?:[^()\s]|\([^()\s]*\))+\)/g, (m) => "]" + blank(m.slice(1)))
    .replace(/https?:\/\/[^\s)\]>]+/gi, blank);
}

function findTerm(haystack: string, term: string): Array<{ start: number; end: number }> {
  const t = term.trim();
  if (t.length < 2) return [];
  // Very short terms (e.g. "HP") must match case exactly to avoid noise.
  const flags = t.length <= 3 ? "gu" : "giu";
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(t)}(?![\\p{L}\\p{N}_])`, flags);
  const out: Array<{ start: number; end: number }> = [];
  for (const m of haystack.matchAll(re)) out.push({ start: m.index!, end: m.index! + m[0].length });
  return out;
}

interface Segment {
  start: number;
  end: number;
  text: string;
  listItem: boolean;
  listBlock: number | null;
  listRank: number | null;
}

const LIST_LINE = /^\s{0,6}(?:[-*•+]|\d{1,3}[.)])\s+/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}/;

/** Split the response into sentences, tagging list items / table rows with block + rank. */
export function segment(text: string): Segment[] {
  const segs: Segment[] = [];
  let offset = 0;
  let block = 0;
  let inBlock = false;
  let rank = 0;
  let tableHeaderSeen = false;
  const lines = text.split("\n");
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    const isTable = TABLE_ROW.test(line);
    const isSep = TABLE_SEP.test(line) && line.includes("-");
    const isList = LIST_LINE.test(line);
    if (!line.trim()) {
      // blank lines inside a list keep the block alive (loose markdown lists)
      continue;
    }
    if (isSep) {
      tableHeaderSeen = true;
      continue;
    }
    if (isList || isTable) {
      if (!inBlock) {
        block += 1;
        rank = 0;
        inBlock = true;
        tableHeaderSeen = false;
      }
      // first table row before the separator is a header, not a ranked item
      const isHeader = isTable && !tableHeaderSeen;
      if (!isHeader && !/^\s{2,}/.test(line)) rank += 1; // nested bullets don't change rank
      segs.push({
        start: lineStart,
        end: lineStart + line.length,
        text: line,
        listItem: !isHeader,
        listBlock: isHeader ? null : block,
        listRank: isHeader ? null : Math.max(rank, 1),
      });
      continue;
    }
    if (/^\s/.test(line) && inBlock) {
      // indented continuation of a list item
      const prev = segs[segs.length - 1];
      segs.push({ start: lineStart, end: lineStart + line.length, text: line, listItem: true, listBlock: prev?.listBlock ?? block, listRank: prev?.listRank ?? rank });
      continue;
    }
    inBlock = false;
    // sentence split within a prose line
    // Sentence boundaries: terminal punctuation followed by whitespace or end of line.
    // Periods inside tokens (domains, decimals, "e.g.x") do not split.
    let from = 0;
    const bounds = [...line.matchAll(/[.!?]+["')\]]*(?=\s|$)/g)].map((m) => m.index! + m[0].length);
    if (!bounds.length || bounds[bounds.length - 1] < line.length) bounds.push(line.length);
    for (const to of bounds) {
      const piece = line.slice(from, to);
      if (piece.trim()) segs.push({ start: lineStart + from, end: lineStart + to, text: piece, listItem: false, listBlock: null, listRank: null });
      from = to;
    }
  }
  return segs;
}

export function detectEntity(text: string, entity: EntityInput, segs = segment(text)): EntityDetection {
  const masked = maskUrls(text);
  const matches: MatchSpan[] = [];
  const seen = new Set<string>();
  const push = (term: string, kind: MatchSpan["kind"]) => {
    for (const r of findTerm(masked, term)) {
      const k = `${r.start}:${r.end}`;
      if (seen.has(k)) continue;
      // skip if fully inside an existing longer match
      if (matches.some((m) => r.start >= m.start && r.end <= m.end)) continue;
      seen.add(k);
      matches.push({ ...r, term, kind });
    }
  };
  // longest terms first so "Acme CRM" is preferred over "Acme"
  const named: Array<[string, MatchSpan["kind"]]> = [
    [entity.name, "name"],
    ...(entity.aliases ?? []).map((a) => [a, "alias"] as [string, MatchSpan["kind"]]),
    ...(entity.domains ?? []).map((d) => [d, "domain"] as [string, MatchSpan["kind"]]),
  ];
  const products = (entity.products ?? []).filter((p) => p.trim().length >= 3);
  const all = [...named, ...products.map((p) => [p, "product"] as [string, MatchSpan["kind"]])].sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [term, kind] of all) push(term, kind);
  matches.sort((a, b) => a.start - b.start);

  const nameMatches = matches.filter((m) => m.kind !== "product");
  const productMatches = matches.filter((m) => m.kind === "product");

  const segOf = (pos: number) => segs.find((s) => pos >= s.start && pos < s.end);
  const hitSegs = new Map<number, Segment>();
  for (const m of matches) {
    const s = segOf(m.start);
    if (s) hitSegs.set(s.start, s);
  }
  const nameSegs = nameMatches.map((m) => segOf(m.start)).filter((s): s is Segment => !!s);

  const listSeg = nameSegs.find((s) => s.listItem);
  const recommended = nameSegs.some(
    (s) => RECOMMEND_CUES.some((re) => re.test(s.text)) && !NEGATIVE_REC_CUES.some((re) => re.test(s.text)),
  );
  const notRecommended = nameSegs.some((s) => NEGATIVE_REC_CUES.some((re) => re.test(s.text)));

  return {
    key: entity.key,
    name: entity.name,
    mentioned: nameMatches.length > 0,
    mentionCount: nameMatches.length,
    firstOffset: nameMatches[0]?.start ?? null,
    inList: !!listSeg,
    listRank: listSeg?.listRank ?? null,
    recommended,
    notRecommended,
    viaProduct: productMatches.length > 0,
    productTerms: [...new Set(productMatches.map((m) => m.term))],
    matches,
    sentences: [...hitSegs.values()].sort((a, b) => a.start - b.start).map((s) => s.text.trim()),
  };
}

export function detectAll(text: string, entities: EntityInput[]): EntityDetection[] {
  const segs = segment(text);
  return entities.map((e) => detectEntity(text, e, segs));
}
