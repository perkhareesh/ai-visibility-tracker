import { redirect } from "next/navigation";
import { getCtx } from "@/server/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCtx()) redirect("/dashboard");
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <div className="text-sm font-semibold">AI Visibility Tracker</div>
        <div className="max-w-md">
          <p className="font-serif text-[2rem] leading-snug">
            See which AI answers name <span className="border-b-2 border-[#8d9bff] text-[#c9cfff]">your brand</span>, which cite your own site, and which only mention you through someone else’s page.
          </p>
          <p className="mt-6 text-sm text-white/60">
            Every answer is stored as evidence: the exact prompt, the full response, each citation, and how each number was counted.
          </p>
        </div>
        <p className="text-xs text-white/40">ChatGPT-family tracking via the official OpenAI API.</p>
      </div>
      <div className="flex items-center justify-center p-6">{children}</div>
    </main>
  );
}
