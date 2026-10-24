export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-6 h-8 w-64 rounded bg-sunken" />
      <div className="grid gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-lg bg-sunken" />)}
      </div>
      <div className="mt-6 h-64 rounded-lg bg-sunken" />
    </div>
  );
}
