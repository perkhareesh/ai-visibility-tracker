import { describe, expect, it } from "vitest";
import { classifyCitations } from "@/lib/analysis/citations";

const tracked = { key: "b", name: "Acme CRM", aliases: ["Acme"], domains: ["acmecrm.com"] };
const competitors = [{ key: "c", name: "HubSpot", aliases: [], domains: ["hubspot.com"] }];

describe("classifyCitations", () => {
  const text = "Acme is flexible (a). HubSpot is big (b). Generic advice (c). G2 lists Acme CRM (d).";
  const raw = [
    { url: "https://blog.acmecrm.com/post?utm_source=openai", title: "Acme blog", startIndex: 17, endIndex: 20 },
    { url: "https://www.hubspot.com/pricing", title: "Pricing", startIndex: 37, endIndex: 40 },
    { url: "https://news.example/crm", title: "CRM trends", startIndex: 57, endIndex: 60 },
    { url: "https://www.g2.com/compare", title: "Best CRM software", startIndex: 80, endIndex: 83 },
    { url: "javascript:alert(1)", title: "bad", startIndex: 1, endIndex: 2 },
  ];
  const out = classifyCitations(raw, { tracked, competitors, responseText: text });

  it("drops non-http URLs", () => expect(out).toHaveLength(4));
  it("assigns 1-based positions in order of appearance", () => expect(out.map((c) => c.position)).toEqual([1, 2, 3, 4]));
  it("classifies official subdomain citations", () => {
    expect(out[0].citationType).toBe("official");
    expect(out[0].normalizedUrl).toBe("https://blog.acmecrm.com/post");
    expect(out[0].originalUrl).toContain("utm_source=openai");
  });
  it("classifies competitor domains", () => expect(out[1]).toMatchObject({ citationType: "competitor", citedEntity: "HubSpot" }));
  it("classifies unrelated sources as other", () => expect(out[2].citationType).toBe("other"));
  it("never counts a third-party page that mentions the brand as official", () =>
    expect(out[3]).toMatchObject({ citationType: "third_party_mention", domain: "g2.com", citedEntity: "Acme CRM" }));
});
