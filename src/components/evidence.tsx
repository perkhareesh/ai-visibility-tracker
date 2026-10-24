import type { ReactNode } from "react";
import { isRenderableLink } from "@/lib/url";

export interface Mark { start: number; end: number; cls: "m-brand" | "m-rival" | "m-product"; title: string }
export interface CiteMark { start: number | null; end: number | null; n: number; type: string; url: string }

const CITE_STYLE: Record<string, string> = {
  official: "bg-official text-white",
  third_party_mention: "bg-third text-white",
  competitor: "bg-rival text-white",
  other: "bg-line-strong text-ink",
};

const tidy = (s: string) => s.replace(/\*\*/g, "").replace(/^#{1,6}\s+/gm, "").replace(/\[([^\]\n]+)\]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1");

/**
 * Readable rendering of a stored answer. Citation spans reported by the provider are
 * replaced with numbered markers; tracked-brand and competitor matches are highlighted
 * using the offsets saved at analysis time. The untouched raw text is shown separately.
 */
export function EvidenceText({ text, marks, cites }: { text: string; marks: Mark[]; cites: CiteMark[] }) {
  type Ev = { start: number; end: number; node: (inner: string) => ReactNode; kind: "cite" | "mark" };
  const events: Ev[] = [];
  for (const c of cites) {
    if (c.start == null || c.end == null || c.start < 0 || c.end > text.length || c.end <= c.start) continue;
    events.push({
      start: c.start,
      end: c.end,
      kind: "cite",
      node: () => (
        <a key={`c${c.n}-${c.start}`} href={`#cite-${c.n}`} className="no-underline">
          <sup className={`cite ${CITE_STYLE[c.type] ?? CITE_STYLE.other}`} title={c.url}>{c.n}</sup>
        </a>
      ),
    });
  }
  for (const m of marks) events.push({ start: m.start, end: m.end, kind: "mark", node: (inner) => <mark key={`m${m.start}`} className={m.cls} title={m.title}>{tidy(inner)}</mark> });
  events.sort((a, b) => a.start - b.start || (a.kind === "cite" ? -1 : 1));

  const out: ReactNode[] = [];
  let pos = 0;
  for (const e of events) {
    if (e.start < pos) continue; // overlapping: keep the earlier one
    if (e.start > pos) out.push(tidy(text.slice(pos, e.start)));
    out.push(e.node(text.slice(e.start, e.end)));
    pos = e.end;
  }
  if (pos < text.length) out.push(tidy(text.slice(pos)));
  // cited markers placed with no offsets go at the end so nothing is silently dropped
  const unplaced = cites.filter((c) => c.start == null || c.end == null);
  return (
    <div className="evidence whitespace-pre-wrap break-words">
      {out}
      {unplaced.length > 0 && (
        <span className="ml-1">
          {unplaced.map((c) => (
            <a key={`u${c.n}`} href={`#cite-${c.n}`}><sup className={`cite ${CITE_STYLE[c.type] ?? CITE_STYLE.other}`}>{c.n}</sup></a>
          ))}
        </span>
      )}
    </div>
  );
}

export function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  return isRenderableLink(href) ? (
    <a className="link break-all" href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>
  ) : (
    <span className="break-all">{children}</span>
  );
}
