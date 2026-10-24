import { hostMatchesDomain, normalizeUrl } from "@/lib/url";
import type { EntityInput } from "./detect";
import { maskUrls } from "./detect";

export interface RawCitation {
  url: string;
  title?: string | null;
  startIndex?: number | null;
  endIndex?: number | null;
}

export type CitationType = "official" | "third_party_mention" | "competitor" | "other";

export interface ClassifiedCitation {
  originalUrl: string;
  normalizedUrl: string;
  domain: string;
  title: string | null;
  position: number;
  startIndex: number | null;
  endIndex: number | null;
  citationType: CitationType;
  citedEntity: string | null;
}

export interface ClassifyContext {
  tracked: EntityInput; // domains must be normalized
  competitors: EntityInput[];
  responseText: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function textMentions(haystack: string, e: EntityInput): boolean {
  const masked = maskUrls(haystack);
  return [e.name, ...(e.aliases ?? [])]
    .filter((t) => t.trim().length >= 2)
    .some((t) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(t.trim())}(?![\\p{L}\\p{N}_])`, t.length <= 3 ? "u" : "iu").test(masked));
}

/** Sentence-ish window around the citation anchor in the response. */
function anchorContext(text: string, start: number | null | undefined, end: number | null | undefined): string {
  if (start == null || end == null || start < 0 || end > text.length) return "";
  const from = Math.max(0, text.lastIndexOf("\n", start - 1), text.lastIndexOf(". ", start - 1));
  const candidates = [text.indexOf("\n", end), text.indexOf(". ", end)].filter((i) => i !== -1);
  const to = candidates.length ? Math.min(...candidates) : text.length;
  return text.slice(from, to);
}

/**
 * Classification order:
 *  1. Host is (a subdomain of) a tracked-brand official domain -> official
 *  2. Host is (a subdomain of) a competitor domain              -> competitor
 *  3. Title or anchor sentence names the tracked brand          -> third_party_mention
 *  4. Anything else                                             -> other
 * A third-party page that mentions the brand is never counted as official.
 */
export function classifyCitations(raw: RawCitation[], ctx: ClassifyContext): ClassifiedCitation[] {
  const ordered = raw
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.startIndex ?? Number.MAX_SAFE_INTEGER) - (b.c.startIndex ?? Number.MAX_SAFE_INTEGER) || a.i - b.i);

  const out: ClassifiedCitation[] = [];
  let position = 0;
  for (const { c } of ordered) {
    const normalizedUrl = normalizeUrl(c.url);
    if (!normalizedUrl) continue; // non-http(s) or malformed: not a usable citation
    position += 1;
    const domain = new URL(normalizedUrl).hostname;
    let citationType: CitationType = "other";
    let citedEntity: string | null = null;

    if ((ctx.tracked.domains ?? []).some((d) => hostMatchesDomain(domain, d))) {
      citationType = "official";
      citedEntity = ctx.tracked.name;
    } else {
      const comp = ctx.competitors.find((e) => (e.domains ?? []).some((d) => hostMatchesDomain(domain, d)));
      if (comp) {
        citationType = "competitor";
        citedEntity = comp.name;
      } else {
        const context = `${c.title ?? ""}\n${anchorContext(ctx.responseText, c.startIndex, c.endIndex)}`;
        if (textMentions(context, ctx.tracked)) {
          citationType = "third_party_mention";
          citedEntity = ctx.tracked.name;
        }
      }
    }
    out.push({
      originalUrl: c.url,
      normalizedUrl,
      domain,
      title: c.title?.trim() || null,
      position,
      startIndex: c.startIndex ?? null,
      endIndex: c.endIndex ?? null,
      citationType,
      citedEntity,
    });
  }
  return out;
}
