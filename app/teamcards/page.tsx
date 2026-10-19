"use client";

// Team Card Configurator: overview of all cards, the entry to the guided
// edit (/teamcards/[id]) and the helper (your Claude, via the connector).
// First a short summary (what is ready, what needs attention), then the
// table with search, filters in the column headers and sorting.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Replace from "./Replace";
import { Table, type TableColumn } from "@/components/ui/table-editable";

type Row = {
  values: Record<string, unknown>;
  id: string;
  name: string;
  status: string;
  mechanic?: string;
  rewardType?: string;
  raceLabel?: string;
  placement?: string;
  imageUrl?: string;
  updatedAt: string;
  log: { at: string; by: string; summary: string }[];
  links: { badge: string; engagement?: string; page?: string };
  meta: { type?: string; core: boolean; campaign?: string; race?: string; partner?: string; season?: string };
  check: { missing: string[]; quick: "Ready" | "Missing" | "Disabled" };
};

const MECH: Record<string, string> = { "q-and-a": "Q&A", survey: "Survey", "hot-or-not": "Hot or Not", page: "Page visit", link: "Link" };
const REWARD: Record<string, string> = { noReward: "No reward", raffleSignup: "Raffle", couponCode: "Voucher" };
const PREFIX: Record<string, string> = { SIN: "Unlock Singapore" };

const campaignOf = (c: Row) => c.meta.campaign || PREFIX[c.id.split("-")[0]] || (c.raceLabel ? `${c.raceLabel}` : "No campaign");
const typeOf = (c: Row) => c.meta.type || (c.meta.core ? "Core" : "Unknown type");
const QUICK_TONE: Record<Row["check"]["quick"], { bg: string; fg: string; label: string }> = {
  Ready: { bg: "rgba(46,125,79,0.18)", fg: "#7fd6a2", label: "Ready" },
  Missing: { bg: "rgba(227,62,26,0.16)", fg: "#ff9a84", label: "Needs attention" },
  Disabled: { bg: "rgba(255,255,255,0.06)", fg: "var(--muted)", label: "Disabled" },
};

