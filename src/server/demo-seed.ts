import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { workspaces } from "@/db/schema";
import { resolveDemoCtx } from "./demo-ctx";
import { createBrand } from "./services/brands";
import { bulkCreateQueries } from "./services/queries";
import { startRun } from "./services/runs";
import { drainJobs } from "./worker";

/**
 * Fills a demo workspace with fictional brands (".example" domains) and three
 * simulated runs. Nothing here is a real ChatGPT observation.
 */
export async function seedDemoWorkspace(workspaceId: string, userId: string) {
  const [ws] = await getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws?.isDemo) throw new Error("Demo data can only be seeded into a demo workspace");
  const ctx = await resolveDemoCtx(workspaceId, userId);
  const brand = await createBrand(ctx, {
    name: "Brightdesk",
    websiteUrl: "https://brightdesk.example",
    domains: "",
    aliases: "Bright Desk",
    products: "Brightdesk Inbox, Brightdesk AI Agent",
    industry: "Customer support software",
    targetCountries: "IN, US",
    targetRegions: "Karnataka",
    languages: "en",
    notes: "Fictional demo brand.",
    competitors: [
      { name: "Ticketly", domains: "ticketly.example", aliases: "" },
      { name: "SupportHive", domains: "supporthive.example", aliases: "" },
      { name: "Helpwise Cloud", domains: "helpwise.example", aliases: "Helpwise" },
    ],
  });
  await bulkCreateQueries(ctx, {
    brandId: brand.id,
    lines: [
      "Best help desk software in India",
      "Top customer support tools for startups",
      "Alternatives to Ticketly",
      "Which brands provide AI support agents?",
      "Best shared inbox for small teams",
      "Help desk software with WhatsApp integration",
    ].join("\n"),
    country: "IN",
    region: "Karnataka",
    language: "en",
    intent: "commercial",
    frequency: "weekly",
    status: "active",
  });
  for (let i = 0; i < 3; i++) {
    await startRun(ctx, { brandId: brand.id, provider: "demo", model: "demo-sim-1", idempotencyKey: randomUUID(), label: `Demo run ${i + 1}` });
    await drainJobs();
  }
}
