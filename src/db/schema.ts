import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  numeric,
  index,
  uniqueIndex,
  primaryKey,
  real,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------- Enums ----------
export const roleEnum = pgEnum("member_role", ["owner", "admin", "member"]);
export const brandStatusEnum = pgEnum("brand_status", ["active", "archived"]);
export const queryStatusEnum = pgEnum("query_status", ["active", "paused"]);
export const frequencyEnum = pgEnum("tracking_frequency", ["manual", "daily", "weekly", "monthly"]);
export const intentEnum = pgEnum("search_intent", [
  "informational",
  "commercial",
  "transactional",
  "navigational",
  "comparison",
  "other",
]);
export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
export const runTriggerEnum = pgEnum("run_trigger", ["manual", "schedule", "retry"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "dead"]);
export const dataOriginEnum = pgEnum("data_origin", ["live", "simulated"]);
export const snapshotStatusEnum = pgEnum("snapshot_status", ["success", "failed"]);
export const analysisStatusEnum = pgEnum("analysis_status", ["complete", "skipped", "failed"]);
export const entityTypeEnum = pgEnum("entity_type", ["tracked", "competitor"]);
export const citationTypeEnum = pgEnum("citation_type", [
  "official",
  "third_party_mention",
  "competitor",
  "other",
]);
export const sentimentEnum = pgEnum("sentiment_label", [
  "positive",
  "neutral",
  "negative",
  "mixed",
  "insufficient",
]);
export const recommendationEnum = pgEnum("recommendation_status", [
  "recommended",
  "listed",
  "mentioned",
  "not_recommended",
  "absent",
]);
export const overrideFieldEnum = pgEnum("override_field", ["sentiment", "recommendation"]);

// ---------- Users & workspaces ----------
export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  // Demo workspaces hold deterministic simulated data only and can never run live providers.
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workspaceId] }), index("memberships_ws_idx").on(t.workspaceId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    activeWorkspaceId: uuid("active_workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

// ---------- Brands ----------
export const brands = pgTable(
  "brands",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    websiteUrl: text("website_url"),
    industry: text("industry"),
    products: text("products").array().notNull().default(sql`'{}'::text[]`),
    targetCountries: text("target_countries").array().notNull().default(sql`'{}'::text[]`),
    targetRegions: text("target_regions").array().notNull().default(sql`'{}'::text[]`),
    languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
    notes: text("notes"),
    status: brandStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("brands_ws_idx").on(t.workspaceId, t.status),
    uniqueIndex("brands_ws_name_uq").on(t.workspaceId, sql`lower(${t.name})`),
  ],
);

export const brandDomains = pgTable(
  "brand_domains",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(), // normalized registrable host, no www
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("brand_domains_uq").on(t.brandId, t.domain), index("brand_domains_ws_idx").on(t.workspaceId, t.domain)],
);

export const brandAliases = pgTable(
  "brand_aliases",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("brand_aliases_uq").on(t.brandId, sql`lower(${t.alias})`)],
);

export const competitors = pgTable(
  "competitors",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    domains: text("domains").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("competitors_uq").on(t.brandId, sql`lower(${t.name})`), index("competitors_ws_idx").on(t.workspaceId)],
);

// ---------- Tracking queries & schedules ----------
export const trackingQueries = pgTable(
  "tracking_queries",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    topic: text("topic"),
    intent: intentEnum("intent").notNull().default("commercial"),
    country: text("country"), // ISO-3166 alpha-2
    region: text("region"),
    city: text("city"),
    language: text("language").notNull().default("en"),
    frequency: frequencyEnum("frequency").notNull().default("manual"),
    status: queryStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("queries_ws_brand_idx").on(t.workspaceId, t.brandId, t.status),
    uniqueIndex("queries_dedupe_uq").on(
      t.brandId,
      sql`lower(${t.text})`,
      sql`coalesce(${t.country}, '')`,
      sql`coalesce(${t.region}, '')`,
      sql`coalesce(${t.city}, '')`,
      t.language,
    ),
  ],
);

// One schedule row per (brand, provider/model). Scheduled runs pick up all active
// queries of the brand whose frequency matches.
export const trackingSchedules = pgTable(
  "tracking_schedules",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    frequency: frequencyEnum("frequency").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("schedules_uq").on(t.brandId, t.frequency, t.provider, t.model),
    index("schedules_due_idx").on(t.enabled, t.nextRunAt),
  ],
);

// ---------- Provider configuration (no secrets stored here) ----------
export const providerConfigs = pgTable(
  "provider_configs",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    defaultModel: text("default_model").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    settings: jsonb("settings").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("provider_configs_uq").on(t.workspaceId, t.provider)],
);

// ---------- Runs & jobs ----------
export const trackingRuns = pgTable(
  "tracking_runs",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    dataOrigin: dataOriginEnum("data_origin").notNull(),
    status: runStatusEnum("status").notNull().default("queued"),
    trigger: runTriggerEnum("trigger").notNull().default("manual"),
    idempotencyKey: text("idempotency_key").notNull(),
    label: text("label"),
    totalJobs: integer("total_jobs").notNull().default(0),
    succeededJobs: integer("succeeded_jobs").notNull().default(0),
    failedJobs: integer("failed_jobs").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("runs_idem_uq").on(t.workspaceId, t.idempotencyKey),
    index("runs_ws_brand_idx").on(t.workspaceId, t.brandId, t.createdAt),
    index("runs_status_idx").on(t.workspaceId, t.status),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => trackingRuns.id, { onDelete: "cascade" }),
    queryId: uuid("query_id").notNull().references(() => trackingQueries.id, { onDelete: "cascade" }),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    // Frozen copy of the query settings at enqueue time so later query edits
    // never change what a historical run executed.
    querySnapshot: jsonb("query_snapshot").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("jobs_run_query_uq").on(t.runId, t.queryId),
    index("jobs_pick_idx").on(t.status, t.runAfter),
  ],
);

