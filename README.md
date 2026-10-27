# AI Visibility Tracker (V1)

Measures how brands appear in ChatGPT-family answers: mentions, recommendations, list placement, citations to the official domain vs third-party pages, and how the answer portrays the brand. Every execution is stored as an immutable snapshot so runs can be compared over time.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router, server components, server actions), React 19, TypeScript |
| Styling | Tailwind CSS 4 with semantic design tokens (`src/app/globals.css`) |
| Database | PostgreSQL 16 via Drizzle ORM 0.45 + drizzle-kit migrations |
| Jobs | Durable Postgres job queue (`jobs` table, `FOR UPDATE SKIP LOCKED`), scheduler, retries with backoff |
| Charts | Recharts 3 |
| Validation | Zod 4 on every action and service input |
| Auth | Email + password (bcrypt), opaque session tokens stored hashed, httpOnly cookie |
| Tests | Vitest 5 (unit + Postgres integration) |

Drizzle was chosen over Prisma because Prisma's `latest` tag was a release candidate at build time.

## Quick start

Requirements: Node 20.9+, PostgreSQL 14+.

```bash
cp .env.example .env            # set DATABASE_URL (and OPENAI_API_KEY for live tracking)
createdb aivt && createdb aivt_test
npm install
npm run db:migrate              # applies ./drizzle migrations
npm run db:seed-demo            # optional: demo@aivt.local / demo-password-123 with a simulated workspace
npm run build && npm start      # http://localhost:3000   (or: npm run dev)
```

With `WORKER_INLINE=true` (default in `.env.example`) the job worker runs inside the web server. In production set it to `false` and run the worker separately:

```bash
npm run worker
```

Running several workers is safe: jobs are claimed with `SKIP LOCKED`, and the scheduler and run creation are idempotent.

### Tests

```bash
npm test                        # all tests (integration tests need TEST_DATABASE_URL; the DB is wiped)
npm run test:unit
npm run test:integration
npm run typecheck
```

## Deploying to Vercel

Vercel functions can't keep a worker running in the background, so on Vercel the app processes jobs in these places instead:

- right after you start or retry a run (in the background, up to about 4 minutes)
- whenever a run page is open and nothing is processing that run (the page refreshes every few seconds)
- once a day from Vercel Cron (`vercel.json`), calling `/api/worker/tick`; this also starts scheduled runs

On the Hobby plan, cron runs at most once a day, so daily, weekly and monthly schedules start within that daily window.

Setup:

1. Push the repo to GitHub and import it in Vercel (framework: Next.js, no build settings to change).
2. Add a Postgres database: Vercel dashboard > Storage > Create > Neon (or any Postgres). Use the **pooled** connection string as `DATABASE_URL`.
3. Environment variables: `DATABASE_URL`, `CRON_SECRET` (any long random string), optionally `OPENAI_API_KEY` and `OPENAI_MODEL`.
4. Deploy. `npm run build` runs the database migrations automatically on Vercel (`scripts/build-migrate.ts`).
5. Open the site, create a workspace, and use Settings > "Create a demo workspace" to try it without an API key.

Preview deployments run migrations against whichever database their `DATABASE_URL` points to; give previews a separate database if you use them.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | none | PostgreSQL connection string |
| `TEST_DATABASE_URL` | none | Integration-test database (truncated on every test) |
| `OPENAI_API_KEY` | empty | Enables the live OpenAI provider. Server-side only |
| `OPENAI_MODEL` | `gpt-5.5` | Default model for runs (editable per run). Must support the `web_search` tool |
| `OPENAI_WEB_SEARCH_TOOL_CHOICE` | `auto` | `auto` lets the model decide whether to search; `required` forces a search |
| `PROVIDER_TIMEOUT_MS` | `90000` | Per-call timeout |
| `PROVIDER_RATE_LIMIT_PER_MIN` | `20` | Provider calls per minute per workspace (excess jobs are deferred, not failed) |
| `WORKER_INLINE` | `true` | Run the worker in the Next.js process |
| `WORKER_POLL_MS` | `2000` | Worker poll interval |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS (always on when running on Vercel) |
| `CRON_SECRET` | empty | Required for `/api/worker/tick` (Vercel Cron sends it) |
| `WORKER_MODE` | empty | `request` = serverless-style job processing (automatic on Vercel) |
| `DATABASE_POOL_MAX` | 10 (3 on Vercel) | Postgres connections per instance |
| `DEMO_EMAIL`, `DEMO_PASSWORD` | demo values | Used by `npm run db:seed-demo` |

## Provider setup

**OpenAI (live).** Uses the Responses API with the hosted `web_search` tool, which returns `url_citation` annotations (URL, title, character offsets). Country, region and city are sent as `user_location` of type `approximate`. Language other than `en` is sent as an instruction ("Respond in Hindi."). The exact request and full response payload are stored per snapshot.

Honest limits, also shown in the UI:
- This is the supported API, not the consumer ChatGPT app. Answers can differ from what a logged-in user sees.
- Location is a hint. The API does not report which location it used, so no result is labelled "verified local".
- The API does not return cost, so cost is shown as "not reported" rather than estimated.

**Demo (simulated).** Deterministic synthetic answers, fictional brands and `.example` domains. Only usable inside demo workspaces; live workspaces cannot select it, and demo workspaces cannot select live providers. Everything it produces is stored with `data_origin = simulated` and badged in the UI and CSV filename.

