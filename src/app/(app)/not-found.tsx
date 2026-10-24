import Link from "next/link";
export default function NotFound() {
  return (
    <div className="panel mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold">Not found in this workspace</h1>
      <p className="mt-2 text-sm text-slate">It may belong to another workspace or have been deleted. Check the workspace you are in under Settings.</p>
      <Link href="/dashboard" className="btn-secondary mt-5">Go to overview</Link>
    </div>
  );
}
