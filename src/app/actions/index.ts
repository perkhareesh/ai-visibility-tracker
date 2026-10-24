"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { memberships, workspaces } from "@/db/schema";
import { rateLimit } from "@/lib/ratelimit";
import { AuthError, createSession, destroySession, registerUser, switchWorkspace, verifyCredentials } from "@/server/auth-core";
import { audit } from "@/server/audit";
import { seedDemoWorkspace } from "@/server/demo-seed";
import { requireCtx, getSessionToken, setSessionCookie } from "@/server/session";
import { createBrand, deleteBrand, setBrandArchived, updateBrand } from "@/server/services/brands";
import { bulkCreateQueries, createQuery, deleteQuery, setQueryStatus, updateQuery } from "@/server/services/queries";
import { addOverride } from "@/server/services/reporting";
import { cancelRun, retryFailed, startRun, upsertSchedule } from "@/server/services/runs";
import { credentialsSchema, registerSchema } from "@/server/validation";
import { errorMessage, safeBack, str, withParam } from "./util";

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

// ---------- Auth ----------

export async function loginAction(fd: FormData) {
  let err: string | null = null;
  const ip = await clientKey();
  try {
    const { email, password } = credentialsSchema.parse({ email: str(fd, "email"), password: str(fd, "password") });
    const rl = rateLimit(`login:${ip}:${email}`, 8, 15 * 60_000);
    if (!rl.ok) throw new Error("Too many sign-in attempts. Wait a few minutes and try again.");
    const user = await verifyCredentials(email, password);
    if (!user) throw new Error("Email or password is incorrect.");
    const { token } = await createSession(user.id);
    await setSessionCookie(token);
  } catch (e) {
    err = e instanceof AuthError || e instanceof Error ? errorMessage(e) : "Sign-in failed";
    if (err.startsWith("password:")) err = "Email or password is incorrect.";
  }
  if (err) redirect(withParam("/login", "error", err));
  redirect("/dashboard");
}

export async function registerAction(fd: FormData) {
  let err: string | null = null;
  try {
    const rl = rateLimit(`register:${await clientKey()}`, 5, 60 * 60_000);
    if (!rl.ok) throw new Error("Too many accounts created from this network. Try again later.");
    const data = registerSchema.parse({ email: str(fd, "email"), password: str(fd, "password"), name: str(fd, "name"), workspaceName: str(fd, "workspaceName") });
    const { user, workspace } = await registerUser(data);
    await audit({ workspaceId: workspace.id, userId: user.id, action: "auth.register" });
    const { token } = await createSession(user.id, workspace.id);
    await setSessionCookie(token);
  } catch (e) {
    err = errorMessage(e);
  }
  if (err) redirect(withParam("/register", "error", err));
  redirect("/dashboard?notice=" + encodeURIComponent("Workspace created. Add your first brand to start tracking."));
}

export async function logoutAction() {
  const token = await getSessionToken();
  if (token) await destroySession(token);
  const { cookies } = await import("next/headers");
  (await cookies()).delete("aivt_session");
  redirect("/login");
}

export async function switchWorkspaceAction(fd: FormData) {
  const ctx = await requireCtx();
  const token = await getSessionToken();
  let err: string | null = null;
  try {
    await switchWorkspace(token!, ctx.userId, str(fd, "workspaceId"));
  } catch (e) {
    err = errorMessage(e);
  }
  if (err) redirect(withParam("/settings", "error", err));
  redirect("/dashboard");
}

export async function createDemoWorkspaceAction() {
  const ctx = await requireCtx();
  const token = await getSessionToken();
  let err: string | null = null;
  try {
    const db = getDb();
    const [ws] = await db.insert(workspaces).values({ name: "Demo workspace (simulated data)", isDemo: true }).returning();
    await db.insert(memberships).values({ userId: ctx.userId, workspaceId: ws.id, role: "owner" });
    await seedDemoWorkspace(ws.id, ctx.userId);
    await switchWorkspace(token!, ctx.userId, ws.id);
    await audit({ workspaceId: ws.id, userId: ctx.userId, action: "demo.create" });
  } catch (e) {
    err = errorMessage(e);
  }
  if (err) redirect(withParam("/settings", "error", err));
  redirect("/dashboard?notice=" + encodeURIComponent("Demo workspace ready. Everything here is simulated."));
}

// ---------- Brands ----------

function brandFromForm(fd: FormData) {
  const competitors = str(fd, "competitors")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, domains = "", aliases = ""] = line.split("|").map((s) => s.trim());
      return { name, domains, aliases };
    });
  return {
    name: str(fd, "name"),
    websiteUrl: str(fd, "websiteUrl"),
    domains: str(fd, "domains"),
    aliases: str(fd, "aliases"),
    products: str(fd, "products"),
    industry: str(fd, "industry"),
    targetCountries: str(fd, "targetCountries"),
    targetRegions: str(fd, "targetRegions"),
    languages: str(fd, "languages"),
    notes: str(fd, "notes"),
    competitors,
  };
}

export async function saveBrandAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = str(fd, "id");
  let err: string | null = null;
  let brandId = id;
  try {
    if (id) await updateBrand(ctx, id, brandFromForm(fd));
    else brandId = (await createBrand(ctx, brandFromForm(fd))).id;
  } catch (e) {
    err = errorMessage(e);
  }
  if (err) redirect(withParam(id ? `/brands/${id}/edit` : "/brands/new", "error", err));
  revalidatePath("/brands");
  redirect(`/brands/${brandId}?notice=${encodeURIComponent(id ? "Brand saved." : "Brand created. Add tracking queries next.")}`);
}

