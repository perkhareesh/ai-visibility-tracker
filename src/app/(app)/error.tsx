"use client";
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const notFound = /not found/i.test(error.message);
  return (
    <div className="panel mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold">{notFound ? "Not found in this workspace" : "This page could not load"}</h1>
      <p className="mt-2 text-sm text-slate">
        {notFound ? "It may belong to another workspace or have been deleted." : "The server returned an error. Try again; if it keeps happening, check the server logs"}
        {error.digest && !notFound ? ` (reference ${error.digest}).` : ""}
      </p>
      <button onClick={reset} className="btn-secondary mt-5">Try again</button>
    </div>
  );
}
