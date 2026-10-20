"use client";

// Team Card Configurator: overview of all cards, the entry to the guided
// edit (/teamcards/[id]) and the helper (your Claude, via the connector).
// First a short summary (what is ready, what needs attention), then the
// table with search, filters in the column headers and sorting.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Replace from "./Replace";
import { cardTemplate } from "@/lib/cardTemplate";
import TrackerImport from "./TrackerImport";
import { SideSection, useSidebarContent } from "@/app/components/SidebarSlot";
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
  links: { badge?: string; engagement?: string; page?: string };
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
      className="tc-stat"
      style={{ textAlign: "left", padding: "10px 14px", borderRadius: 10, border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, background: "var(--bg-2)", color: "inherit", cursor: onClick ? "pointer" : "default", display: "grid", gap: 2 }}
    >
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 800, lineHeight: 1.1, color: tone, fontVariantNumeric: "tabular-nums" }}>{n}</div>
      <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{label}</div>
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
  const [replacing, setReplacing] = useState(false);
  useEffect(() => {
    if (!replacing) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setReplacing(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [replacing]);

  const load = () =>
    fetch("/api/teamcards")
      .then((r) => r.json())
      .then((j) => (j.cards ? setCards(j.cards) : setError(j.error ?? "Could not load the cards")))
      .catch(() => setError("Could not load the cards"));
  useEffect(() => {
    void load();
  }, []);
  // temporary until the tracker is retired: the one-way import sits in the left menu
  useSidebarContent(
    <SideSection title="Temporary">
      <TrackerImport side onDone={() => void load()} />
    </SideSection>,
    [],
  );

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
    { key: "img", header: "", width: "56px", cell: (c) => <img src={c.imageUrl || cardTemplate(c.name)} alt={c.imageUrl ? "" : "Card image not defined yet"} title={c.imageUrl ? undefined : "Card image not defined yet (template)"} style={{ width: 36, aspectRatio: "4 / 5", objectFit: "cover", borderRadius: 4, display: "block" }} /> },
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
      width: "340px",
      sortable: true,
      sortValue: (c) => (c.check.quick === "Missing" ? 0 : c.check.quick === "Ready" ? 1 : 2) * 100 - c.check.missing.length,
      headerExtra: <HeaderSelect label="status" value={fQuick} options={opts.quick} onChange={setFQuick} />,
      cell: (c) => {
        const t = QUICK_TONE[c.check.quick];
        return (
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <span style={{ justifySelf: "start", fontSize: 11, padding: "2px 8px", borderRadius: 999, background: t.bg, color: t.fg, whiteSpace: "nowrap" }}>
              {t.label}
              {c.check.quick === "Missing" ? ` · ${c.check.missing.length}` : ""}
            </span>
            {c.check.missing.length > 0 && (
              <div title={c.check.missing.join(", ")} style={{ fontSize: 12, color: "#ff9a84", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {c.check.missing.join(" · ")}
              </div>
            )}
          </div>
        );
      },
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
    { key: "links", header: "Staging", width: "190px", cell: (c) => <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>{c.links.badge ? <a href={c.links.badge} target="_blank" rel="noreferrer">Card ↗</a> : <span style={{ color: "var(--muted)" }}>Not on staging yet</span>}{c.links.engagement && <> · <a href={c.links.engagement} target="_blank" rel="noreferrer">Engagement ↗</a></>}{c.links.page && <> · <a href={c.links.page} target="_blank" rel="noreferrer">Page ↗</a></>}</span> },
    { key: "edit", header: "", width: "80px", cell: (c) => <Link className="btn btn-primary" href={`/teamcards/${c.id}`}>Edit</Link> },
  ];

  const chip = { padding: "3px 10px", fontSize: 12, borderRadius: 999 } as const;
  return (
    <div style={{ display: "grid", gap: 24, maxWidth: 1600 }}>
      <style>{`.tc-stat{transition:border-color .15s,transform .15s}.tc-stat:active{transform:scale(.98)}`}</style>
      <header style={{ display: "grid", gap: 6, maxWidth: 760 }}>
        <h1 style={{ margin: 0 }}>Team Cards</h1>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 14, lineHeight: 1.5 }}>Every card with its texts, journey and staging links. Open a card to edit it step by step in the real frontend views.</p>
      </header>

      {error && <div role="alert" style={{ color: "#e06c5b" }}>{error}</div>}
      {!cards && !error && (
        <div aria-busy="true" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8, maxWidth: 760 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} style={{ height: 62, borderRadius: 10, background: "var(--bg-2)", opacity: 0.6 }} />
            ))}
          </div>
          <div style={{ height: 360, borderRadius: 12, background: "var(--bg-2)", opacity: 0.4 }} />
        </div>
      )}

      {cards && (
        <section aria-label="Summary" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8, maxWidth: 760 }}>
            <Stat n={summary.total} label="Team Cards" active={!filtered} onClick={reset} />
            <Stat n={summary.ready} label="Ready" tone="#7fd6a2" active={fQuick === "Ready"} onClick={() => setFQuick(fQuick === "Ready" ? ALL : "Ready")} />
            <Stat n={summary.missing} label="Need attention" tone="#ff9a84" active={fQuick === "Missing"} onClick={() => setFQuick(fQuick === "Missing" ? ALL : "Missing")} />
            {summary.disabled > 0 && <Stat n={summary.disabled} label="Disabled" active={fQuick === "Disabled"} onClick={() => setFQuick(fQuick === "Disabled" ? ALL : "Disabled")} />}
            <Stat n={summary.core} label="Core cards" />
          </div>
        </section>
      )}

      {cards && (
        <section aria-label="All cards" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cards: name, ID, partner, text…" style={{ width: "min(340px, 100%)" }} aria-label="Search cards" />
            <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              {shown.length} of {cards.length} cards
            </span>
            {filtered && (
              <button className="btn" style={chip} onClick={reset}>
                Reset filters
              </button>
            )}
            <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setReplacing(true)} title="Replace wording on all cards (EN/DE), with preview before anything is written">
              Replace…
            </button>
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
        </section>
      )}

      {replacing && cards &&
        createPortal(
          <div role="dialog" aria-modal="true" aria-label="Replace on all cards" onClick={(e) => e.target === e.currentTarget && setReplacing(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "start center", padding: "8vh 16px 16px", overflow: "auto" }}>
            <div className="card" style={{ width: "min(880px, 100%)", padding: 22, background: "var(--bg-2)" }}>
              <Replace cards={cards as never} initialFind={q} onClose={() => setReplacing(false)} onApplied={() => void load()} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
