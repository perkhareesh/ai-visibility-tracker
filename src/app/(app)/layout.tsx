import Link from "next/link";
import { logoutAction } from "@/app/actions";
import { Nav } from "@/components/nav";
import { requireCtx } from "@/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[232px_1fr] lg:bg-[linear-gradient(to_right,#fff_231px,#dde1e7_231px,#dde1e7_232px,transparent_232px)]">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-4 lg:block">
          <Link href="/dashboard" className="block text-[0.95rem] font-semibold">AI Visibility Tracker</Link>
          <Link href="/settings" className="mt-0 block text-xs text-slate hover:text-ink lg:mt-1" title="Switch workspace">
            {ctx.workspaceName}
          </Link>
        </div>
        <Nav />
        <div className="hidden px-5 py-4 text-xs text-slate lg:absolute lg:bottom-0 lg:block">
          <div className="truncate">{ctx.email}</div>
          <form action={logoutAction}>
            <button className="mt-1 text-slate underline-offset-2 hover:text-ink hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        {ctx.isDemo && (
          <div className="border-b border-sim/20 bg-sim-soft px-6 py-2 text-sm text-sim">
            <strong className="font-semibold">Demo workspace.</strong> Every answer, citation and metric here is simulated by a deterministic demo provider and is not real ChatGPT data.{" "}
            <Link href="/settings" className="underline">Switch workspace</Link>
          </div>
        )}
        <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
