import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { memberships, sessions, users, workspaces } from "@/db/schema";
import { audit } from "./audit";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export interface AuthContext {
  userId: string;
  userName: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  isDemo: boolean;
  role: "owner" | "admin" | "member";
  sessionId: string;
}

export class AuthError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthError";
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function registerUser(input: { email: string; password: string; name: string; workspaceName: string }) {
  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email.toLowerCase()}`);
  if (existing.length) throw new AuthError("An account with this email already exists");
  const passwordHash = await bcrypt.hash(input.password, 12);
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email: input.email.toLowerCase(), name: input.name, passwordHash }).returning();
    const [ws] = await tx.insert(workspaces).values({ name: input.workspaceName }).returning();
    await tx.insert(memberships).values({ userId: user.id, workspaceId: ws.id, role: "owner" });
    return { user, workspace: ws };
  });
}

let dummyHash: string | undefined;

/** Constant-time-ish credential check (always runs bcrypt). */
export async function verifyCredentials(email: string, password: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  dummyHash ??= await bcrypt.hash("timing-equaliser", 12);
  const ok = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);
  return ok && user ? user : null;
}

export async function createSession(userId: string, workspaceId?: string) {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  let wsId = workspaceId;
  if (!wsId) {
    const [m] = await db
      .select({ workspaceId: memberships.workspaceId })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, userId))
      .orderBy(workspaces.isDemo, memberships.createdAt)
      .limit(1);
    wsId = m?.workspaceId;
  }
  const [s] = await db
    .insert(sessions)
    .values({ tokenHash: sha256(token), userId, activeWorkspaceId: wsId ?? null, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
    .returning();
  await audit({ userId, workspaceId: wsId ?? null, action: "auth.login", entityType: "session", entityId: s.id });
  return { token, session: s };
}

/** Resolve a session token into an authorization context. Membership is re-checked on every call. */
export async function resolveSession(token: string | undefined | null): Promise<AuthContext | null> {
  if (!token) return null;
  const db = getDb();
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      userName: users.name,
      email: users.email,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      isDemo: workspaces.isDemo,
      role: memberships.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(memberships, and(eq(memberships.userId, sessions.userId), eq(memberships.workspaceId, sessions.activeWorkspaceId)))
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
  return rows[0] ?? null;
}

export async function switchWorkspace(token: string, userId: string, workspaceId: string) {
  const db = getDb();
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
  if (!m) throw new AuthError("You are not a member of that workspace");
  await db.update(sessions).set({ activeWorkspaceId: workspaceId }).where(eq(sessions.tokenHash, sha256(token)));
}

export async function destroySession(token: string) {
  await getDb().delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function listUserWorkspaces(userId: string) {
  return getDb()
    .select({ id: workspaces.id, name: workspaces.name, isDemo: workspaces.isDemo, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(workspaces.isDemo, workspaces.createdAt);
}

export function requireRole(ctx: AuthContext, roles: AuthContext["role"][]) {
  if (!roles.includes(ctx.role)) throw new AuthError("Your role does not allow this action");
}
