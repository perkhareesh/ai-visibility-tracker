import { createDemoWorkspaceAction, logoutAction, switchWorkspaceAction } from "@/app/actions";
import { Flash, PageHeader, Pill, Section } from "@/components/ui";
import { getProvider } from "@/lib/providers";
import { listUserWorkspaces } from "@/server/auth-core";
import { requireCtx } from "@/server/session";

export const metadata = { title: "Settings" };

const GEO_TEXT = { sent_as_hint: "Sent as approximate hint", label_only: "Label only (not sent)" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const workspaces = await listUserWorkspaces(ctx.userId);
  const hasDemo = workspaces.some((w) => w.isDemo);
  const providers = ["openai", "demo"].map((id) => getProvider(id)!);

  return (
    <>
      <PageHeader title="Settings" description={`Signed in as ${ctx.email}, ${ctx.role} of ${ctx.workspaceName}.`} actions={<form action={logoutAction}><button className="btn-secondary">Sign out</button></form>} />
      <Flash sp={sp} />

      <Section title="Workspaces" description="Data never crosses workspaces. Demo workspaces hold simulated data only.">
        <div className="panel divide-y divide-line">
          {workspaces.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <span className="font-medium">{w.name}</span> <span className="text-slate">({w.role})</span>{" "}
                {w.isDemo ? <Pill tone="sim">Simulated</Pill> : <Pill tone="brand">Live</Pill>}
              </div>
              {w.id === ctx.workspaceId ? (
                <span className="text-xs text-slate">Current</span>
              ) : (
                <form action={switchWorkspaceAction}><input type="hidden" name="workspaceId" value={w.id} /><button className="btn-secondary">Switch</button></form>
              )}
            </div>
          ))}
        </div>
        {!hasDemo && (
          <form action={createDemoWorkspaceAction} className="mt-3">
            <button className="btn-secondary">Create a demo workspace</button>
            <span className="ml-3 text-xs text-slate">Adds a separate workspace with a fictional brand and three simulated runs.</span>
          </form>
        )}
      </Section>

      <Section title="Providers" description="API keys live in server environment variables only. They are never stored in the database or sent to the browser.">
        <div className="panel overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Provider</th><th>Status</th><th>Default model</th><th>Citations</th><th>Country</th><th>Region</th><th>City</th><th>Reports location used</th></tr></thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td className="max-w-xs"><div className="font-medium">{p.label}</div><div className="text-xs text-slate">{p.description}</div></td>
                  <td>{p.isConfigured() ? <Pill tone="ok">{p.dataOrigin === "simulated" ? "Demo only" : "Configured"}</Pill> : <Pill tone="fail">Not configured</Pill>}</td>
                  <td><code className="text-xs">{p.defaultModel()}</code></td>
                  <td>{p.capabilities.citations ? "Structured URL citations" : "Unavailable"}</td>
                  <td className="text-slate">{GEO_TEXT[p.capabilities.geo.country]}</td>
                  <td className="text-slate">{GEO_TEXT[p.capabilities.geo.region]}</td>
                  <td className="text-slate">{GEO_TEXT[p.capabilities.geo.city]}</td>
                  <td>{p.capabilities.reportsLocation ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!getProvider("openai")!.isConfigured() && (
          <div className="panel mt-4 p-5 text-sm">
            <h3 className="font-semibold">Enable live ChatGPT-family tracking</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate">
              <li>Create an API key at platform.openai.com with access to the Responses API and the web search tool.</li>
              <li>Add it to the server environment: <code className="rounded bg-sunken px-1">OPENAI_API_KEY=sk-...</code> (optional: <code className="rounded bg-sunken px-1">OPENAI_MODEL</code>, <code className="rounded bg-sunken px-1">OPENAI_WEB_SEARCH_TOOL_CHOICE=required</code>).</li>
              <li>Restart the web server and the worker.</li>
            </ol>
          </div>
        )}
        <p className="mt-3 text-xs text-slate">
          About “ChatGPT visibility”: the OpenAI API with web search is the supported way to sample ChatGPT-family answers. It is not the consumer ChatGPT app, which adds personalisation, memory and its own system prompt, so answers can differ. This app does not scrape logged-in interfaces.
        </p>
      </Section>
    </>
  );
}