const ALL = "";
function HeaderSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select
      aria-label={`Filter by ${label}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ maxWidth: 120, fontSize: 11, padding: "2px 4px", borderRadius: 6, border: `1px solid ${value ? "var(--accent)" : "var(--border-2)"}`, background: "var(--surface)", color: "var(--fg)" }}
    >
      <option value={ALL}>All</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Stat({ n, label, tone, active, onClick }: { n: number; label: string; tone?: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ textAlign: "left", padding: "12px 14px", borderRadius: 10, border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, background: "var(--bg-2)", color: "inherit", cursor: onClick ? "pointer" : "default", minWidth: 120 }}
    >
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 800, color: tone }}>{n}</div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
    </button>
  );
}

export default function Page() {
  const [cards, setCards] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fCampaign, setFCampaign] = useState(ALL);
  const [fType, setFType] = useState(ALL);
  const [fQuick, setFQuick] = useState(ALL);

  const load = () =>
    fetch("/api/teamcards")
      .then((r) => r.json())
      .then((j) => (j.cards ? setCards(j.cards) : setError(j.error ?? "Could not load the cards")))
      .catch(() => setError("Could not load the cards"));
  useEffect(() => {
    void load();
  }, []);

  const opts = useMemo(() => {
    const u = (f: (c: Row) => string) => [...new Set((cards ?? []).map(f))].sort();
    return { campaign: u(campaignOf), type: u(typeOf), quick: ["Ready", "Missing", "Disabled"] };
  }, [cards]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (cards ?? []).filter((c) => {
      if (fCampaign && campaignOf(c) !== fCampaign) return false;
      if (fType && typeOf(c) !== fType) return false;
      if (fQuick && c.check.quick !== fQuick) return false;
      if (!needle) return true;
      const hay = [c.name, c.id, campaignOf(c), typeOf(c), c.meta.partner, c.meta.race, MECH[c.mechanic ?? ""], REWARD[c.rewardType ?? ""], ...c.check.missing].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [cards, q, fCampaign, fType, fQuick]);

  const summary = useMemo(() => {
    const list = cards ?? [];
    const top: Record<string, number> = {};
    list.forEach((c) => c.check.missing.forEach((m) => (top[m] = (top[m] ?? 0) + 1)));
    const campaigns: Record<string, number> = {};
    list.forEach((c) => (campaigns[campaignOf(c)] = (campaigns[campaignOf(c)] ?? 0) + 1));
    return {
      total: list.length,
      ready: list.filter((c) => c.check.quick === "Ready").length,
      missing: list.filter((c) => c.check.quick === "Missing").length,
      disabled: list.filter((c) => c.check.quick === "Disabled").length,
      core: list.filter((c) => c.meta.core).length,
      top: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 6),
      campaigns: Object.entries(campaigns).sort((a, b) => b[1] - a[1]),
    };
  }, [cards]);

  const filtered = !!(q || fCampaign || fType || fQuick);
  const reset = () => {
    setQ("");
    setFCampaign(ALL);
    setFType(ALL);
    setFQuick(ALL);
  };

  const columns: TableColumn<Row>[] = [
    // eslint-disable-next-line @next/next/no-img-element
    { key: "img", header: "", width: "56px", cell: (c) => (c.imageUrl ? <img src={c.imageUrl} alt="" style={{ width: 36, borderRadius: 4, display: "block" }} /> : <div title="No card image" style={{ width: 36, height: 45, borderRadius: 4, border: "1px dashed #c0392b" }} />) },
    {
      key: "name",
      header: "Card",
      width: "250px",
      sortable: true,
      cell: (c) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            {c.id} · {MECH[c.mechanic ?? ""] ?? c.mechanic ?? "?"} · {REWARD[c.rewardType ?? ""] ?? c.rewardType ?? "?"}
          </div>
        </div>
      ),
    },
    {
      key: "check",
      header: "Status",
      width: "200px",
      sortable: true,
      sortValue: (c) => (c.check.quick === "Missing" ? 0 : c.check.quick === "Ready" ? 1 : 2),
      headerExtra: <HeaderSelect label="status" value={fQuick} options={opts.quick} onChange={setFQuick} />,
      cell: (c) => {
        const t = QUICK_TONE[c.check.quick];
        return (
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: t.bg, color: t.fg, whiteSpace: "nowrap" }}>
            {t.label}
            {c.check.quick === "Missing" ? ` · ${c.check.missing.length}` : ""}
          </span>
        );
      },
    },
    {
      key: "missing",
      header: "Attention",
      width: "300px",
      sortable: true,
      sortValue: (c) => c.check.missing.length,
      cell: (c) =>
        c.check.missing.length ? (
          <div title={c.check.missing.join(", ")} style={{ fontSize: 12, color: "#ff9a84", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {c.check.missing.join(" · ")}
          </div>
        ) : (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{c.check.quick === "Disabled" ? "Card is disabled" : "Nothing missing"}</span>
        ),
    },
    {
      key: "type",
      header: "Type",
      width: "190px",
      sortable: true,
      sortValue: (c) => typeOf(c),
      headerExtra: <HeaderSelect label="type" value={fType} options={opts.type} onChange={setFType} />,
      cell: (c) => (
        <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          {c.meta.core && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: "var(--accent)", color: "#fff", marginRight: 6 }}>CORE</span>}
          {typeOf(c)}
        </span>
      ),
    },
    {
      key: "campaign",
      header: "Campaign",
      width: "220px",
      sortable: true,
      sortValue: (c) => campaignOf(c),
      headerExtra: <HeaderSelect label="campaign" value={fCampaign} options={opts.campaign} onChange={setFCampaign} />,
      cell: (c) => (
        <div style={{ fontSize: 12 }}>
          <div>{campaignOf(c)}</div>
          <div style={{ color: "var(--muted)" }}>{[c.meta.race ?? c.raceLabel, c.meta.partner].filter(Boolean).join(" · ")}</div>
        </div>
      ),
    },
    { key: "status", header: "Tracker", width: "100px", sortable: true, cell: (c) => <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--border-2)" }}>{c.status}</span> },
    { key: "updatedAt", header: "Last change", width: "170px", sortable: true, sortValue: (c) => c.log[0]?.at ?? c.updatedAt, cell: (c) => (c.log[0] ? <div style={{ fontSize: 12 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.log[0].summary}</div><div style={{ color: "var(--muted)" }}>{new Date(c.log[0].at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div></div> : null) },
    { key: "links", header: "Staging", width: "190px", cell: (c) => <span style={{ fontSize: 12, whiteSpace: "nowrap" }}><a href={c.links.badge} target="_blank" rel="noreferrer">Card ↗</a>{c.links.engagement && <> · <a href={c.links.engagement} target="_blank" rel="noreferrer">Engagement ↗</a></>}{c.links.page && <> · <a href={c.links.page} target="_blank" rel="noreferrer">Page ↗</a></>}</span> },
    { key: "edit", header: "", width: "80px", cell: (c) => <Link className="btn btn-primary" href={`/teamcards/${c.id}`}>Edit</Link> },
  ];

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1600 }}>
      <div>
        <h1 style={{ margin: "0 0 6px" }}>Team Cards</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>Every card with its texts, journey and staging links. Open a card to edit it step by step in the real frontend views, or change wording on many cards at once with search and replace.</p>
      </div>

      {error && <div style={{ color: "#e06c5b" }}>{error}</div>}
      {!cards && !error && <div style={{ color: "var(--muted)" }}>Loading cards…</div>}

      {cards && (
        <section aria-label="Summary" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <Stat n={summary.total} label="Team Cards" active={!filtered} onClick={reset} />
            <Stat n={summary.ready} label="Ready" tone="#7fd6a2" active={fQuick === "Ready"} onClick={() => setFQuick(fQuick === "Ready" ? ALL : "Ready")} />
            <Stat n={summary.missing} label="Need attention" tone="#ff9a84" active={fQuick === "Missing"} onClick={() => setFQuick(fQuick === "Missing" ? ALL : "Missing")} />
            {summary.disabled > 0 && <Stat n={summary.disabled} label="Disabled" active={fQuick === "Disabled"} onClick={() => setFQuick(fQuick === "Disabled" ? ALL : "Disabled")} />}
            <Stat n={summary.core} label="Core cards" />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, fontSize: 12, color: "var(--muted)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span>Campaigns:</span>
              {summary.campaigns.map(([name, n]) => (
                <button key={name} className="btn" style={{ padding: "2px 10px", fontSize: 12, borderColor: fCampaign === name ? "var(--accent)" : undefined }} onClick={() => setFCampaign(fCampaign === name ? ALL : name)}>
                  {name} · {n}
                </button>
              ))}
            </div>
            {summary.top.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <span>Most often missing:</span>
                {summary.top.map(([m, n]) => (
                  <button key={m} className="btn" style={{ padding: "2px 10px", fontSize: 12, color: "#ff9a84", borderColor: q === m ? "var(--accent)" : undefined }} onClick={() => setQ(q === m ? "" : m)}>
                    {m} · {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {cards && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, partner, missing text…" style={{ width: 320 }} aria-label="Search cards" />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {shown.length} of {cards.length} cards
            </span>
            {filtered && (
              <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={reset}>
                Reset filters
              </button>
            )}
          </div>
          <div className="beui beui-compact">
            <Table<Row>
              data={shown}
              columns={columns}
              getRowId={(r) => r.id}
              resizable
              reorderable
              defaultSort={{ key: "check", direction: "asc" }}
              height={Math.max(360, Math.min(760, 120 + shown.length * 64))}
              rowHeight={60}
              emptyState={filtered ? "No card matches these filters." : "No cards yet."}
              className="rounded-lg border border-border"
            />
          </div>
        </div>
      )}
      {cards && <Replace cards={cards as never} onApplied={() => void load()} />}
    </div>
  );
}
