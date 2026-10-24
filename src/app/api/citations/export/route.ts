import { NextResponse, type NextRequest } from "next/server";
import { parseFilters } from "@/components/filters";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/ratelimit";
import { resolveSession } from "@/server/auth-core";
import { exportCitationsCsv } from "@/server/services/reporting";
import { SESSION_COOKIE } from "@/server/session";

export async function GET(req: NextRequest) {
  const ctx = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!rateLimit(`export:${ctx.workspaceId}`, 20, 60_000).ok) return NextResponse.json({ error: "Too many exports, try again shortly" }, { status: 429 });
  try {
    const { report } = parseFilters(Object.fromEntries(req.nextUrl.searchParams));
    const csv = await exportCitationsCsv(ctx, report);
    const name = `citations-${ctx.isDemo ? "SIMULATED-" : ""}${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse("﻿" + csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
    });
  } catch (e) {
    log("error", "citation export failed", { error: String(e) });
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
