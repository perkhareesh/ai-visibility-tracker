import { ProviderError, type ProviderAdapter, type ProviderCitation, type ProviderRequest, type ProviderResult } from "./types";

/**
 * OpenAI Responses API + the hosted `web_search` tool.
 *
 * This is the supported, authorized way to get ChatGPT-style answers with
 * source citations programmatically. It is NOT the consumer ChatGPT app:
 * answers can differ from what a logged-in ChatGPT user sees (different
 * system prompt, memory, personalization, and model routing).
 *
 * Location: country / region / city are sent as `user_location` of type
 * "approximate". OpenAI treats this as a hint; the API does not report back
 * which location was actually used, so results are never labelled "verified local".
 */

const ENDPOINT = "https://api.openai.com/v1/responses";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", hi: "Hindi", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam", mr: "Marathi", bn: "Bengali",
  es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian", ja: "Japanese", ko: "Korean", zh: "Chinese",
  ar: "Arabic", nl: "Dutch",
};

export function buildOpenAIRequestBody(req: ProviderRequest, toolChoice: "auto" | "required" = "auto") {
  const userLocation: Record<string, string> = { type: "approximate" };
  if (req.country) userLocation.country = req.country.toUpperCase();
  if (req.region) userLocation.region = req.region;
  if (req.city) userLocation.city = req.city;
  const hasLocation = Object.keys(userLocation).length > 1;
  const body: Record<string, unknown> = {
    model: req.model,
    input: req.prompt,
    tools: [{ type: "web_search", ...(hasLocation ? { user_location: userLocation } : {}) }],
    tool_choice: toolChoice,
    include: ["web_search_call.action.sources"],
    store: false,
  };
  if (req.language && req.language !== "en") {
    body.instructions = `Respond in ${LANGUAGE_NAMES[req.language] ?? req.language}.`;
  }
  return { body, sentLocation: hasLocation ? userLocation : null };
}

interface OAIAnnotation {
  type: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}
interface OAIOutputItem {
  type: string;
  id?: string;
  status?: string;
  content?: Array<{ type: string; text?: string; annotations?: OAIAnnotation[] }>;
  action?: { type?: string; query?: string; queries?: string[]; sources?: Array<{ type?: string; url?: string }> };
}

/** Parse a Responses API payload into text + citations with offsets relative to the joined text. */
export function parseOpenAIResponse(payload: Record<string, unknown>) {
  const output = (payload.output as OAIOutputItem[] | undefined) ?? [];
  let text = "";
  const citations: ProviderCitation[] = [];
  const searches: Array<{ query?: string; queries?: string[]; sources: string[] }> = [];
  for (const item of output) {
    if (item.type === "web_search_call") {
      searches.push({
        query: item.action?.query,
        queries: item.action?.queries,
        sources: (item.action?.sources ?? []).map((s) => s.url).filter((u): u is string => !!u),
      });
    }
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text" || typeof part.text !== "string") continue;
      if (text) text += "\n\n";
      const base = text.length;
      text += part.text;
      for (const a of part.annotations ?? []) {
        if (a.type !== "url_citation" || !a.url) continue;
        citations.push({
          url: a.url,
          title: a.title ?? null,
          startIndex: typeof a.start_index === "number" ? base + a.start_index : null,
          endIndex: typeof a.end_index === "number" ? base + a.end_index : null,
        });
      }
    }
  }
  return { text, citations, searches };
}

export const openaiProvider: ProviderAdapter = {
  id: "openai",
  label: "OpenAI (Responses API + web search)",
  description:
    "ChatGPT-family models via the official OpenAI API with the hosted web_search tool. Returns inline URL citations. Not identical to the consumer ChatGPT app.",
  dataOrigin: "live",
  capabilities: {
    citations: true,
    geo: { country: "sent_as_hint", region: "sent_as_hint", city: "sent_as_hint" },
    reportsLocation: false,
    language: "instruction",
    costReporting: false,
  },
  defaultModel: () => process.env.OPENAI_MODEL || "gpt-5.5",
  isConfigured: () => !!process.env.OPENAI_API_KEY,
  setupInstructions:
    "Set OPENAI_API_KEY (and optionally OPENAI_MODEL, OPENAI_WEB_SEARCH_TOOL_CHOICE) in the server environment, then restart the app and worker. Keys are never stored in the database or sent to the browser.",
  async execute(req: ProviderRequest): Promise<ProviderResult> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new ProviderError("OPENAI_API_KEY is not configured", "not_configured", false);
    const toolChoice = process.env.OPENAI_WEB_SEARCH_TOOL_CHOICE === "required" ? "required" : "auto";
    const { body, sentLocation } = buildOpenAIRequestBody(req, toolChoice);
    const timeoutMs = Number(process.env.PROVIDER_TIMEOUT_MS || 90000);
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new ProviderError(timeout ? `Provider timed out after ${timeoutMs} ms` : `Network error: ${msg}`, timeout ? "timeout" : "network", true);
    }
    const latencyMs = Date.now() - started;
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const err = (json?.error as { message?: string; code?: string } | undefined) ?? {};
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(`OpenAI ${res.status}: ${err.message ?? res.statusText}`, err.code ?? `http_${res.status}`, retryable, res.status);
    }
    if (!json) throw new ProviderError("OpenAI returned a non-JSON response", "bad_response", true);
    if (json.status && json.status !== "completed") {
      const reason = (json.incomplete_details as { reason?: string } | undefined)?.reason;
      throw new ProviderError(`OpenAI response status "${json.status}"${reason ? ` (${reason})` : ""}`, "incomplete", json.status !== "failed");
    }
    const parsed = parseOpenAIResponse(json);
    if (!parsed.text.trim()) throw new ProviderError("OpenAI returned an empty answer", "empty", true);
    return {
      text: parsed.text,
      citations: parsed.citations,
      citationsAvailable: true,
      rawPayload: { request: { ...body }, response: json },
      providerResponseId: typeof json.id === "string" ? json.id : null,
      usage: (json.usage as Record<string, unknown>) ?? null,
      costUsd: null, // the API does not return cost; we do not estimate it
      latencyMs,
      sentLocation,
      providerReportedLocation: null,
      meta: {
        modelReported: json.model ?? null,
        webSearchCalls: parsed.searches.length,
        searches: parsed.searches,
        toolChoice,
      },
    };
  },
};
