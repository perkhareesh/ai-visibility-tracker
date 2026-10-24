import { describe, expect, it } from "vitest";
import { detectAll } from "@/lib/analysis/detect";
import { analyzeSentiment } from "@/lib/analysis/sentiment";

const acme = { key: "b", name: "Acme", aliases: [], domains: [] };
const rival = { key: "c", name: "Rival", aliases: [], domains: [] };
const run = (text: string) => {
  const [t, ...c] = detectAll(text, [acme, rival]);
  return analyzeSentiment(t, c);
};

describe("analyzeSentiment", () => {
  it("positive portrayal", () => {
    const r = run("Acme is excellent and reliable, with an intuitive interface.");
    expect(r.label).toBe("positive");
    expect(r.positives.length).toBe(1);
    expect(r.attributes).toContain("ease of use");
  });
  it("negative portrayal", () => expect(run("Acme is expensive and buggy.").label).toBe("negative"));
  it("mixed portrayal", () => expect(run("Acme is powerful but expensive.").label).toBe("mixed"));
  it("neutral when no polarity cues", () => expect(run("Acme was founded in 2010.").label).toBe("neutral"));
  it("insufficient evidence when absent", () => {
    const r = run("Rival is great.");
    expect(r.label).toBe("insufficient");
    expect(r.recommendationStatus).toBe("absent");
    expect(r.confidence).toBeNull();
  });
  it("handles negation", () => expect(run("Acme is not expensive.").label).toBe("neutral"));
  it("captures competitor comparisons", () => {
    expect(run("Acme is cheaper than Rival for small teams.").competitorComparisons).toHaveLength(1);
  });
  it("recommendation status", () => {
    expect(run("We recommend Acme.").recommendationStatus).toBe("recommended");
    expect(run("- Acme\n- Rival").recommendationStatus).toBe("listed");
    expect(run("Acme exists.").recommendationStatus).toBe("mentioned");
  });
  it("is versioned", () => expect(run("Acme").analysisVersion).toBe("rules-v1.1"));
  it("stores clean excerpts without citation chips or markdown", () => {
    const r = run("1. **Acme** is excellent ([g2.com](https://g2.com/x?utm_source=openai)).");
    expect(r.positives[0]).toBe("Acme is excellent.");
  });
});
