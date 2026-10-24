import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __aivtPool?: Pool; __aivtDb?: DB };

export function getPool(): Pool {
  if (!globalForDb.__aivtPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__aivtPool = new Pool({ connectionString: url, max: 10 });
  }
  return globalForDb.__aivtPool;
}

export function getDb(): DB {
  if (!globalForDb.__aivtDb) globalForDb.__aivtDb = drizzle(getPool(), { schema });
  return globalForDb.__aivtDb;
}

/** Test helper: point the singleton at another database. */
export async function resetDbForTests(url: string) {
  if (globalForDb.__aivtPool) await globalForDb.__aivtPool.end();
  globalForDb.__aivtPool = new Pool({ connectionString: url, max: 5 });
  globalForDb.__aivtDb = drizzle(globalForDb.__aivtPool, { schema });
  return globalForDb.__aivtDb;
}

export { schema };
