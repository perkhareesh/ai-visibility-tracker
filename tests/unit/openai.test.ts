import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOpenAIRequestBody, openaiProvider, parseOpenAIResponse } from "@/lib/providers/openai";

// Shape follows the documented Responses API output (message + url_citation annotations,
// web_search_call with action.sources). These are parser tests, not live calls.
const payload = {
  id: "resp_123",
  status: "completed",
  model: "gpt-5.5",
  output: [
    { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "best crm india", sources: [{ type: "url", url: "https://a.com" }] } },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "Acme is popular ([acme.com](https://acme.com/?utm_source=openai)).",
          annotations: [{ type: "url_citation", start_index: 16, end_index: 66, url: "https://acme.com/?utm_source=openai", title: "Acme" }],
        },
      ],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 20 },
};

describe("OpenAI adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("builds web_search request with approximate location and language instruction", () => {
    const { body, sentLocation } = buildOpenAIRequestBody({ prompt: "best crm", model: "gpt-5.5", language: "hi", country: "in", region: "Karnataka", city: "Bengaluru" });
    expect(body.tools).toEqual([{ type: "web_search", user_location: { type: "approximate", country: "IN", region: "Karnataka", city: "Bengaluru" } }]);
    expect(body.instructions).toBe("Respond in Hindi.");
    expect(body.input).toBe("best crm");
    expect(sentLocation).toMatchObject({ country: "IN" });
  });

  it("omits user_location when no location is set", () => {
    const { body, sentLocation } = buildOpenAIRequestBody({ prompt: "x", model: "m", language: "en", country: null, region: null, city: null });
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.instructions).toBeUndefined();
    expect(sentLocation).toBeNull();
  });

  it("parses text, citations and searches", () => {
    const p = parseOpenAIResponse(payload);
    expect(p.text).toContain("Acme is popular");
    expect(p.citations).toEqual([{ url: "https://acme.com/?utm_source=openai", title: "Acme", startIndex: 16, endIndex: 66 }]);
    expect(p.searches[0].sources).toEqual(["https://a.com"]);
  });

  it("refuses to run without a key", async () => {
    await expect(openaiProvider.execute({ prompt: "x", model: "m", language: "en", country: null, region: null, city: null })).rejects.toMatchObject({ code: "not_configured", retryable: false });
  });

  it("maps HTTP errors to retryable / non-retryable", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429 })));
    await expect(openaiProvider.execute({ prompt: "x", model: "m", language: "en", country: null, region: null, city: null })).rejects.toMatchObject({ retryable: true, status: 429 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })));
    await expect(openaiProvider.execute({ prompt: "x", model: "m", language: "en", country: null, region: null, city: null })).rejects.toMatchObject({ retryable: false, status: 401 });
  });

  it("returns parsed result on success and never estimates cost", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const f = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await openaiProvider.execute({ prompt: "x", model: "gpt-5.5", language: "en", country: "IN", region: null, city: null });
    expect(r.citations).toHaveLength(1);
    expect(r.citationsAvailable).toBe(true);
    expect(r.costUsd).toBeNull();
    expect(r.providerReportedLocation).toBeNull();
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
  });
});
