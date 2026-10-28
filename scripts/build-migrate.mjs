/**
 * Runs database migrations during `npm run build` on Vercel (or when
 * MIGRATE_ON_BUILD=true). Plain Node ESM on purpose: no TypeScript runner,
 * so the build does not depend on esbuild install scripts.
 * Local builds skip this; use `npm run db:migrate`.
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  try {
    (await import("dotenv")).config();
  } catch {}
}

if (process.env.VERCEL !== "1" && process.env.MIGRATE_ON_BUILD !== "true") {
  console.log("[migrate] skipped on local build (run `npm run db:migrate`)");
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "[migrate] DATABASE_URL is not set. In Vercel: Storage > connect a Postgres (Neon) database to this project, then redeploy.",
  );
  process.exit(1);
}

const { default: pg } = await import("pg");
const { drizzle } = await import("drizzle-orm/node-postgres");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");

const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 20_000 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("[migrate] database is up to date");
} catch (e) {
  console.error("[migrate] failed:", e?.cause?.message ?? e?.message ?? e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
