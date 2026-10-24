export type GeoSupport = "sent_as_hint" | "label_only";

export interface ProviderCapabilities {
  /** Provider returns structured citation metadata (URL, title, position). */
  citations: boolean;
  /** How each geographic field is handled. "sent_as_hint" = passed to the provider as an
   *  approximate-location hint; it does NOT guarantee a localized answer.
   *  "label_only" = stored for organisation, never sent. */
  geo: { country: GeoSupport; region: GeoSupport; city: GeoSupport };
  /** Whether the provider reports back the location it actually used. */
  reportsLocation: boolean;
  language: "instruction" | "label_only";
  costReporting: boolean;
}

export interface ProviderRequest {
  prompt: string;
  model: string;
  language: string;
  country: string | null;
  region: string | null;
  city: string | null;
  /** Deterministic seed material (used by the demo provider only). */
  seed?: string;
  demoContext?: DemoContext;
}

export interface DemoContext {
  brand: { name: string; domains: string[]; products: string[] };
  competitors: Array<{ name: string; domains: string[] }>;
  runIndex: number;
}

export interface ProviderCitation {
  url: string;
  title: string | null;
  startIndex: number | null;
  endIndex: number | null;
}

export interface ProviderResult {
  text: string;
  citations: ProviderCitation[];
  citationsAvailable: boolean;
  rawPayload: unknown;
  providerResponseId: string | null;
  usage: Record<string, unknown> | null;
  costUsd: number | null;
  latencyMs: number;
  sentLocation: Record<string, string> | null;
  providerReportedLocation: Record<string, unknown> | null;
  meta: Record<string, unknown>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderAdapter {
  id: string;
  label: string;
  description: string;
  dataOrigin: "live" | "simulated";
  capabilities: ProviderCapabilities;
  defaultModel(): string;
  isConfigured(): boolean;
  setupInstructions: string;
  execute(req: ProviderRequest): Promise<ProviderResult>;
}
