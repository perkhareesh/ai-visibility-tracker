/**
 * Runs database migrations as part of `npm run build` on Vercel (or when
 * MIGRATE_ON_BUILD=true). Local builds skip it; use `npm run db:migrate`.
 */
import "dotenv/config";

if (process.env.VERCEL === "1" || process.env.MIGRATE_ON_BUILD === "true") {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Add it in Vercel > Project > Settings > Environment Variables.");
    process.exit(1);
  }
  await import("./migrate");
} else {
  console.log(JSON.stringify({ level: "info", msg: "skipping migrations on local build" }));
}
