import { describe, expect, it } from "vitest";
import { detectEntity, maskUrls, segment } from "@/lib/analysis/detect";

const acme = { key: "b1", name: "Acme CRM", aliases: ["Acme"], domains: ["acmecrm.com"], products: ["Acme Pipeline"] };

describe("detectEntity", () => {
  it("detects name mentions with word boundaries, case-insensitively", () => {
    const d = detectEntity("We looked at acme crm and Acmeville.", acme);
    expect(d.mentioned).toBe(true);
    expect(d.mentionCount).toBe(1); // "Acmeville" is not a mention
  });

  it("reports absence explicitly", () => {
    const d = detectEntity("HubSpot and Zoho are popular.", acme);
    expect(d.mentioned).toBe(false);
    expect(d.viaProduct).toBe(false);
    expect(d.sentences).toEqual([]);
  });

  it("does not count URLs or citation chips as name mentions", () => {
    const text = "HubSpot is great ([acmecrm.com](https://acmecrm.com/blog?utm_source=openai)). See https://acmecrm.com/x";
    expect(maskUrls(text).includes("acmecrm.com")).toBe(false);
    expect(detectEntity(text, acme).mentioned).toBe(false);
  });

  it("detects list inclusion and rank", () => {
    const text = "Top tools:\n\n1. **HubSpot** is popular.\n2. **Zoho** is cheap.\n3. **Acme CRM** is flexible.\n\nDone.";
    const d = detectEntity(text, acme);
    expect(d.inList).toBe(true);
    expect(d.listRank).toBe(3);
  });

  it("treats markdown table rows as a comparison list (header not ranked)", () => {
    const text = "| Tool | Notes |\n|---|---|\n| HubSpot | big |\n| Acme | small |";
    const d = detectEntity(text, acme);
    expect(d.inList).toBe(true);
    expect(d.listRank).toBe(2);
  });

  it("detects explicit recommendation but not mere listing", () => {
    expect(detectEntity("Overall, we recommend Acme CRM for startups.", acme).recommended).toBe(true);
    expect(detectEntity("1. Acme CRM - best for startups", acme).recommended).toBe(false);
    const neg = detectEntity("I would not recommend Acme for enterprises.", acme);
    expect(neg.recommended).toBe(false);
    expect(neg.notRecommended).toBe(true);
  });

  it("flags product references separately from name mentions", () => {
    const d = detectEntity("Teams love Acme Pipeline for deal tracking.", { ...acme, aliases: [] });
    expect(d.viaProduct).toBe(true);
    expect(d.productTerms).toEqual(["Acme Pipeline"]);
    // "Acme Pipeline" contains no standalone "Acme CRM"
    expect(d.mentioned).toBe(false);
  });

  it("requires exact case for very short aliases", () => {
    const hp = { key: "x", name: "HP", aliases: [], domains: [] };
    expect(detectEntity("The HP laptop", hp).mentioned).toBe(true);
    expect(detectEntity("hp is horsepower", hp).mentioned).toBe(false);
  });
});

describe("segment", () => {
  it("splits prose into sentences and tags list items", () => {
    const segs = segment("First one. Second one!\n- item a\n- item b");
    expect(segs.map((s) => s.listItem)).toEqual([false, false, true, true]);
    expect(segs[3].listRank).toBe(2);
  });
});

describe("sentence splitting with dotted tokens", () => {
  it("keeps a sentence containing a domain and a citation chip intact", () => {
    const text = "We recommend Acme CRM, see ([acmecrm.com](https://acmecrm.com/x)). HubSpot is fine.";
    const d = detectEntity(text, acme);
    expect(d.recommended).toBe(true);
    expect(segment(text)).toHaveLength(2);
  });
});
