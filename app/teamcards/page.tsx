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
import BuildPages from "./BuildPages";
import SyncBar, { cardSyncState, type SyncStatus } from "./SyncBar";
import { fromProd } from "./fromProd";
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
const PREFIX: Record<string, string> = { SIN: "Singapore" };

// a campaign (e.g. Singapore) is its own thing; the Grand Prix of a card is not its campaign
// tags read "singapore 2026", briefs "Singapore": one name per campaign
const titleCase = (t: string) => t.replace(/\s*\b20\d\d\b\s*$/, "").trim().replace(/(^|\s)(\p{L})/gu, (m) => m.toUpperCase());
const campaignOf = (c: Row) => titleCase(c.meta.campaign || PREFIX[c.id.split("-")[0]] || "") || "No campaign";
const numOf = (id: string) => Number(/(\d+)\s*$/.exec(id)?.[1] ?? 0);
// when a card came into Ktulu: the import date, else its oldest log entry
const addedAt = (c: Row) => Date.parse(String((c as unknown as { brief?: { importedAt?: string } }).brief?.importedAt ?? c.log[c.log.length - 1]?.at ?? c.updatedAt)) || 0;
const gpOf = (c: Row) => c.meta.race || c.raceLabel || "No Grand Prix";
const typeOf = (c: Row) => c.meta.type || (c.meta.core ? "Core" : "Unknown type");
const QUICK_TONE: Record<Row["check"]["quick"], { bg: string; fg: string; label: string }> = {
  Ready: { bg: "rgba(46,125,79,0.18)", fg: "#7fd6a2", label: "Ready" },
  Missing: { bg: "rgba(227,62,26,0.16)", fg: "#ff9a84", label: "Needs attention" },
  Disabled: { bg: "rgba(255,255,255,0.06)", fg: "var(--muted)", label: "Disabled" },
};

