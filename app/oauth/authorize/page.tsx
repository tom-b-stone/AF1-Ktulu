import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getClient } from "@/lib/oauth";

// Sign-in step of the company connector. Claude sends people here; the
// middleware has already asked for the Google sign-in. One click connects
// Claude to AF1 Tools as this person.
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Problem({ text }: { text: string }) {
  return (
    <div style={{ maxWidth: 520, margin: "10vh auto", display: "grid", gap: 10 }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>The sign-in link is not valid</h1>
      <p style={{ color: "var(--muted)", margin: 0 }}>{text} Start again from Claude: Settings → Connectors → AF1 Tools → Connect.</p>
    </div>
  );
}

export default async function Authorize({ searchParams }: { searchParams: SP }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? "";
  const p = { client_id: one(searchParams.client_id), redirect_uri: one(searchParams.redirect_uri), response_type: one(searchParams.response_type), state: one(searchParams.state), code_challenge: one(searchParams.code_challenge), code_challenge_method: one(searchParams.code_challenge_method), scope: one(searchParams.scope) || "tools", resource: one(searchParams.resource) };
  const client = await getClient(p.client_id);
  if (!client) return <Problem text="The app asking for access is not registered." />;
  if (!client.redirect_uris.includes(p.redirect_uri)) return <Problem text="The return address does not belong to that app." />;
  if (p.response_type !== "code" || !p.code_challenge || p.code_challenge_method !== "S256") return <Problem text="The request is missing its security check (PKCE)." />;

  const name = client.client_name || (/claude/i.test(p.redirect_uri) ? "Claude" : "An app");
  return (
    <div style={{ maxWidth: 520, margin: "10vh auto", display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="section-label">AF1 Tools connector</span>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.15 }}>Connect {name} to AF1 Tools</h1>
        <p style={{ color: "var(--muted)", margin: 0, lineHeight: 1.55 }}>
          {name} can then use the AF1 tools you have access to (SEO, assets, Team Cards …) as <b style={{ color: "var(--fg)" }}>{email}</b>. Every action is logged under your name. You can disconnect any time in Claude under Settings → Connectors.
        </p>
      </div>
      <form method="post" action="/api/oauth/authorize" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {Object.entries(p).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button className="btn btn-primary" name="action" value="allow" type="submit">
          Allow
        </button>
        <button className="btn" name="action" value="deny" type="submit">
          Cancel
        </button>
      </form>
    </div>
  );
}
