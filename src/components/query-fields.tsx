import { frequencyValues, intentValues } from "@/server/validation";

export function QueryFields({ brands, v = {}, geoNote }: {
  brands: Array<{ id: string; name: string }>;
  v?: { brandId?: string; topic?: string | null; intent?: string; country?: string | null; region?: string | null; city?: string | null; language?: string; frequency?: string; status?: string };
  geoNote: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <label className="label" htmlFor="brandId">Brand</label>
        <select className="field" id="brandId" name="brandId" defaultValue={v.brandId} required>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="topic">Topic</label>
        <input className="field" id="topic" name="topic" defaultValue={v.topic ?? ""} placeholder="CRM, pricing" />
      </div>
      <div>
        <label className="label" htmlFor="intent">Search intent</label>
        <select className="field" id="intent" name="intent" defaultValue={v.intent ?? "commercial"}>
          {intentValues.map((i) => <option key={i} value={i}>{i[0].toUpperCase() + i.slice(1)}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="country">Country</label>
        <input className="field uppercase" id="country" name="country" defaultValue={v.country ?? ""} placeholder="IN" maxLength={2} />
      </div>
      <div>
        <label className="label" htmlFor="region">Region or state</label>
        <input className="field" id="region" name="region" defaultValue={v.region ?? ""} placeholder="Karnataka" />
      </div>
      <div>
        <label className="label" htmlFor="city">City</label>
        <input className="field" id="city" name="city" defaultValue={v.city ?? ""} placeholder="Bengaluru" />
      </div>
      <p className="hint -mt-1 sm:col-span-3">{geoNote}</p>
      <div>
        <label className="label" htmlFor="language">Language</label>
        <input className="field" id="language" name="language" defaultValue={v.language ?? "en"} placeholder="en" />
      </div>
      <div>
        <label className="label" htmlFor="frequency">Tracking frequency</label>
        <select className="field" id="frequency" name="frequency" defaultValue={v.frequency ?? "manual"}>
          {frequencyValues.map((f) => <option key={f} value={f}>{f === "manual" ? "Manual only" : f[0].toUpperCase() + f.slice(1)}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="status">Status</label>
        <select className="field" id="status" name="status" defaultValue={v.status ?? "active"}>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
      </div>
    </div>
  );
}

export function geoNoteFor(isDemo: boolean) {
  return isDemo
    ? "Demo provider: location fields are stored as labels only and do not change the simulated answers."
    : "OpenAI: country, region and city are sent as an approximate location hint. The API does not confirm which location it used, so results are never marked as verified local.";
}