// ---------- Immutable snapshots & raw evidence ----------
export const snapshots = pgTable(
  "snapshots",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => trackingRuns.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    queryId: uuid("query_id").notNull().references(() => trackingQueries.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    dataOrigin: dataOriginEnum("data_origin").notNull(),
    status: snapshotStatusEnum("status").notNull(),
    errorMessage: text("error_message"),
    promptText: text("prompt_text").notNull(),
    language: text("language").notNull(),
    // What the user asked for vs what was sent vs what the provider reported.
    requestedLocation: jsonb("requested_location").notNull(),
    sentLocation: jsonb("sent_location"),
    providerReportedLocation: jsonb("provider_reported_location"),
    citationsAvailable: boolean("citations_available").notNull().default(false),
    analysisStatus: analysisStatusEnum("analysis_status").notNull(),
    analysisVersion: text("analysis_version"),
    // Brand/competitor configuration used for analysis, frozen for reproducibility.
    analysisInputs: jsonb("analysis_inputs"),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    attempt: integer("attempt").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("snapshots_run_query_uq").on(t.runId, t.queryId),
    index("snapshots_ws_brand_idx").on(t.workspaceId, t.brandId, t.executedAt),
    index("snapshots_query_idx").on(t.queryId, t.executedAt),
  ],
);

export const aiResponses = pgTable("ai_responses", {
  id: id(),
  snapshotId: uuid("snapshot_id").notNull().unique().references(() => snapshots.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  responseText: text("response_text").notNull(),
  rawPayload: jsonb("raw_payload"),
  providerResponseId: text("provider_response_id"),
  usage: jsonb("usage"),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
  latencyMs: integer("latency_ms"),
  createdAt: createdAt(),
});

export const brandMentions = pgTable(
  "brand_mentions",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").notNull().references(() => snapshots.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    // No FK: mentions are immutable evidence and must survive competitor edits/removal.
    competitorId: uuid("competitor_id"),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityName: text("entity_name").notNull(),
    mentioned: boolean("mentioned").notNull(),
    mentionCount: integer("mention_count").notNull().default(0),
    firstOffset: integer("first_offset"),
    inList: boolean("in_list").notNull().default(false),
    listRank: integer("list_rank"),
    recommended: boolean("recommended").notNull().default(false),
    viaProduct: boolean("via_product").notNull().default(false),
    productTerms: text("product_terms").array().notNull().default(sql`'{}'::text[]`),
    linkedViaCitation: boolean("linked_via_citation").notNull().default(false),
    matches: jsonb("matches").notNull().default([]), // [{start,end,term}]
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("mentions_uq").on(t.snapshotId, t.entityType, sql`lower(${t.entityName})`),
    index("mentions_brand_idx").on(t.workspaceId, t.brandId),
  ],
);

export const citations = pgTable(
  "citations",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").notNull().references(() => snapshots.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => trackingRuns.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    queryId: uuid("query_id").notNull().references(() => trackingQueries.id, { onDelete: "cascade" }),
    originalUrl: text("original_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    domain: text("domain").notNull(),
    title: text("title"),
    position: integer("position"), // 1-based order of appearance in the answer
    startIndex: integer("start_index"),
    endIndex: integer("end_index"),
    citationType: citationTypeEnum("citation_type").notNull(),
    citedEntity: text("cited_entity"), // brand/competitor owning the domain or named in the anchor context
    country: text("country"),
    region: text("region"),
    city: text("city"),
    source: text("source").notNull().default("annotation"), // annotation | inline_link
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("citations_ws_brand_idx").on(t.workspaceId, t.brandId, t.executedAt),
    index("citations_domain_idx").on(t.workspaceId, t.domain),
    index("citations_url_idx").on(t.workspaceId, t.normalizedUrl),
    index("citations_snapshot_idx").on(t.snapshotId),
  ],
);

export const sentimentAnalyses = pgTable(
  "sentiment_analyses",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").notNull().references(() => snapshots.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    label: sentimentEnum("label").notNull(),
    confidence: real("confidence"),
    recommendationStatus: recommendationEnum("recommendation_status").notNull(),
    mentionContext: text("mention_context"),
    positives: jsonb("positives").notNull().default([]),
    negatives: jsonb("negatives").notNull().default([]),
    attributes: jsonb("attributes").notNull().default([]),
    competitorComparisons: jsonb("competitor_comparisons").notNull().default([]),
    explanation: text("explanation").notNull(),
    excerpt: text("excerpt"),
    analysisVersion: text("analysis_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sentiment_snapshot_uq").on(t.snapshotId, t.brandId)],
);

// Manual corrections live beside the immutable analysis; effective label = latest override.
export const labelOverrides = pgTable(
  "label_overrides",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").notNull().references(() => snapshots.id, { onDelete: "cascade" }),
    field: overrideFieldEnum("field").notNull(),
    value: text("value").notNull(),
    note: text("note"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("overrides_snapshot_idx").on(t.snapshotId, t.field, t.createdAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    meta: jsonb("meta").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_ws_idx").on(t.workspaceId, t.createdAt)],
);
