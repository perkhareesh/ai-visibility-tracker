import net from "node:net";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "srsltid",
  "ref",
  "ref_src",
]);

/** Lowercase host, strip "www." and a trailing dot. Returns null for invalid input. */
export function normalizeHost(host: string): string | null {
  let h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return null;
  if (h.startsWith("www.")) h = h.slice(4);
  return h;
}

/**
 * Accepts "example.com", "https://www.Example.com/path" or "WWW.EXAMPLE.COM"
 * and returns the bare normalized host ("example.com"). Null if not parseable.
 */
export function normalizeDomain(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url.hostname || !url.hostname.includes(".")) return null;
    return normalizeHost(url.hostname);
  } catch {
    return null;
  }
}

/**
 * Canonical form used for grouping citations: lowercase scheme+host, no www,
 * no fragment, tracking params removed, remaining params sorted, no trailing slash
 * (except root). The original URL is always stored separately.
 */
export function normalizeUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = normalizeHost(url.hostname);
    if (!host) return null;
    const params = [...url.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
      .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
    const search = params.length ? "?" + new URLSearchParams(params).toString() : "";
    let path = url.pathname.replace(/\/{2,}/g, "/");
    if (path.length > 1) path = path.replace(/\/+$/, "");
    const port = url.port && !["80", "443"].includes(url.port) ? `:${url.port}` : "";
    return `https://${host}${port}${path}${search}`;
  } catch {
    return null;
  }
}

/** True if `host` equals `domain` or is a subdomain of it (blog.example.com matches example.com). */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = normalizeHost(host);
  const d = normalizeHost(domain);
  if (!h || !d) return false;
  return h === d || h.endsWith("." + d);
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
  }
  return false;
}

/**
 * Validates a user-supplied website URL. The app never fetches these URLs
 * server-side; this guard exists so that any future fetching code (and link
 * rendering) only ever sees public http(s) URLs. SSRF policy: no credentials,
 * no IP literals in private ranges, no localhost-style hosts, http(s) only.
 */
export function isSafePublicHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
    if (net.isIP(host)) return !isPrivateIp(host);
    return host.includes(".");
  } catch {
    return false;
  }
}

/** Only http(s) links are rendered as clickable anchors in the UI. */
export function isRenderableLink(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
