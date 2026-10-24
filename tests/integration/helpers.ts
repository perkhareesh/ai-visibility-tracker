import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, resetDbForTests } from "@/db";
import { registerProvider } from "@/lib/providers";
import { ProviderError, type ProviderAdapter, type ProviderRequest, type ProviderResult } from "@/lib/providers/types";
import { resetRateLimits } from "@/lib/ratelimit";
import { createSession, registerUser, resolveSession, type AuthContext } from "@/server/auth-core";

let migrated = false;
export async function setupTestDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set for integration tests");
  process.env.DATABASE_URL = url;
  const db = await resetDbForTests(url);
  if (!migrated) {
    await migrate(db, { migrationsFolder: "./drizzle" });
    migrated = true;
  }
  await db.execute(sql`TRUNCATE users, workspaces, audit_events RESTART IDENTITY CASCADE`);
  resetRateLimits();
  return db;
}

export async function makeUser(email: string, ws = "Acme Agency"): Promise<{ ctx: AuthContext; token: string }> {
  const { user } = await registerUser({ email, password: "correct horse battery", name: email.split("@")[0], workspaceName: ws });
  const { token } = await createSession(user.id);
  const ctx = await resolveSession(token);
  if (!ctx) throw new Error("session not resolved");
  return { ctx, token };
}

/** Live-origin test double: deterministic answers, scripted failures. Never used outside tests. */
export const mockBehaviour: { fail: Map<string, ProviderError[]>; calls: ProviderRequest[] } = { fail: new Map(), calls: [] };
export const mockProvider: ProviderAdapter = {
  id: "mock-live",
  label: "Mock live provider (tests)",
  description: "test double",
  dataOrigin: "live",
  capabilities: { citations: true, geo: { country: "sent_as_hint", region: "sent_as_hint", city: "label_only" }, reportsLocation: false, language: "instruction", costReporting: false },
  defaultModel: () => "mock-1",
  isConfigured: () => true,
  setupInstructions: "",
  async execute(req): Promise<ProviderResult> {
    mockBehaviour.calls.push(req);
    const queue = mockBehaviour.fail.get(req.prompt);
    if (queue?.length) throw queue.shift()!;
    const text = req.prompt.includes("absent")
      ? "1. HubSpot is popular. 2. Zoho is cheap."
      : `We recommend Acme CRM, it is excellent ([acmecrm.com](https://acmecrm.com/?utm_source=openai)). HubSpot is expensive ([g2.com](https://www.g2.com/acme-vs-hubspot)).`;
    const citations = req.prompt.includes("absent")
      ? []
      : [
          { url: "https://acmecrm.com/?utm_source=openai", title: "Acme CRM", startIndex: 41, endIndex: 92 },
          { url: "https://www.g2.com/acme-vs-hubspot", title: "Acme CRM vs HubSpot", startIndex: 120, endIndex: 160 },
        ];
    return { text, citations, citationsAvailable: true, rawPayload: { mock: true }, providerResponseId: "mock", usage: { input_tokens: 1 }, costUsd: null, latencyMs: 1, sentLocation: req.country ? { type: "approximate", country: req.country } : null, providerReportedLocation: null, meta: {} };
  },
};
registerProvider(mockProvider);
