import { saveBrandAction } from "@/app/actions";

export interface BrandFormValues {
  id?: string;
  name?: string;
  websiteUrl?: string | null;
  domains?: string[];
  aliases?: string[];
  products?: string[];
  industry?: string | null;
  targetCountries?: string[];
  targetRegions?: string[];
  languages?: string[];
  notes?: string | null;
  competitors?: Array<{ name: string; domains: string[]; aliases: string[] }>;
}

export function BrandForm({ v = {} }: { v?: BrandFormValues }) {
  const comps = (v.competitors ?? []).map((c) => [c.name, c.domains.join(", "), c.aliases.join(", ")].filter((x, i) => x || i === 0).join(" | ")).join("\n");
  return (
    <form action={saveBrandAction} className="panel max-w-3xl space-y-6 p-6">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Identity</legend>
        <div>
          <label className="label" htmlFor="name">Brand name</label>
          <input className="field" id="name" name="name" defaultValue={v.name} required maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor="websiteUrl">Official website</label>
          <input className="field" id="websiteUrl" name="websiteUrl" defaultValue={v.websiteUrl ?? ""} placeholder="https://www.example.com" />
          <p className="hint">Its domain becomes the primary official domain.</p>
        </div>
        <div>
          <label className="label" htmlFor="domains">Other official domains</label>
          <input className="field" id="domains" name="domains" defaultValue={v.domains?.join(", ")} placeholder="example.in, docs.example.com" />
          <p className="hint">Comma separated. Subdomains of any official domain also count as official.</p>
        </div>
        <div>
          <label className="label" htmlFor="aliases">Alternative names and spellings</label>
          <input className="field" id="aliases" name="aliases" defaultValue={v.aliases?.join(", ")} placeholder="Example Inc, Exmpl" />
        </div>
        <div>
          <label className="label" htmlFor="industry">Industry or category</label>
          <input className="field" id="industry" name="industry" defaultValue={v.industry ?? ""} placeholder="CRM software" />
        </div>
        <div>
          <label className="label" htmlFor="products">Products and services</label>
          <input className="field" id="products" name="products" defaultValue={v.products?.join(", ")} placeholder="Example Sales Hub, Example API" />
          <p className="hint">Use distinctive product names. Answers that mention only these are flagged as product references.</p>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-base font-semibold">Markets</legend>
        <div>
          <label className="label" htmlFor="targetCountries">Target countries</label>
          <input className="field uppercase" id="targetCountries" name="targetCountries" defaultValue={v.targetCountries?.join(", ")} placeholder="IN, US" />
          <p className="hint">2-letter ISO codes.</p>
        </div>
        <div>
          <label className="label" htmlFor="targetRegions">Regions or states</label>
          <input className="field" id="targetRegions" name="targetRegions" defaultValue={v.targetRegions?.join(", ")} placeholder="Karnataka, Maharashtra" />
        </div>
        <div>
          <label className="label" htmlFor="languages">Languages</label>
          <input className="field" id="languages" name="languages" defaultValue={v.languages?.join(", ") ?? "en"} placeholder="en, hi" />
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-base font-semibold">Competitors</legend>
        <label className="label" htmlFor="competitors">One per line: name | domains | aliases</label>
        <textarea className="field font-mono text-[13px]" id="competitors" name="competitors" rows={5} defaultValue={comps} placeholder={"HubSpot | hubspot.com\nZoho CRM | zoho.com, zoho.in | Zoho"} />
        <p className="hint">Competitor domains let citations be classified as competitor sources.</p>
      </fieldset>

      <div>
        <label className="label" htmlFor="notes">Notes</label>
        <textarea className="field" id="notes" name="notes" rows={2} defaultValue={v.notes ?? ""} />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary">{v.id ? "Save brand" : "Create brand"}</button>
      </div>
    </form>
  );
}
