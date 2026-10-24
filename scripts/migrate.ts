import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "../src/db";

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

await migrate(getDb(), { migrationsFolder: "./drizzle" });
console.log(JSON.stringify({ level: "info", msg: "migrations applied" }));
await getPool().end();