const ALL = "";
// a filter in the toolbar: reads "Status: All", turns lava when set
function FilterSelect({ label, value, options, names, onChange }: { label: string; value: string; options: string[]; names?: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <label style={{ position: "relative", display: "inline-flex", alignItems: "center", height: 32, padding: "0 28px 0 12px", borderRadius: 999, fontSize: 12.5, border: `1px solid ${value ? "var(--accent)" : "var(--border)"}`, background: value ? "rgba(255,45,0,.12)" : "transparent", color: value ? "var(--fg)" : "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
      {label}: <b style={{ fontWeight: 600, color: "var(--fg)", marginLeft: 4 }}>{value ? names?.[value] ?? value : "All"}</b>
      <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden style={{ position: "absolute", right: 11 }}>
        <path d="M1 1l4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.5" />
      </svg>
      <select aria-label={`Filter by ${label}`} value={value} onChange={(e) => onChange(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}>
        <option value={ALL}>All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {names?.[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Page() {
  const [cards, setCards] = useState<Row[] | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncFor, setSyncFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fCampaign, setFCampaign] = useState(ALL);
  // the Figma sync campaigns, so a campaign filter can offer "build the pages from Figma"
  const [syncCampaigns, setSyncCampaigns] = useState<{ key: string; name: string; figmaFile?: string; figmaUrl?: string }[]>([]);
  const [campPages, setCampPages] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch("/api/sitemap/campaigns").then((r) => r.json()).then((j) => j.campaigns && setSyncCampaigns(j.campaigns)).catch(() => {});
  }, []);
  const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
  const syncCamp = fCampaign ? syncCampaigns.find((c) => norm(c.name) === norm(fCampaign)) : undefined;
  useEffect(() => {
    if (!syncCamp || syncCamp.key in campPages) return;
    fetch(`/api/sitemap/${syncCamp.key}`).then((r) => r.json()).then((j) => setCampPages((m) => ({ ...m, [syncCamp.key]: (j.pages ?? []).length }))).catch(() => {});
  }, [syncCamp, campPages]);
  const [fGp, setFGp] = useState(ALL);
  const [fType, setFType] = useState(ALL);
  const [fQuick, setFQuick] = useState(ALL);
  const [replacing, setReplacing] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
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
    return { campaign: u(campaignOf), gp: u(gpOf), type: u(typeOf), quick: ["Ready", "Missing", "Disabled"] };
  }, [cards]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (cards ?? []).filter((c) => {
      if (fCampaign && campaignOf(c) !== fCampaign) return false;
      if (fGp && gpOf(c) !== fGp) return false;
      if (fType && typeOf(c) !== fType) return false;
      if (fQuick && c.check.quick !== fQuick) return false;
      if (!needle) return true;
      const hay = [c.name, c.id, campaignOf(c), typeOf(c), c.meta.partner, c.meta.race, MECH[c.mechanic ?? ""], REWARD[c.rewardType ?? ""], ...c.check.missing].join(" ").toLowerCase();
      return hay.includes(needle);
    }).sort((a, b) => Math.floor(addedAt(b) / 864e5) - Math.floor(addedAt(a) / 864e5) || numOf(b.id) - numOf(a.id)); // newest cards first: latest import day, then highest number
  }, [cards, q, fCampaign, fGp, fType, fQuick]);

  const summary = useMemo(() => {
    const list = cards ?? [];
    const campaigns: Record<string, number> = {};
    list.forEach((c) => (campaigns[campaignOf(c)] = (campaigns[campaignOf(c)] ?? 0) + 1));
    return { total: list.length, campaigns: Object.entries(campaigns).sort((a, b) => (a[0] === "No campaign" ? 1 : b[0] === "No campaign" ? -1 : b[1] - a[1])) };
  }, [cards]);

  const filtered = !!(q || fCampaign || fGp || fType || fQuick);
  const reset = () => {
    setQ("");
    setFCampaign(ALL);
    setFGp(ALL);
    setFType(ALL);
    setFQuick(ALL);
  };

  const shownIds = shown.map((c) => c.id);
  const allSel = shownIds.length > 0 && shownIds.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const columns: TableColumn<Row>[] = [
    {
      key: "sel",
      header: <input type="checkbox" aria-label="Select all shown cards" checked={allSel} onPointerDown={stop} onClick={stop} onChange={() => setSel(allSel ? new Set([...sel].filter((id) => !shownIds.includes(id))) : new Set([...sel, ...shownIds]))} />,
      width: "40px",
      cell: (c) => <input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.has(c.id)} onPointerDown={stop} onClick={stop} onChange={() => toggle(c.id)} />,
    },
    // eslint-disable-next-line @next/next/no-img-element
    { key: "img", header: "", width: "56px", cell: (c) => <img src={c.imageUrl || cardTemplate(c.name)} alt={c.imageUrl ? "" : "Card image not defined yet"} title={c.imageUrl ? undefined : "Card image not defined yet (template)"} style={{ width: 36, aspectRatio: "4 / 5", objectFit: "cover", borderRadius: 4, display: "block" }} /> },
    { key: "id", header: "No.", width: "78px", sortable: true, sortValue: (c) => c.id, cell: (c) => <span style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{c.id}</span> },
    {
      key: "name",
      header: "Card",
      width: "240px",
      sortable: true,
      cell: (c) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {(() => {
              const st = cardSyncState(sync, c.id);
              if (!st || !c.links.badge) return null;
              const tone = st === "ok" ? "#7fd6a2" : st === "conflict" ? "#ff7a66" : "#f0b35a";
              const label = st === "ok" ? "Staging, Ktulu and Figma match" : st === "conflict" ? "Changed on both sides: review" : "Change waiting: review and sync";
              return (
                <button title={label} aria-label={label} onPointerDown={stop} onClick={(e) => { e.stopPropagation(); if (st !== "ok") setSyncFor(c.id); }} style={{ all: "unset", cursor: st === "ok" ? "default" : "pointer", width: 8, height: 8, borderRadius: 99, background: tone, flexShrink: 0 }} />
              );
            })()}
            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            {MECH[c.mechanic ?? ""] ?? c.mechanic ?? "No mechanic yet"} · {REWARD[c.rewardType ?? ""] ?? c.rewardType ?? "no reward set"}
          </div>
        </div>
      ),
    },
    {
      key: "check",
      header: "Status",
      width: "300px",
      sortable: true,
      sortValue: (c) => (c.check.quick === "Missing" ? 0 : c.check.quick === "Ready" ? 1 : 2) * 100 - c.check.missing.length,
      cell: (c) => {
        const t = QUICK_TONE[c.check.quick];
        return (
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <span style={{ justifySelf: "start", fontSize: 12, padding: "2px 8px", borderRadius: 999, background: t.bg, color: t.fg, whiteSpace: "nowrap" }}>
              {t.label}
              {c.check.quick === "Missing" ? ` · ${c.check.missing.length}` : ""}
            </span>
            {c.check.missing.length > 0 && (
              <div title={c.check.missing.join(", ")} style={{ fontSize: 12, color: "#ff9a84", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.check.missing.slice(0, 2).join(" · ")}
                {c.check.missing.length > 2 && <span style={{ color: "var(--muted)" }}> +{c.check.missing.length - 2} more</span>}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "type",
      header: "Type",
      width: "140px",
      sortable: true,
      sortValue: (c) => typeOf(c),
      cell: (c) => (
        <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          {c.meta.core && <span style={{ fontSize: 12, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: "var(--accent-strong)", color: "#fff", marginRight: 6 }}>CORE</span>}
          {typeOf(c)}
        </span>
      ),
    },
    {
      key: "campaign",
      header: "Campaign",
      width: "130px",
      sortable: true,
      sortValue: (c) => campaignOf(c),
      cell: (c) => <span style={{ fontSize: 12, color: campaignOf(c) === "No campaign" ? "var(--muted)" : undefined }}>{campaignOf(c)}</span>,
    },
    {
      key: "gp",
      header: "Grand Prix",
      width: "140px",
      sortable: true,
      sortValue: (c) => gpOf(c),
      cell: (c) => (
        <div style={{ fontSize: 12 }}>
          <div style={{ color: gpOf(c) === "No Grand Prix" ? "var(--muted)" : undefined }}>{gpOf(c)}</div>
          {c.meta.partner && <div style={{ color: "var(--muted)" }}>{c.meta.partner}</div>}
        </div>
      ),
    },
    {
      key: "edit",
      header: "Staging CMS",
      width: "250px",
      cell: (c) => (
        <span style={{ display: "inline-flex", gap: 12, alignItems: "center" }}>
          <Link className="btn btn-primary" href={`/teamcards/${c.id}`} style={{ height: 30, padding: "0 12px" }}>
            Edit
          </Link>
          {/* card, engagement and page in the staging CMS; what does not exist yet stays grey */}
          {([["Card", c.links.badge, "the card (badge)"], ["Engagement", c.links.engagement, "the engagement"], ["Page", c.links.page, "the page with the module"]] as const).map(([label, href, what]) =>
            href ? (
              <a key={label} href={href} target="_blank" rel="noreferrer" title={`Open ${what} in the staging CMS`} style={{ fontSize: 12, color: "var(--fg)" }}>
                {label} ↗
              </a>
            ) : (
              <span key={label} title={`No ${what} on staging yet`} style={{ fontSize: 12, color: "var(--muted)", opacity: 0.5 }}>
                {label}
              </span>
            ),
          )}
        </span>
      ),
    },
  ];

  const chip = { padding: "3px 10px", fontSize: 12, borderRadius: 999 } as const;
  return (
    <div style={{ display: "grid", gap: 24, maxWidth: 1600 }}>
      <header style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, flex: 1 }}>Team Cards</h1>
          <Link className="btn btn-primary" href="/teamcards/new" style={{ height: 36 }}>
            New Team Card
          </Link>
        </div>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 14, lineHeight: 1.5 }}>Every card with its texts, journey and staging links. Open a card to edit it step by step in the real frontend views.</p>
      </header>

      <SyncBar onStatus={setSync} onSynced={() => void load()} openFor={syncFor} onCloseFor={() => setSyncFor(null)} />

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
        <section aria-label="Campaigns" role="group" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {[["", `All · ${summary.total}`] as [string, string], ...summary.campaigns.map(([name, n]) => [name, `${name} · ${n}`] as [string, string])].map(([name, label]) => {
            const on = fCampaign === name;
            return (
              <button
                key={label}
                aria-pressed={on}
                onClick={() => setFCampaign(on && name ? ALL : name)}
                style={{ padding: "6px 14px", borderRadius: 999, fontSize: 12.5, cursor: "pointer", border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "rgba(255,45,0,.14)" : "transparent", color: on ? "var(--fg)" : "var(--muted)" }}
              >
                {label}
              </button>
            );
          })}
        </section>
      )}

      {cards && syncCamp?.figmaFile && syncCamp.key in campPages && (
        <BuildPages compact campaign={syncCamp.key} campaignName={syncCamp.name} figmaUrl={syncCamp.figmaUrl} hasPages={campPages[syncCamp.key] > 0} />
      )}

      {cards && (
        <section aria-label="All cards" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cards: name, ID, partner, text…" style={{ width: "min(300px, 100%)" }} aria-label="Search cards" />
            <FilterSelect label="Status" value={fQuick} options={opts.quick} names={{ Missing: "Needs attention" }} onChange={setFQuick} />
            <FilterSelect label="Type" value={fType} options={opts.type} onChange={setFType} />
            <FilterSelect label="Grand Prix" value={fGp} options={opts.gp} onChange={setFGp} />
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
          {sel.size > 0 && <BulkBar ids={[...sel]} cards={cards} onClear={() => setSel(new Set())} onDone={() => void load()} />}
          <div className="beui beui-compact">
            <Table<Row>
              data={shown}
              columns={columns}
              getRowId={(r) => r.id}
              resizable
              reorderable
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

// Actions on several cards at once: enable / disable, card type. Asks before
// it writes; changes go to staging (cards not on staging yet: Ktulu only).
function BulkBar({ ids, cards, onClear, onDone }: { ids: string[]; cards: Row[]; onClear: () => void; onDone: () => void }) {
  const [types, setTypes] = useState<{ id: string; title: string }[] | null>(null);
  const [type, setType] = useState("");
  const [ask, setAsk] = useState<null | { label: string; run: () => Promise<{ text: string; err?: boolean }> }>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "types" }) })
      .then((r) => r.json())
      .then((j) => setTypes(j.types ?? []))
      .catch(() => setTypes([]));
  }, []);
  const n = ids.length;
  const offStaging = ids.filter((id) => !cards.find((c) => c.id === id)?.links.badge).length;
  const post = (body: unknown) => fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const setDisabled = (on: boolean) =>
    setAsk({
      label: `${on ? "Disable" : "Enable"} ${n} card${n === 1 ? "" : "s"}${on ? " (they lose the link to engagement and module)" : ""}?`,
      run: async () => {
        const j = await post({ action: "apply", changes: ids.map((card) => ({ card, key: "disabled", value: on })) });
        const errs: string[] = j.errors ?? (j.error ? [j.error] : []);
        return { text: `${on ? "Disabled" : "Enabled"} ${n - errs.length} of ${n}.${errs.length ? " " + errs.join(" · ") : ""}`, err: errs.length > 0 };
      },
    });
  const setTypeAll = () => {
    const t = types?.find((x) => x.id === type);
    if (!t) return;
    setAsk({
      label: `Set the card type of ${n} card${n === 1 ? "" : "s"} to ${t.title}?`,
      run: async () => {
        const j = await post({ action: "set-type", ids, type: t });
        const errs: string[] = j.errors ?? (j.error ? [j.error] : []);
        return { text: `${t.title} set on ${j.done?.length ?? 0} of ${n}.${errs.length ? " " + errs.join(" · ") : ""}`, err: errs.length > 0 };
      },
    });
  };
  const perCard = (label: string, path: string, only: (c: Row) => boolean) => {
    const list = ids.filter((id) => { const c = cards.find((x) => x.id === id); return c && only(c); });
    setAsk({
      label: list.length ? `${label}: ${list.length} card${list.length === 1 ? "" : "s"}?` : `${label}: none of the selected cards qualify.`,
      run: async () => {
        let ok = 0;
        const errs: string[] = [];
        for (const id of list) {
          const j = path === "from-prod" ? await fromProd(id) : await fetch(`/api/teamcards/${id}/${path}`, { method: "POST" }).then((r) => r.json()).catch(() => ({ ok: false }));
          if (j.ok) ok++;
          else errs.push(`${id}: ${(j.steps ?? []).filter((x: { ok: boolean }) => !x.ok).map((x: { step: string; detail?: string }) => x.detail || x.step).join(", ") || "failed"}`);
        }
        return { text: `${label}: ${ok} of ${list.length} done.${errs.length ? " " + errs.join(" · ") : ""}`, err: errs.length > 0 };
      },
    });
  };
  async function go() {
    if (!ask) return;
    setBusy(true);
    const r = await ask.run().catch((e) => ({ text: e instanceof Error ? e.message : "failed", err: true }));
    setBusy(false);
    setAsk(null);
    setMsg(r);
    onDone();
  }
  return (
    <div role="region" aria-label="Bulk actions" style={{ position: "sticky", top: 8, zIndex: 5, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--accent)", background: "var(--bg-2)", boxShadow: "0 12px 30px -18px rgba(0,0,0,.8)" }}>
      <b style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{n} selected</b>
      {!ask ? (
        <>
          <button className="btn" onClick={() => setDisabled(true)}>Disable</button>
          <button className="btn" onClick={() => setDisabled(false)}>Enable</button>
          <span style={{ width: 1, height: 22, background: "var(--border)" }} />
          <button className="btn" onClick={() => perCard("Build on staging (disabled)", "create", (c) => !c.links.badge)}>Build on staging</button>
          <button className="btn" onClick={() => perCard("Get from production, overwrites staging", "from-prod", () => true)}>Get from production</button>
          <span style={{ width: 1, height: 22, background: "var(--border)" }} />
          <select className="input" style={{ width: "auto", padding: "5px 8px" }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Card type">
            <option value="">{types ? "Card type …" : "Loading types …"}</option>
            {(types ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          <button className="btn" disabled={!type} onClick={setTypeAll}>Set type</button>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={onClear}>Clear selection</button>
        </>
      ) : (
        <>
          <span style={{ fontSize: 13 }}>{ask.label}{offStaging ? ` ${offStaging} not on staging yet: changed in Ktulu only.` : " Written to staging."}</span>
          <button className="btn btn-primary" disabled={busy} onClick={() => void go()}>{busy ? "Working …" : "Yes, do it"}</button>
          <button className="btn" disabled={busy} onClick={() => setAsk(null)}>Cancel</button>
        </>
      )}
      {msg && !ask && <span style={{ flexBasis: "100%", fontSize: 12, color: msg.err ? "#ff9a84" : "#7fd6a2" }}>{msg.text}</span>}
    </div>
  );
}
