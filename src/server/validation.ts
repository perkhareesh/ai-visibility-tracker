import { z } from "zod";
import { isSafePublicHttpUrl, normalizeDomain } from "@/lib/url";

const listField = (max = 50, itemMax = 120) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(/[\n,]/)))
    .transform((v) => [...new Set(v.map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(itemMax)).max(max));

const countryCode = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter ISO country code"));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const domainList = listField(20, 253).transform((ds, ctx) => {
  const out: string[] = [];
  for (const d of ds) {
    const n = normalizeDomain(d);
    if (!n) ctx.addIssue({ code: "custom", message: `Invalid domain: ${d}` });
    else out.push(n);
  }
  return [...new Set(out)];
});

export const competitorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  aliases: listField(20),
  domains: domainList,
});

export const brandSchema = z.object({
  name: z.string().trim().min(1, "Brand name is required").max(120),
  websiteUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null))
    .refine((v) => v === null || isSafePublicHttpUrl(v), "Website must be a public http(s) URL"),
  domains: domainList,
  aliases: listField(30),
  products: listField(50),
  industry: optionalText(120),
  targetCountries: listField(50, 2).pipe(z.array(countryCode)),
  targetRegions: listField(50),
  languages: listField(20, 10),
  notes: optionalText(2000),
  competitors: z.array(competitorSchema).max(30).default([]),
});
export type BrandInput = z.input<typeof brandSchema>;

export const intentValues = ["informational", "commercial", "transactional", "navigational", "comparison", "other"] as const;
export const frequencyValues = ["manual", "daily", "weekly", "monthly"] as const;

export const querySchema = z.object({
  brandId: z.string().uuid(),
  text: z.string().trim().min(3, "Query is too short").max(500),
  topic: optionalText(120),
  intent: z.enum(intentValues).default("commercial"),
  country: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toUpperCase() : null))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), "Use a 2-letter ISO country code"),
  region: optionalText(120),
  city: optionalText(120),
  language: z.string().trim().toLowerCase().regex(/^[a-z]{2}(-[a-z]{2})?$/, "Use a language code like en or hi").default("en"),
  frequency: z.enum(frequencyValues).default("manual"),
  status: z.enum(["active", "paused"]).default("active"),
});
export type QueryInput = z.input<typeof querySchema>;

export const bulkQuerySchema = querySchema.omit({ text: true }).extend({
  lines: z
    .string()
    .transform((s) => [...new Set(s.split("\n").map((l) => l.trim()).filter(Boolean))])
    .pipe(z.array(z.string().min(3).max(500)).min(1, "Add at least one query").max(200, "Max 200 queries per import")),
});

export const startRunSchema = z.object({
  brandId: z.string().uuid(),
  provider: z.string().min(1).max(50),
  model: z.string().trim().min(1).max(100).regex(/^[\w.:-]+$/, "Invalid model id"),
  queryIds: z.array(z.string().uuid()).max(500).optional(),
  idempotencyKey: z.string().min(8).max(200),
  label: optionalText(120),
});

export const overrideSchema = z.object({
  snapshotId: z.string().uuid(),
  field: z.enum(["sentiment", "recommendation"]),
  value: z.string(),
  note: optionalText(500),
}).refine(
  (v) =>
    v.field === "sentiment"
      ? ["positive", "neutral", "negative", "mixed", "insufficient"].includes(v.value)
      : ["recommended", "listed", "mentioned", "not_recommended", "absent"].includes(v.value),
  { message: "Invalid label value", path: ["value"] },
);

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});
export const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(100),
  workspaceName: z.string().trim().min(1).max(100),
});
