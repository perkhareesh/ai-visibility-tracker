import Link from "next/link";
import { registerAction } from "@/app/actions";
import { Flash } from "@/components/ui";

export const metadata = { title: "Create workspace" };

export default async function Register({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <form action={registerAction} className="w-full max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">Create your workspace</h1>
      <Flash sp={sp} />
      <label className="label" htmlFor="name">Your name</label>
      <input className="field mb-4" id="name" name="name" autoComplete="name" required />
      <label className="label" htmlFor="workspaceName">Workspace name</label>
      <input className="field mb-4" id="workspaceName" name="workspaceName" placeholder="e.g. Agency name or client" required />
      <label className="label" htmlFor="email">Email</label>
      <input className="field mb-4" id="email" name="email" type="email" autoComplete="email" required />
      <label className="label" htmlFor="password">Password</label>
      <input className="field" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      <p className="hint mb-6">At least 10 characters.</p>
      <button className="btn-primary w-full">Create workspace</button>
      <p className="mt-5 text-sm text-slate">
        Already have an account? <Link className="link" href="/login">Sign in</Link>
      </p>
    </form>
  );
}
