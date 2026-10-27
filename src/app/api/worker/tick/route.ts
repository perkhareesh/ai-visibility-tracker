import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/log";
import { drainFor } from "@/server/worker";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Worker endpoint for serverless hosts. Vercel Cron calls it with
 * "Authorization: Bearer $CRON_SECRET". It enqueues due schedules and
 * processes queued jobs for up to ~4 minutes.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const processed = await drainFor(240_000);
    return NextResponse.json({ ok: true, processed });
  } catch (e) {
    log("error", "worker tick endpoint failed", { error: String(e) });
    return NextResponse.json({ error: "Worker failed" }, { status: 500 });
  }
}
