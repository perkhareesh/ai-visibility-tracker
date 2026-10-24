CREATE TYPE "public"."analysis_status" AS ENUM('complete', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."brand_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."citation_type" AS ENUM('official', 'third_party_mention', 'competitor', 'other');--> statement-breakpoint
CREATE TYPE "public"."data_origin" AS ENUM('live', 'simulated');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('tracked', 'competitor');--> statement-breakpoint
CREATE TYPE "public"."tracking_frequency" AS ENUM('manual', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."search_intent" AS ENUM('informational', 'commercial', 'transactional', 'navigational', 'comparison', 'other');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."override_field" AS ENUM('sentiment', 'recommendation');--> statement-breakpoint
CREATE TYPE "public"."query_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('recommended', 'listed', 'mentioned', 'not_recommended', 'absent');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'completed', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('manual', 'schedule', 'retry');--> statement-breakpoint
CREATE TYPE "public"."sentiment_label" AS ENUM('positive', 'neutral', 'negative', 'mixed', 'insufficient');--> statement-breakpoint
CREATE TYPE "public"."snapshot_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TABLE "ai_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"response_text" text NOT NULL,
	"raw_payload" jsonb,
	"provider_response_id" text,
	"usage" jsonb,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_responses_snapshot_id_unique" UNIQUE("snapshot_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"competitor_id" uuid,
	"entity_type" "entity_type" NOT NULL,
	"entity_name" text NOT NULL,
	"mentioned" boolean NOT NULL,
	"mention_count" integer DEFAULT 0 NOT NULL,
	"first_offset" integer,
	"in_list" boolean DEFAULT false NOT NULL,
	"list_rank" integer,
	"recommended" boolean DEFAULT false NOT NULL,
	"via_product" boolean DEFAULT false NOT NULL,
	"product_terms" text[] DEFAULT '{}'::text[] NOT NULL,
	"linked_via_citation" boolean DEFAULT false NOT NULL,
	"matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"industry" text,
	"products" text[] DEFAULT '{}'::text[] NOT NULL,
	"target_countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"target_regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"status" "brand_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"original_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"position" integer,
	"start_index" integer,
	"end_index" integer,
	"citation_type" "citation_type" NOT NULL,
	"cited_entity" text,
	"country" text,
	"region" text,
	"city" text,
	"source" text DEFAULT 'annotation' NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"query_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"field" "override_field" NOT NULL,
	"value" text NOT NULL,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"default_model" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sentiment_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"label" "sentiment_label" NOT NULL,
	"confidence" real,
	"recommendation_status" "recommendation_status" NOT NULL,
	"mention_context" text,
	"positives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"negatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"competitor_comparisons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"explanation" text NOT NULL,
	"excerpt" text,
	"analysis_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"active_workspace_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"data_origin" "data_origin" NOT NULL,
	"status" "snapshot_status" NOT NULL,
	"error_message" text,
	"prompt_text" text NOT NULL,
	"language" text NOT NULL,
	"requested_location" jsonb NOT NULL,
	"sent_location" jsonb,
	"provider_reported_location" jsonb,
	"citations_available" boolean DEFAULT false NOT NULL,
	"analysis_status" "analysis_status" NOT NULL,
	"analysis_version" text,
	"executed_at" timestamp with time zone NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"text" text NOT NULL,
	"topic" text,
	"intent" "search_intent" DEFAULT 'commercial' NOT NULL,
	"country" text,
	"region" text,
	"city" text,
	"language" text DEFAULT 'en' NOT NULL,
	"frequency" "tracking_frequency" DEFAULT 'manual' NOT NULL,
	"status" "query_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"data_origin" "data_origin" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"trigger" "run_trigger" DEFAULT 'manual' NOT NULL,
	"idempotency_key" text NOT NULL,
	"label" text,
	"total_jobs" integer DEFAULT 0 NOT NULL,
	"succeeded_jobs" integer DEFAULT 0 NOT NULL,
	"failed_jobs" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tracking_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"frequency" "tracking_frequency" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_responses" ADD CONSTRAINT "ai_responses_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_responses" ADD CONSTRAINT "ai_responses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_aliases" ADD CONSTRAINT "brand_aliases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_aliases" ADD CONSTRAINT "brand_aliases_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_domains" ADD CONSTRAINT "brand_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_domains" ADD CONSTRAINT "brand_domains_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_mentions" ADD CONSTRAINT "brand_mentions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_mentions" ADD CONSTRAINT "brand_mentions_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_mentions" ADD CONSTRAINT "brand_mentions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_mentions" ADD CONSTRAINT "brand_mentions_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_run_id_tracking_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."tracking_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_query_id_tracking_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."tracking_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_run_id_tracking_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."tracking_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_query_id_tracking_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."tracking_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_overrides" ADD CONSTRAINT "label_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_overrides" ADD CONSTRAINT "label_overrides_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_overrides" ADD CONSTRAINT "label_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentiment_analyses" ADD CONSTRAINT "sentiment_analyses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentiment_analyses" ADD CONSTRAINT "sentiment_analyses_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentiment_analyses" ADD CONSTRAINT "sentiment_analyses_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_workspace_id_workspaces_id_fk" FOREIGN KEY ("active_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_run_id_tracking_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."tracking_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_query_id_tracking_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."tracking_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_queries" ADD CONSTRAINT "tracking_queries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_queries" ADD CONSTRAINT "tracking_queries_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_runs" ADD CONSTRAINT "tracking_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_runs" ADD CONSTRAINT "tracking_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_runs" ADD CONSTRAINT "tracking_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_schedules" ADD CONSTRAINT "tracking_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_schedules" ADD CONSTRAINT "tracking_schedules_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_ws_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_aliases_uq" ON "brand_aliases" USING btree ("brand_id",lower("alias"));--> statement-breakpoint
CREATE UNIQUE INDEX "brand_domains_uq" ON "brand_domains" USING btree ("brand_id","domain");--> statement-breakpoint
CREATE INDEX "brand_domains_ws_idx" ON "brand_domains" USING btree ("workspace_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "mentions_uq" ON "brand_mentions" USING btree ("snapshot_id","entity_type",lower("entity_name"));--> statement-breakpoint
CREATE INDEX "mentions_brand_idx" ON "brand_mentions" USING btree ("workspace_id","brand_id");--> statement-breakpoint
CREATE INDEX "brands_ws_idx" ON "brands" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_ws_name_uq" ON "brands" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "citations_ws_brand_idx" ON "citations" USING btree ("workspace_id","brand_id","executed_at");--> statement-breakpoint
CREATE INDEX "citations_domain_idx" ON "citations" USING btree ("workspace_id","domain");--> statement-breakpoint
CREATE INDEX "citations_url_idx" ON "citations" USING btree ("workspace_id","normalized_url");--> statement-breakpoint
CREATE INDEX "citations_snapshot_idx" ON "citations" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_uq" ON "competitors" USING btree ("brand_id",lower("name"));--> statement-breakpoint
CREATE INDEX "competitors_ws_idx" ON "competitors" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_run_query_uq" ON "jobs" USING btree ("run_id","query_id");--> statement-breakpoint
CREATE INDEX "jobs_pick_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "overrides_snapshot_idx" ON "label_overrides" USING btree ("snapshot_id","field","created_at");--> statement-breakpoint
CREATE INDEX "memberships_ws_idx" ON "memberships" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_configs_uq" ON "provider_configs" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "sentiment_snapshot_uq" ON "sentiment_analyses" USING btree ("snapshot_id","brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_run_query_uq" ON "snapshots" USING btree ("run_id","query_id");--> statement-breakpoint
CREATE INDEX "snapshots_ws_brand_idx" ON "snapshots" USING btree ("workspace_id","brand_id","executed_at");--> statement-breakpoint
CREATE INDEX "snapshots_query_idx" ON "snapshots" USING btree ("query_id","executed_at");--> statement-breakpoint
CREATE INDEX "queries_ws_brand_idx" ON "tracking_queries" USING btree ("workspace_id","brand_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "queries_dedupe_uq" ON "tracking_queries" USING btree ("brand_id",lower("text"),coalesce("country", ''),coalesce("region", ''),coalesce("city", ''),"language");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_idem_uq" ON "tracking_runs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "runs_ws_brand_idx" ON "tracking_runs" USING btree ("workspace_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "tracking_runs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_uq" ON "tracking_schedules" USING btree ("brand_id","frequency","provider","model");--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "tracking_schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));