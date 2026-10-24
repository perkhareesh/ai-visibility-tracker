import Link from "next/link";

export interface FilterValues {
  brandId?: string;
  country?: string;
  region?: string;
  queryId?: string;
  from?: string;
  to?: string;
  domain?: string;
  type?: string;
}

export function FilterBar({
  values,
  brands,
  queries,
  show = ["brand", "country", "date"],
  extra,
}: {
  values: FilterValues;
  brands: Array<{ id: string; name: string }>;
  queries?: Array<{ id: string; text: string }>;
  show?: Array<"brand" | "country" | "region" | "query" | "date" | "domain" | "type">;
  extra?: React.ReactNode;
}) {
  const has = (k: (typeof show)[number]) => show.includes(k);
  return (
    <form method="get" className="panel mb-6 flex flex-wrap items-end gap-3 p-3">
      {has("brand") && (
        <div className="min-w-40">
          <label className="label text-xs" htmlFor="f-brand">Brand</label>
          <select id="f-brand" name="brandId" defaultValue={values.brandId ?? ""} className="field">
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      {has("query") && queries && (
        <div className="min-w-56 max-w-80">
          <label className="label text-xs" htmlFor="f-query">Query</label>
          <select id="f-query" name="queryId" defaultValue={values.queryId ?? ""} className="field">
            <option value="">All queries</option>
            {queries.map((q) => <option key={q.id} value={q.id}>{q.text}</option>)}
          </select>
        </div>
      )}
      {has("country") && (
        <div className="w-24">
          <label className="label text-xs" htmlFor="f-country">Country</label>
          <input id="f-country" name="country" defaultValue={values.country ?? ""} placeholder="IN" maxLength={2} className="field uppercase" />
        </div>
      )}
      {has("region") && (
        <div className="w-32">
          <label className="label text-xs" htmlFor="f-region">Region</label>
          <input id="f-region" name="region" defaultValue={values.region ?? ""} placeholder="Karnataka" className="field" />
        </div>
      )}
      {has("domain") && (
        <div className="w-40">
          <label className="label text-xs" htmlFor="f-domain">Domain contains</label>
          <input id="f-domain" name="domain" defaultValue={values.domain ?? ""} placeholder="g2.com" className="field" />
        </div>
      )}
      {has("type") && (
        <div className="w-44">
          <label className="label text-xs" htmlFor="f-type">Citation type</label>
          <select id="f-type" name="type" defaultValue={values.type ?? ""} className="field">
            <option value="">All types</option>
            <option value="official">Official domain</option>
            <option value="third_party_mention">Third-party mention</option>
            <option value="competitor">Competitor domain</option>
            <option value="other">Other source</option>
          </select>
        </div>
      )}
      {has("date") && (
        <>
          <div>
            <label className="label text-xs" htmlFor="f-from">From</label>
            <input id="f-from" type="date" name="from" defaultValue={values.from ?? ""} className="field" />
          </div>
          <div>
            <label className="label text-xs" htmlFor="f-to">To</label>
            <input id="f-to" type="date" name="to" defaultValue={values.to ?? ""} className="field" />
          </div>
        </>
      )}
      {extra}
      <button className="btn-primary">Apply</button>
      <Link href="?" className="btn-ghost">Reset</Link>
    </form>
  );
}

export function parseFilters(sp: Record<string, string | string[] | undefined>) {
  const s = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const date = (v?: string, end = false) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    const d = new Date(`${v}T${end ? "23:59:59.999" : "00:00:00"}Z`);
    return isNaN(d.getTime()) ? undefined : d;
  };
  const values: FilterValues = {
    brandId: uuid(s("brandId")),
    queryId: uuid(s("queryId")),
    country: s("country")?.toUpperCase().slice(0, 2),
    region: s("region")?.slice(0, 120),
    from: s("from"),
    to: s("to"),
    domain: s("domain")?.slice(0, 253),
    type: ["official", "third_party_mention", "competitor", "other"].includes(s("type") ?? "") ? s("type") : undefined,
  };
  const page = Math.max(1, Number(s("page")) || 1);
  return {
    values,
    page,
    report: {
      brandId: values.brandId,
      queryId: values.queryId,
      country: values.country,
      region: values.region,
      from: date(values.from),
      to: date(values.to, true),
      domain: values.domain,
      type: values.type,
    },
  };
}