**Adding a provider.** Implement `ProviderAdapter` (`src/lib/providers/types.ts`) and register it in `src/lib/providers/index.ts`. The database, analysis and dashboard are provider-agnostic.

## How it works

```
Brand + domains + competitors ─┐
Tracking queries ──────────────┼─> startRun (idempotency key) ─> run + one job per query (query settings frozen)
                               │
worker: claim job ─> provider.execute ─> analyze (detect → citations → sentiment) ─> one transaction:
        snapshot + ai_response + brand_mentions + citations + sentiment ─> run counters ─> finalize run status
        retryable error → backoff + retry (max 3) ; permanent error → FAILED snapshot (no analytics)
```

Code layout:

- `src/lib/analysis/` pure detection, citation classification, sentiment (versioned `detect-v1+rules-v1.1`)
- `src/lib/metrics.ts` pure metric and comparison functions
- `src/lib/providers/` provider adapters
- `src/lib/url.ts` URL/domain normalisation and the SSRF guard
- `src/server/services/` workspace-scoped persistence and queries
- `src/server/worker.ts` queue, retries, scheduler loop
- `src/app/` pages and server actions

### Data model

`users`, `workspaces`, `memberships`, `sessions`, `brands`, `brand_domains`, `brand_aliases`, `competitors`, `tracking_queries`, `tracking_schedules`, `provider_configs`, `tracking_runs`, `jobs`, `snapshots`, `ai_responses`, `brand_mentions`, `citations`, `sentiment_analyses`, `label_overrides`, `audit_events`. Every row carries `workspace_id`; every service call filters by the session's workspace.

Immutability is enforced in the database (migration `0001_immutability`): `UPDATE` on snapshots, responses, mentions, citations and sentiment raises an error, and direct `DELETE` of snapshots is refused (cascade from deleting a brand or workspace is allowed). Manual label corrections go to `label_overrides`; the original analysis stays. Queries with history cannot be deleted, only paused. Each snapshot stores the prompt text, settings and brand/competitor configuration used for analysis.

Migrations: `0000_init`, `0001_immutability`, `0002_mention_competitor_no_fk`, `0003_snapshot_analysis_inputs`.

## Metric definitions

Also on the in-app **Metric definitions** page; every metric tile links to the executions behind it.

- **Brand Mention Rate** = successful executions where the brand name, an alias or an official domain appears in the answer text ÷ successful executions × 100. Link URLs and citation chips are excluded. Product-only references are tracked separately.
- **Citation Rate (official domain)** = successful executions with ≥1 citation whose host is an official domain or its subdomain ÷ successful executions that returned citation metadata × 100.
- **AI Citation Rate (any source)** = same denominator, ≥1 citation of any source.
- **Official-Domain Citation Count** = citation occurrences to official domains. Unique official URLs reported alongside.
- **Recommendation Rate** = successful executions with explicit recommendation language in the same sentence or list item as the brand, without negation ÷ successful executions × 100. Being listed is not a recommendation. Manual corrections override.
- **Visibility Share (custom)** = executions mentioning the brand ÷ sum of executions mentioning each tracked entity (brand + its competitors). Workspace-relative, not an industry standard.

Handling rules: failed executions and failed analysis are excluded from denominators and shown separately; an empty denominator shows "No data", never 0%; missing citation metadata is excluded from citation-rate denominators; occurrences, unique URLs and unique domains are separate; URL grouping strips tracking params (`utm_*`, `gclid`, …), fragments, `www.`, trailing slashes and treats http/https alike, while the original URL is kept.

**Comparisons** select 2–6 runs of one brand; the oldest is the baseline. Rate deltas are percentage points, counts are absolute. Differences in query set, provider, model, location, language or data origin are flagged, and by default only queries present in every run are compared. A query that failed in either run is "not comparable" for new/lost mentions, not a loss.

## Security

Server-side session checks on every page, action and route; workspace scoping in every service; Zod validation; React output encoding and http(s)-only rendering of links (`rel="noopener noreferrer nofollow"`); CSV cells escaped and protected against formula injection; bcrypt password hashing with timing equalisation; hashed session tokens; rate limits on sign-in, registration, run creation, exports and provider calls; secrets only in env; security headers. The app never fetches user-supplied URLs server-side; `isSafePublicHttpUrl` guards stored website URLs (blocks private IPs, localhost, credentials, non-http schemes) for any future fetching.

## Known limitations

- The live OpenAI integration is implemented against the documented Responses API and covered by parser and HTTP-mapping tests with a stubbed `fetch`, but has not been exercised against the real API in this environment (no key available).
- Mention, recommendation and sentiment detection are rule-based and English-oriented. They are deterministic and versioned, and labels can be corrected manually, but they will miss paraphrases and can misread sarcasm.
- Rate limiting is in-memory per process; use a shared store when running several web instances. On Vercel each function instance keeps its own counters, so limits are approximate.
- Dates are displayed and filtered in UTC.
- Teams: workspaces support multiple members in the schema, but there is no invite UI yet.
- Fonts load from Google Fonts at runtime; system fonts are used if blocked.
- `provider_configs` is in the schema for per-workspace provider settings, but V1 reads provider defaults from environment variables.
