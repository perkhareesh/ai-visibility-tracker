import { describe, expect, it } from "vitest";
import { hostMatchesDomain, isSafePublicHttpUrl, normalizeDomain, normalizeUrl } from "@/lib/url";

describe("normalizeDomain", () => {
  it("strips scheme, www, path and case", () => {
    expect(normalizeDomain("https://WWW.Example.com/pricing?x=1")).toBe("example.com");
    expect(normalizeDomain("Example.co.in")).toBe("example.co.in");
  });
  it("rejects junk", () => {
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("removes tracking params, fragments, trailing slash and www; sorts params", () => {
    expect(normalizeUrl("https://www.example.com/blog/post/?utm_source=openai&b=2&a=1#top")).toBe("https://example.com/blog/post?a=1&b=2");
  });
  it("treats http and https as the same page", () => {
    expect(normalizeUrl("http://example.com/x")).toBe(normalizeUrl("https://example.com/x/"));
  });
  it("rejects non-http schemes", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("ftp://example.com")).toBeNull();
  });
});

describe("hostMatchesDomain", () => {
  it("matches subdomains but not lookalikes", () => {
    expect(hostMatchesDomain("blog.example.com", "example.com")).toBe(true);
    expect(hostMatchesDomain("www.example.com", "example.com")).toBe(true);
    expect(hostMatchesDomain("notexample.com", "example.com")).toBe(false);
    expect(hostMatchesDomain("example.com.evil.io", "example.com")).toBe(false);
  });
});

describe("isSafePublicHttpUrl (SSRF guard)", () => {
  it.each([
    ["http://localhost:3000", false],
    ["http://127.0.0.1", false],
    ["http://10.0.0.5/admin", false],
    ["http://169.254.169.254/latest/meta-data", false],
    ["http://[::1]/", false],
    ["http://user:pass@example.com", false],
    ["file:///etc/passwd", false],
    ["http://intranet.internal", false],
    ["https://example.com", true],
    ["https://8.8.8.8", true],
  ])("%s -> %s", (url, ok) => expect(isSafePublicHttpUrl(url)).toBe(ok));
});
