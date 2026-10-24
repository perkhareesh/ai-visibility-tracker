import { getDb } from "@/db";
import { auditEvents } from "@/db/schema";
import { log } from "@/lib/log";

export async function audit(e: {
  workspaceId: string | null;
  userId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    await getDb().insert(auditEvents).values({
      workspaceId: e.workspaceId,
      userId: e.userId,
      action: e.action,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      meta: e.meta ?? {},
    });
  } catch (err) {
    log("warn", "audit write failed", { action: e.action, error: String(err) });
  }
}
