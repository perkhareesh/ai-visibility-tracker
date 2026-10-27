import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { resolveSession, SESSION_TTL_MS, type AuthContext } from "./auth-core";

export const SESSION_COOKIE = "aivt_session";

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true" || process.env.VERCEL === "1",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function getSessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export const getCtx = cache(async (): Promise<AuthContext | null> => resolveSession(await getSessionToken()));

/** Server-side authorization gate for every app page and action. */
export async function requireCtx(): Promise<AuthContext> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}
