import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, getPool } from "../src/db";
import { memberships, workspaces } from "../src/db/schema";
import { registerUser, verifyCredentials } from "../src/server/auth-core";
import { seedDemoWorkspace } from "../src/server/demo-seed";

const email = process.env.DEMO_EMAIL ?? "demo@aivt.local";
const password = process.env.DEMO_PASSWORD ?? "demo-password-123";

const db = getDb();
let user = await verifyCredentials(email, password);
if (!user) user = (await registerUser({ email, password, name: "Demo User", workspaceName: "My workspace" })).user;
const existing = await db.execute(sql`select w.id from workspaces w join memberships m on m.workspace_id = w.id where m.user_id = ${user.id} and w.is_demo`);
if (existing.rows.length) {
  console.log(JSON.stringify({ level: "info", msg: "demo workspace already exists", email }));
} else {
  const [ws] = await db.insert(workspaces).values({ name: "Demo workspace (simulated data)", isDemo: true }).returning();
  await db.insert(memberships).values({ userId: user.id, workspaceId: ws.id, role: "owner" });
  await seedDemoWorkspace(ws.id, user.id);
  console.log(JSON.stringify({ level: "info", msg: "demo workspace seeded", email, password }));
}
await getPool().end();