export async function archiveBrandAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = str(fd, "id");
  const archived = str(fd, "archived") === "true";
  let err: string | null = null;
  try {
    await setBrandArchived(ctx, id, archived);
  } catch (e) {
    err = errorMessage(e);
  }
  redirect(withParam(`/brands/${id}`, err ? "error" : "notice", err ?? (archived ? "Brand archived. History is kept." : "Brand restored.")));
}

export async function deleteBrandAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = str(fd, "id");
  let err: string | null = null;
  try {
    if (str(fd, "confirm").trim() !== str(fd, "expected").trim()) throw new Error("Type the brand name exactly to confirm deletion.");
    await deleteBrand(ctx, id);
  } catch (e) {
    err = errorMessage(e);
  }
  if (err) redirect(withParam(`/brands/${id}/edit`, "error", err));
  redirect("/brands?notice=" + encodeURIComponent("Brand and its tracking history were deleted."));
}

// ---------- Queries ----------

function queryFromForm(fd: FormData) {
  return {
    brandId: str(fd, "brandId"),
    text: str(fd, "text"),
    topic: str(fd, "topic"),
    intent: (str(fd, "intent") || "commercial") as "commercial",
    country: str(fd, "country"),
    region: str(fd, "region"),
    city: str(fd, "city"),
    language: str(fd, "language") || "en",
    frequency: (str(fd, "frequency") || "manual") as "manual",
    status: (str(fd, "status") || "active") as "active",
  };
}

export async function createQueryAction(fd: FormData) {
  const ctx = await requireCtx();
  const back = safeBack(str(fd, "back"), "/queries");
  let err: string | null = null;
  let notice = "";
  try {
    if (str(fd, "mode") === "bulk") {
      const { text: _t, ...rest } = queryFromForm(fd);
      void _t;
      const r = await bulkCreateQueries(ctx, { ...rest, lines: str(fd, "lines") });
      notice = `${r.created} queries added${r.skipped ? `, ${r.skipped} duplicates skipped` : ""}.`;
    } else {
      await createQuery(ctx, queryFromForm(fd));
      notice = "Query added.";
    }
  } catch (e) {
    err = errorMessage(e);
  }
  revalidatePath("/queries");
  redirect(withParam(back, err ? "error" : "notice", err ?? notice));
}

export async function updateQueryAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = str(fd, "id");
  let err: string | null = null;
  try {
    await updateQuery(ctx, id, queryFromForm(fd));
  } catch (e) {
    err = errorMessage(e);
  }
  redirect(withParam(err ? `/queries/${id}` : "/queries", err ? "error" : "notice", err ?? "Query saved."));
}

export async function queryStatusAction(fd: FormData) {
  const ctx = await requireCtx();
  const back = safeBack(str(fd, "back"), "/queries");
  let err: string | null = null;
  try {
    if (str(fd, "op") === "delete") await deleteQuery(ctx, str(fd, "id"));
    else await setQueryStatus(ctx, str(fd, "id"), str(fd, "status") === "paused" ? "paused" : "active");
  } catch (e) {
    err = errorMessage(e);
  }
  revalidatePath("/queries");
  redirect(withParam(back, err ? "error" : "notice", err ?? "Query updated."));
}

// ---------- Runs ----------

export async function startRunAction(fd: FormData) {
  const ctx = await requireCtx();
  let err: string | null = null;
  let runId = "";
  try {
    const queryIds = fd.getAll("queryIds").filter((v): v is string => typeof v === "string" && !!v);
    const r = await startRun(ctx, {
      brandId: str(fd, "brandId"),
      provider: str(fd, "provider"),
      model: str(fd, "model"),
      queryIds: queryIds.length ? queryIds : undefined,
      idempotencyKey: str(fd, "idempotencyKey") || randomUUID(),
      label: str(fd, "label"),
    });
    runId = r.run.id;
  } catch (e) {
    err = errorMessage(e);
  }
  if (err) redirect(withParam(safeBack(str(fd, "back"), "/runs/new"), "error", err));
  redirect(`/runs/${runId}`);
}

export async function retryRunAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = str(fd, "id");
  let err: string | null = null;
  let newId = "";
  try {
    newId = (await retryFailed(ctx, id, str(fd, "idempotencyKey") || randomUUID())).run.id;
  } catch (e) {
    err = errorMessage(e);
  }
  if (err) redirect(withParam(`/runs/${id}`, "error", err));
  redirect(`/runs/${newId}?notice=${encodeURIComponent("Retry run queued for the failed queries.")}`);
}

export async function cancelRunAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = str(fd, "id");
  let err: string | null = null;
  try {
    await cancelRun(ctx, id);
  } catch (e) {
    err = errorMessage(e);
  }
  redirect(withParam(`/runs/${id}`, err ? "error" : "notice", err ?? "Run cancelled."));
}

export async function scheduleAction(fd: FormData) {
  const ctx = await requireCtx();
  const brandId = str(fd, "brandId");
  let err: string | null = null;
  try {
    await upsertSchedule(ctx, {
      brandId,
      frequency: str(fd, "frequency") as "weekly",
      provider: str(fd, "provider"),
      model: str(fd, "model"),
      enabled: str(fd, "enabled") !== "false",
    });
  } catch (e) {
    err = errorMessage(e);
  }
  redirect(withParam(`/brands/${brandId}`, err ? "error" : "notice", err ?? "Schedule saved."));
}

export async function overrideAction(fd: FormData) {
  const ctx = await requireCtx();
  const snapshotId = str(fd, "snapshotId");
  let err: string | null = null;
  try {
    await addOverride(ctx, { snapshotId, field: str(fd, "field"), value: str(fd, "value"), note: str(fd, "note") });
  } catch (e) {
    err = errorMessage(e);
  }
  redirect(withParam(`/snapshots/${snapshotId}`, err ? "error" : "notice", err ?? "Label corrected. Metrics now use your label."));
}
