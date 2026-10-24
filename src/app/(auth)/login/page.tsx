import Link from "next/link";
import { loginAction } from "@/app/actions";
import { Flash } from "@/components/ui";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const sp = await searchParams;
  return (
    <form action={loginAction} className="w-full max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">Sign in</h1>
      <Flash sp={sp} />
      <label className="label" htmlFor="email">Email</label>
      <input className="field mb-4" id="email" name="email" type="email" autoComplete="email" required />
      <label className="label" htmlFor="password">Password</label>
      <input className="field mb-6" id="password" name="password" type="password" autoComplete="current-password" required />
      <button className="btn-primary w-full">Sign in</button>
      <p className="mt-5 text-sm text-slate">
        No account? <Link className="link" href="/register">Create a workspace</Link>
      </p>
    </form>
  );
}
