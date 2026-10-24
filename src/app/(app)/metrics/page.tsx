import { PageHeader } from "@/components/ui";
import { METRIC_DEFINITIONS } from "@/lib/metrics";

export const metadata = { title: "Metric definitions" };

export default function Metrics() {
  return (
    <>
      <PageHeader title="Metric definitions" description="How every number in the app is counted. Click any metric tile to see the executions behind it." />
      <div className="max-w-3xl space-y-4">
        {METRIC_DEFINITIONS.map((d) => (
          <section key={d.key} id={d.key} className="panel p-5">
            <h2 className="font-semibold">{d.name}</h2>
            <p className="mt-2 rounded bg-sunken px-3 py-2 text-sm">{d.formula}</p>
            <p className="mt-2 text-sm text-slate">{d.notes}</p>
          </section>
        ))}
        <section className="panel p-5 text-sm text-slate">
          <h2 className="font-semibold text-ink">Rules that apply everywhere</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Failed executions, and executions whose analysis did not complete, are excluded from denominators and shown separately. Missing data is never treated as zero visibility.</li>
            <li>A rate with no eligible executions shows “No data”, not 0%.</li>
            <li>Repeated citations are counted as occurrences. Unique URLs and unique domains are reported separately. URLs are grouped after removing tracking parameters, fragments, “www.” and trailing slashes; the original URL is always kept.</li>
            <li>Queries edited after a run keep their original text in older snapshots. Comparisons are by query ID; use the shared-queries view for like-for-like.</li>
            <li>Manual sentiment and recommendation corrections replace the analyzer’s label in metrics; the original analysis stays stored.</li>
            <li>Simulated (demo) data lives only in demo workspaces and is never mixed with live results.</li>
          </ul>
        </section>
      </div>
    </>
  );
}
