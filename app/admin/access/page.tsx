"use client";

// Access board: who is in the test group and which tools each person sees.
// Changes apply within about a minute (next session refresh).
import { useEffect, useState } from "react";

type User = { email: string; tools: string[]; addedAt: string; addedBy: string };
type Tool = { key: string; label: string; status: string };

export default function AccessBoard() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [admins, setAdmins] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = () =>
    fetch("/api/admin/access")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setMsg({ tone: "err", text: j.error });
        setUsers(j.users);
        setTools(j.tools);
        setAdmins(j.admins);
      });
  useEffect(() => {
    void load();
  }, []);

  async function save(e: string, list: string[], note?: string) {
    const r = await fetch("/api/admin/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, tools: list }) }).then((x) => x.json());
    if (r.error) return setMsg({ tone: "err", text: r.error });
    setUsers(r.users);
    setMsg({ tone: "ok", text: note ?? `Saved ${e}.` });
  }
  async function remove(e: string) {
    const r = await fetch(`/api/admin/access?email=${encodeURIComponent(e)}`, { method: "DELETE" }).then((x) => x.json());
    setUsers(r.users);
    setConfirm(null);
    setMsg({ tone: "ok", text: `${e} removed. They can no longer sign in.` });
  }
  const toggle = (u: User, key: string) => void save(u.email, u.tools.includes(key) ? u.tools.filter((t) => t !== key) : [...u.tools, key]);
  const defaults = tools.filter((t) => /Live|Ready/.test(t.status)).map((t) => t.key);

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Access</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
        Test users and the tools they see. Only people on this list (and admins) can sign in. Changes apply within a minute. Admins ({admins.join(", ")}) always see everything.
      </p>

      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!email.trim()) return;
          void save(email.trim(), defaults, `Added ${email.trim()} with the tools that are live or ready to test.`).then(() => setEmail(""));
        }}
        style={{ display: "flex", gap: 8, margin: "14px 0" }}
      >
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@slash.digital" style={{ width: 280 }} aria-label="Email address" />
        <button className="btn btn-primary" disabled={!email.trim()}>
          Add test user
        </button>
      </form>
      {msg && (
        <div role="status" style={{ fontSize: 13, marginBottom: 12, color: msg.tone === "ok" ? "#7fd6a2" : "#ff9a84" }}>
          {msg.text}
        </div>
      )}

      {users === null ? (
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={{ padding: "10px 14px" }}>Email</th>
                {tools.map((t) => (
                  <th key={t.key} style={{ padding: "10px 8px", textAlign: "center", fontWeight: 500 }}>
                    <div>{t.label}</div>
                    <div style={{ fontSize: 10, opacity: 0.7 }}>{t.status}</div>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                    {u.email}
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>added {new Date(u.addedAt).toLocaleDateString("en-GB")}{u.addedBy !== "seed" ? ` by ${u.addedBy}` : ""}</div>
                  </td>
                  {tools.map((t) => (
                    <td key={t.key} style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={u.tools.includes(t.key)} onChange={() => toggle(u, t.key)} aria-label={`${t.label} for ${u.email}`} style={{ width: 18, height: 18, cursor: "pointer" }} />
                    </td>
                  ))}
                  <td style={{ padding: "0 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                    {confirm === u.email ? (
                      <>
                        <button className="btn" style={{ padding: "3px 10px", fontSize: 12, color: "#ff9a84", borderColor: "#c0392b" }} onClick={() => void remove(u.email)}>
                          Yes, remove
                        </button>{" "}
                        <button className="btn" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setConfirm(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button className="btn" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setConfirm(u.email)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={tools.length + 2} style={{ padding: 16, color: "var(--muted)" }}>
                    No test users. Only admins can sign in.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
