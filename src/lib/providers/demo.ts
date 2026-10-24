import { ProviderError, type ProviderAdapter, type ProviderCitation, type ProviderRequest, type ProviderResult } from "./types";

/**
 * Deterministic SIMULATED provider for demo workspaces only.
 * Output is synthetic text generated from a seed. It is never a ChatGPT
 * observation and every record it produces is stored with data_origin = "simulated".
 * Third-party sources use the reserved ".example" TLD so they cannot be mistaken for real sites.
 */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POS = [
  "is praised for an intuitive interface and strong integrations",
  "offers robust features and reliable performance for growing teams",
  "stands out for excellent customer support",
  "is a flexible, scalable option with good value pricing",
];
const NEG = [
  "is powerful but can be expensive for small teams",
  "has a steep learning curve and limited customization",
  "is solid, though some users report slow support response times",
];
const NEU = ["covers the core features most buyers need", "is commonly shortlisted in this category"];
const THIRD_PARTY = ["reviews.example", "softwarecompare.example", "industrynews.example", "buyersguide.example"];
const FILLERS = ["Northwind Suite", "Contoso Cloud", "Fabrikam Pro"];

export const demoProvider: ProviderAdapter = {
  id: "demo",
  label: "Demo (simulated)",
  description: "Deterministic synthetic answers for exploring the interface. Never real ChatGPT output.",
  dataOrigin: "simulated",
  capabilities: {
    citations: true,
    geo: { country: "label_only", region: "label_only", city: "label_only" },
    reportsLocation: false,
    language: "label_only",
    costReporting: false,
  },
  defaultModel: () => "demo-sim-1",
  isConfigured: () => true,
  setupInstructions: "Always available inside demo workspaces. Not available in live workspaces.",
  async execute(req: ProviderRequest): Promise<ProviderResult> {
    const ctx = req.demoContext;
    if (!ctx) throw new ProviderError("Demo provider requires demo context", "bad_request", false);
    const seed = hash(`${req.seed ?? ""}|${req.prompt}|${ctx.runIndex}`);
    const r = rng(seed);
    if (seed % 17 === 0) throw new ProviderError("Simulated provider failure (demo)", "simulated_failure", false);

    // Brand visibility drifts upward across demo runs so comparisons show change.
    const includeBrand = r() < 0.45 + ctx.runIndex * 0.12;
    const pool = [
      ...ctx.competitors.map((c) => ({ name: c.name, domains: c.domains, tracked: false })),
      ...FILLERS.map((n) => ({ name: n, domains: [] as string[], tracked: false })),
    ].sort(() => r() - 0.5);
    const entries = pool.slice(0, 3 + Math.floor(r() * 2));
    if (includeBrand) {
      const pos = Math.floor(r() * (entries.length + 1));
      entries.splice(pos, 0, { name: ctx.brand.name, domains: ctx.brand.domains, tracked: true });
    }

    let text = `Here are some options worth considering for "${req.prompt}":\n\n`;
    const citations: ProviderCitation[] = [];
    const cite = (url: string, title: string) => {
      const label = new URL(url).hostname.replace(/^www\./, "");
      const chip = ` ([${label}](${url}))`;
      citations.push({ url, title, startIndex: text.length + 1, endIndex: text.length + chip.length });
      text += chip;
    };
    entries.forEach((e, i) => {
      const roll = r();
      const phrase = roll < 0.55 ? POS[Math.floor(r() * POS.length)] : roll < 0.8 ? NEU[Math.floor(r() * NEU.length)] : NEG[Math.floor(r() * NEG.length)];
      const product = e.tracked && ctx.brand.products.length && r() < 0.5 ? ` Its ${ctx.brand.products[0]} is often highlighted.` : "";
      text += `${i + 1}. **${e.name}** ${phrase}.${product}`;
      const roll2 = r();
      if (e.domains[0] && roll2 < 0.5) cite(`https://www.${e.domains[0]}/product?utm_source=demo`, `${e.name} official site`);
      else if (roll2 < 0.85) {
        const d = THIRD_PARTY[Math.floor(r() * THIRD_PARTY.length)];
        cite(`https://${d}/best-tools/${e.name.toLowerCase().replace(/\s+/g, "-")}`, `${e.name} review`);
      }
      text += "\n";
    });
    const top = entries[0];
    if (top && r() < 0.6) text += `\nOverall, we recommend ${top.name} as the top pick for most buyers.`;
    else text += `\nThe right choice depends on budget, team size and required integrations.`;

    return {
      text,
      citations,
      citationsAvailable: true,
      rawPayload: { simulated: true, seed, runIndex: ctx.runIndex },
      providerResponseId: `demo_${seed.toString(16)}`,
      usage: null,
      costUsd: null,
      latencyMs: 5,
      sentLocation: null,
      providerReportedLocation: null,
      meta: { simulated: true },
    };
  },
};
