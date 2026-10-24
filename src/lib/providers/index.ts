import { demoProvider } from "./demo";
import { openaiProvider } from "./openai";
import type { ProviderAdapter } from "./types";

const registry = new Map<string, ProviderAdapter>([
  [openaiProvider.id, openaiProvider],
  [demoProvider.id, demoProvider],
]);

/** Register an additional adapter (e.g. another AI search provider, or a test double). */
export function registerProvider(p: ProviderAdapter) {
  registry.set(p.id, p);
}

export function getProvider(id: string): ProviderAdapter | undefined {
  return registry.get(id);
}

/** Providers selectable in a workspace. Demo workspaces may only use simulated providers;
 *  live workspaces may never use them. */
export function providersForWorkspace(isDemo: boolean): ProviderAdapter[] {
  return [...registry.values()].filter((p) => (isDemo ? p.dataOrigin === "simulated" : p.dataOrigin === "live"));
}

export type { ProviderAdapter } from "./types";
