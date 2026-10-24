"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Polls the server-rendered page while a run is in progress. */
export function AutoRefresh({ active, ms = 3000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return active ? <span className="text-xs text-slate" aria-live="polite">Updating automatically…</span> : null;
}
