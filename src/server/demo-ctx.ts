import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { memberships, users, workspaces } from "@/db/schema";
import type { AuthContext } from "./auth-core";

/** Build an authorization context for a known member (used by seeding scripts). */
export async function resolveDemoCtx(workspaceId: string, userId: string): Promise<AuthContext> {
  const [row] = await getDb()
    .select({ u: users, w: workspaces, m: memberships })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
  if (!row) throw new Error("Not a member of this workspace");
  return {
    userId, userName: row.u.name, email: row.u.email, workspaceId, workspaceName: row.w.name,
    isDemo: row.w.isDemo, role: row.m.role, sessionId: "seed",
  };
}
