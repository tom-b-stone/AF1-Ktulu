// AF1 Ktulu Sync – the campaign sitemap in Figma, the AF1 Tool and the
// staging CMS in the same state.
//
// Page layout (like the São Paulo file):
//   AF1_<Campaign>_Flow_Overview          journey map; titles link to the screens
//   one section per landing page          "MOBILE · NN · Title", the mobile page,
//                                         and (on the activation page) the Team
//                                         Card journey to the right
// Sections are arranged like the sitemap: left activations | hub | right.
//
// Tagged nodes carry shared plugin data (namespace "af1", key "sync"):
//   page frame : { type:"page", url, stagingId }
//   module/card: { type:"block"|"card", fields:[{key,layer,kind}], last:{}, imgs:{} }
//
// One Figma board per campaign (set on af1-ktulu.vercel.app/figma): the plugin
// picks the campaign whose board is this file. The choice is kept in the file
// (shared plugin data "af1"/"campaign") when Figma doesn't tell the file key.
// A text changed on a mobile screen goes to the CMS and from there onto every
// other screen with the same field (desktop), right in the same sync.

var BASE = "https://af1-ktulu.vercel.app/api/figma/";
var NS = "af1";
var STATIC_AUDI = { "Audi Type Variable": "Audi Type" };
var state = { token: "", campaign: "", campaigns: [], data: null, live: true, busy: false };

figma.showUI(__html__, { width: 440, height: 600, themeColors: true });

function send(type, payload) { figma.ui.postMessage(Object.assign({ type: type }, payload || {})); }
function log(msg) { send("log", { msg: msg }); }
function progress(msg) { send("progress", { msg: msg }); }
function readData(n) { var s = n.getSharedPluginData(NS, "sync"); if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } }
function writeData(n, d) { n.setSharedPluginData(NS, "sync", JSON.stringify(d)); }
function apiUrl(c) { return BASE + encodeURIComponent(state.token) + "/" + (c || state.campaign); }
function mediaUrl(id) { return apiUrl() + "?media=" + encodeURIComponent(id); }
function solid(r, g, b) { return [{ type: "SOLID", color: { r: r, g: g, b: b } }]; }
var GRAPH = solid(0.169, 0.161, 0.161), CHALK = solid(0.961, 0.949, 0.949), MUTED = solid(0.463, 0.451, 0.451), LAVA = solid(1, 0.176, 0);
// screen sections are dark so the pages stand out; labels on them are light
var DARK = solid(0.118, 0.114, 0.114), ON_DARK = solid(0.961, 0.949, 0.949), ON_DARK_MUTED = solid(0.65, 0.64, 0.64);
function autoLayout(dir) { var f = figma.createFrame(); f.layoutMode = dir; f.primaryAxisSizingMode = "AUTO"; f.counterAxisSizingMode = "AUTO"; f.fills = []; return f; }

async function api(method, body, c) {
  if (!c && !state.campaign) throw new Error("Pick the campaign of this board first.");
  var res = await fetch(apiUrl(c), { method: method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  var j = await res.json();
  if (!res.ok) throw new Error(j && j.error ? j.error : "HTTP " + res.status);
  return j;
}

// ---- UI round trips: images are decoded / encoded in the UI iframe -------
var waits = {}, seq = 0;
function askUI(type, payload) {
  return new Promise(function (resolve, reject) {
    var id = "r" + (++seq);
    waits[id] = { resolve: resolve, reject: reject };
    send(type, Object.assign({ reqId: id }, payload));
    setTimeout(function () { if (waits[id]) { delete waits[id]; reject(new Error(type + " timed out")); } }, 60000);
  });
}

// ---- fonts ----------------------------------------------------------------
var fontState = {};
async function loadFont(f) {
  var k = f.family + "|" + f.style;
  if (fontState[k] === undefined) { try { await figma.loadFontAsync(f); fontState[k] = true; } catch (e) { fontState[k] = false; } }
  return fontState[k];
}
function textNodes(node) { var t = node.findAllWithCriteria ? node.findAllWithCriteria({ types: ["TEXT"] }) : []; if (node.type === "TEXT") t.push(node); return t; }
function fontsOf(t) { return t.fontName === figma.mixed ? t.getStyledTextSegments(["fontName"]).map(function (x) { return x.fontName; }) : [t.fontName]; }
async function preloadFonts(node) {
  var missing = [], texts = textNodes(node);
  for (var i = 0; i < texts.length; i++) {
    var fs = fontsOf(texts[i]);
    for (var j = 0; j < fs.length; j++) if (!(await loadFont(fs[j]))) { var n = fs[j].family + " " + fs[j].style; if (missing.indexOf(n) < 0) missing.push(n); }
  }
  return missing;
}
async function loadFonts(t) { var fs = fontsOf(t); for (var i = 0; i < fs.length; i++) await loadFont(fs[i]); }
// "Audi Type Variable" renders wrong in Figma → the installed static "Audi Type"
async function swapFonts(node) {
  var texts = textNodes(node);
  for (var i = 0; i < texts.length; i++) {
    var segs = texts[i].getStyledTextSegments(["fontName"]);
    for (var j = 0; j < segs.length; j++) {
      var to = STATIC_AUDI[segs[j].fontName.family];
      if (!to) continue;
      var nf = { family: to, style: segs[j].fontName.style };
      if (await loadFont(nf)) texts[i].setRangeFontName(segs[j].start, segs[j].end, nf);
    }
  }
}

// ---- layers ---------------------------------------------------------------
var ALIASES = { "Learn more": ["Learn more", "Button Label"], Kicker: ["Kicker", "Category"] };
function shown(n, root) { var p = n; while (p && p !== root) { if (!p.visible) return false; p = p.parent; } return true; }
// scope "Part" = an ancestor whose name contains Part, "^Part" = an ancestor named exactly Part
function hasAncestor(n, root, part) {
  var exact = part.charAt(0) === "^", want = exact ? part.slice(1) : part, p = n.parent;
  while (p && p !== root) { if (exact ? p.name === want : p.name.indexOf(want) >= 0) return true; p = p.parent; }
  return false;
}
function byPos(a, b) { var A = a.absoluteTransform, B = b.absoluteTransform; return Math.abs(A[1][2] - B[1][2]) > 4 ? A[1][2] - B[1][2] : A[0][2] - B[0][2]; }
// spec: "Name", "Scope>Name", "^Scope>Name@1" (2nd visible match), or "A|B" (first visible match)
function parseSpec(o) { var m = o.match(/^(.*)@(\d+)$/), idx = m ? Number(m[2]) : null; if (m) o = m[1]; var parts = o.split(">"); return { leaf: parts[parts.length - 1], scope: parts.length > 1 ? parts[0] : null, idx: idx }; }
function findLayer(inst, spec, kind) {
  var options = spec.split("|");
  var fallback = null;
  for (var o = 0; o < options.length; o++) {
    var sp = parseSpec(options[o]);
    var names = ALIASES[sp.leaf] || [sp.leaf];
    for (var i = 0; i < names.length; i++) {
      var hits = inst.findAll(function (x) { return x.name === names[i] && (kind === "TEXT" ? x.type === "TEXT" : "fills" in x && x.type !== "TEXT") && (!sp.scope || hasAncestor(x, inst, sp.scope)); });
      if (sp.idx !== null) { var vis = hits.filter(function (h) { return shown(h, inst); }).sort(byPos); if (vis[sp.idx]) return vis[sp.idx]; continue; }
      for (var h = 0; h < hits.length; h++) { if (shown(hits[h], inst)) return hits[h]; if (!fallback) fallback = hits[h]; }
    }
  }
  return kind === "TEXT" ? fallback : null;
}
function propKey(inst, layer) { var props = inst.componentProperties || {}; for (var k in props) if (props[k].type === "TEXT" && k.split("#")[0] === layer) return k; return null; }

// buttons: the visible button instances of a module (the ones with a Label property), top to bottom
function propOf(n, name, type) { var p = n.componentProperties || {}; for (var k in p) if (p[k].type === type && k.split("#")[0] === name) return k; return null; }
function buttonsOf(inst) {
  return inst.findAll(function (x) { return x.type === "INSTANCE" && !!propOf(x, "Label", "TEXT") && !hasAncestor(x, inst, "Tile ") && shown(x, inst); }).sort(byPos);
}
function btnIndex(layer) { var m = /^@btn:(\d+)$/.exec(layer); return m ? Number(m[1]) : -1; }
// a button the sync placed carries its index, so it stays found even while hidden
function btnMap(inst) { try { return JSON.parse(inst.getSharedPluginData(NS, "btns") || "{}"); } catch (e) { return {}; } }
function taggedButton(inst, i) { var id = btnMap(inst)[i]; return id ? inst.findOne(function (x) { return x.id === id; }) : null; }
function isTagged(inst, b) { var m = btnMap(inst); for (var k in m) if (m[k] === b.id) return true; return false; }
function setButton(inst, i, value) {
  var b = taggedButton(inst, i);
  if (!b) { b = buttonsOf(inst).filter(function (x) { return !isTagged(inst, x); })[0]; if (!b) return false; var m = btnMap(inst); m[i] = b.id; inst.setSharedPluginData(NS, "btns", JSON.stringify(m)); }
  var o = {}; o[propOf(b, "Label", "TEXT")] = value || " ";
  var st = propOf(b, "Show Text", "BOOLEAN"); if (st) o[st] = true;
  b.setProperties(o);
  b.visible = !!value;
  return true;
}
function getButton(inst, i) {
  var b = taggedButton(inst, i);
  if (!b) return undefined;
  return b.visible ? String(b.componentProperties[propOf(b, "Label", "TEXT")].value).trim() : "";
}

// every visible layer with that name gets the text (some modules repeat a layer, e.g. Description)
function allTextLayers(inst, layer) {
  var first = findLayer(inst, layer, "TEXT"); if (!first) return [];
  if (layer.indexOf("|") >= 0 || /@\d+$/.test(layer)) return [first];
  var sp = parseSpec(layer);
  var out = inst.findAll(function (x) { return x.type === "TEXT" && x.name === first.name && shown(x, inst) && (!sp.scope || hasAncestor(x, inst, sp.scope)); });
  return out.length ? out : [first];
}
async function setText(inst, layer, value) {
  var bi = btnIndex(layer);
  if (bi >= 0) return setButton(inst, bi, value);
  var many = allTextLayers(inst, layer);
  if (many.length > 1) { for (var m = 1; m < many.length; m++) await setOne(inst, many[m], value); }
  return setOne(inst, many[0] || null, value, layer);
}
async function setOne(inst, t, value, layer) {
  var v = value === "" ? " " : value;
  if (!t) { if (!layer) return false; var pk = propKey(inst, layer); if (pk) { var o = {}; o[pk] = v; inst.setProperties(o); return true; } return false; }
  var ref = t.componentPropertyReferences && t.componentPropertyReferences.characters;
  if (ref) {
    var owner = t.parent;
    while (owner && !(owner.type === "INSTANCE" && owner.componentProperties && owner.componentProperties[ref])) owner = owner.parent;
    if (owner) { var p = {}; p[ref] = v; owner.setProperties(p); }
  } else { await loadFonts(t); t.characters = v; }
  t.visible = value !== "";
  MAPPED[t.id] = true;
  return true;
}
function getText(inst, layer) {
  var bi = btnIndex(layer);
  if (bi >= 0) return getButton(inst, bi);
  var t = findLayer(inst, layer, "TEXT");
  if (t) return t.visible ? t.characters : "";
  var pk = propKey(inst, layer); return pk ? String(inst.componentProperties[pk].value) : undefined;
}
function imageHashOf(node) { var f = node && node.fills; if (!f || f === figma.mixed) return null; for (var i = 0; i < f.length; i++) if (f[i].type === "IMAGE") return f[i].imageHash; return null; }

var imageCache = {}, MAPPED = {};
async function coverPaint(node, hash, mediaId) {
  var f = (state.data && state.data.media && state.data.media[mediaId]) || { fx: 50, fy: 50 };
  try {
    var size = await figma.getImageByHash(hash).getSizeAsync();
    var w = node.width, h = node.height, sc = Math.max(w / size.width, h / size.height);
    var sw = Math.min(1, w / (size.width * sc)), sh = Math.min(1, h / (size.height * sc));
    var ox = Math.max(0, Math.min(1 - sw, f.fx / 100 - sw / 2)), oy = Math.max(0, Math.min(1 - sh, f.fy / 100 - sh / 2));
    return { type: "IMAGE", imageHash: hash, scaleMode: "CROP", imageTransform: [[sw, 0, ox], [0, sh, oy]] };
  } catch (e) { return { type: "IMAGE", imageHash: hash, scaleMode: "FILL" }; }
}
async function setImage(inst, layer, mediaId) {
  var node = findLayer(inst, layer, "IMAGE");
  if (!node || !mediaId) return null;
  var hash = imageCache[mediaId];
  if (!hash) {
    var bytes = await askUI("fetch-image", { url: mediaUrl(mediaId) });
    hash = figma.createImage(new Uint8Array(bytes)).hash;
    imageCache[mediaId] = hash;
  }
  node.fills = [await coverPaint(node, hash, mediaId)]; // replaces the sample image, never adds one
  return hash;
}

// sample texts of the library that never belong on a page: hidden when nothing maps onto them
var SAMPLE = /lorem ipsum|consectetuer|^\s*(label|button ?0?\d|link button ?0?\d|earn now|posting \d+|first item|badge name|campaigne)\s*$|optional caption|consumption & emission|^join the team$|unlock your exclusive|a unique racing experience|by joining, you.ll get|get a badge and win|a new era of electric|audi type wide|mit nur einem klick|\d+ days \d+ hrs|experience every second|team card name|get your badge/i;
function hideSamples(node) {
  var n = 0;
  var texts = node.findAll(function (x) { return x.type === "TEXT" && shown(x, node) && !MAPPED[x.id] && SAMPLE.test(x.characters); });
  texts.forEach(function (t) { t.visible = false; n++; });
  // a button without a visible label is hidden as a whole
  node.findAll(function (x) { return x.type === "INSTANCE" && !!propOf(x, "Label", "TEXT") && shown(x, node); }).forEach(function (b) {
    var tx = b.findAll(function (x) { return x.type === "TEXT"; });
    if (tx.length && !tx.some(function (x) { return shown(x, b) && x.characters.trim(); })) { b.visible = false; n++; }
  });
  return n;
}
var LS = String.fromCharCode(8232);
var normT = function (s) { return String(s == null ? "" : s).split(LS).join("\n").replace(/\r/g, "\n").replace(/[ \t]+\n/g, "\n").trim(); };

// writes the values; a field whose layer is not in this module (or shows something else) is untracked here,
// so a missing layer can never look like an edit made in Figma
async function applyFields(node, values, fresh) {
  var d = readData(node); if (!d || !d.fields) return [];
  d.last = d.last || {}; d.imgs = d.imgs || {};
  await preloadFonts(node);
  var done = [], keep = [];
  for (var i = 0; i < d.fields.length; i++) {
    var f = d.fields[i];
    if (!(f.key in values)) { keep.push(f); continue; }
    try {
      if (f.kind === "image") {
        var h = await setImage(node, f.layer, values[f.key]);
        if (h) { d.imgs[f.key] = { hash: h, id: values[f.key] }; d.last[f.key] = values[f.key]; keep.push(f); done.push(f.key); }
        else if (!fresh) keep.push(f);
        continue;
      }
      await setText(node, f.layer, values[f.key]);
      var rb = getText(node, f.layer);
      if (rb === undefined || normT(rb) !== normT(values[f.key])) { if (!fresh) keep.push(f); continue; }
      d.last[f.key] = rb; keep.push(f); done.push(f.key);
    } catch (e) { log("⚠ " + node.name + " · " + f.layer + ": " + (e && e.message ? e.message : e)); keep.push(f); }
  }
  d.fields = keep;
  if (fresh) {
    // buttons nothing maps onto are hidden too
    buttonsOf(node).forEach(function (b) { if (!isTagged(node, b)) b.visible = false; });
    hideSamples(node);
  }
  await swapFonts(node);
  writeData(node, d);
  return done;
}

// ---- Figma state ----------------------------------------------------------
function tagged(page) { return page.findAll(function (n) { return (n.type === "INSTANCE" || n.type === "FRAME") && !!n.getSharedPluginData(NS, "sync"); }); }
// desktop / mobile: from the page frame the node sits in
function bpOf(n) { var p = n; while (p && p.type !== "PAGE") { if (/^Desktop \//.test(p.name)) return "desktop"; if (/^Mobile \//.test(p.name)) return "mobile"; p = p.parent; } return "screen"; }
function collect(page) {
  var values = {}, changed = {}, nodes = {}, byKey = {}, uploads = [], texts = {};
  var all = tagged(page);
  for (var i = 0; i < all.length; i++) {
    var n = all[i], d = readData(n); if (!d) continue;
    if (d.type === "page") { if (n.name.indexOf("Mobile /") === 0) nodes[d.stagingId] = n.id; continue; }
    if (!d.fields) continue;
    for (var j = 0; j < d.fields.length; j++) {
      var f = d.fields[j]; (byKey[f.key] = byKey[f.key] || []).push(n);
      var v;
      if (f.kind === "image") {
        var layer = findLayer(n, f.layer, "IMAGE"), h = imageHashOf(layer), rec = (d.imgs || {})[f.key];
        if (!h || !rec) continue; // only images the sync placed can be "edited in Figma"
        if (rec.hash === h) v = rec.id; else { uploads.push({ node: n, field: f, layer: layer, hash: h }); v = "upload:" + h; }
      } else { v = getText(n, f.layer); if (v === undefined) continue; }
      var isChange = !d.last || d.last[f.key] !== v;
      if (f.kind !== "image") (texts[f.key] = texts[f.key] || []).push({ bp: bpOf(n), v: v, changed: isChange && !!d.last && f.key in d.last, name: n.name.split(" · ")[0], layer: f.layer });
      if (!(f.key in values) || (isChange && !changed[f.key])) { values[f.key] = v; if (isChange) changed[f.key] = true; }
    }
  }
  // the same field on another screen still shows the old text (e.g. changed on mobile, desktop not yet)
  var stale = [];
  for (var key in texts) {
    var t = texts[key], ch = t.filter(function (x) { return x.changed; })[0];
    if (!ch) continue;
    var old = t.filter(function (x) { return normT(x.v) !== normT(ch.v); });
    if (!old.length) continue;
    var to = []; old.forEach(function (x) { if (to.indexOf(x.bp) < 0) to.push(x.bp); });
    stale.push({ key: key, from: ch.bp, to: to, value: ch.v, layer: ch.layer, module: ch.name.replace(/^\d+ /, "") });
  }
  return { values: values, nodes: nodes, byKey: byKey, uploads: uploads, stale: stale };
}
async function runUploads(c) {
  var done = {};
  for (var i = 0; i < c.uploads.length; i++) {
    var u = c.uploads[i];
    if (c.values[u.field.key] !== "upload:" + u.hash) continue;
    if (!done[u.hash]) {
      progress("Uploading image " + (i + 1) + " / " + c.uploads.length + " to staging …");
      var raw = await figma.getImageByHash(u.hash).getBytesAsync();
      var enc = await askUI("encode-image", { bytes: Array.from(raw) });
      done[u.hash] = (await api("POST", { action: "upload", name: u.node.name.split(" · ")[0] + " " + u.field.layer, mime: "image/jpeg", data: enc.base64, alt: u.node.name })).id;
    }
    c.values[u.field.key] = done[u.hash];
    var d = readData(u.node); d.imgs = d.imgs || {}; d.imgs[u.field.key] = { hash: u.hash, id: done[u.hash] }; writeData(u.node, d);
  }
}
async function writeKeys(map, byKey) {
  var nodes = [], done = [];
  for (var k in map) (byKey[k] || []).forEach(function (n) { if (nodes.indexOf(n) < 0) nodes.push(n); });
  for (var i = 0; i < nodes.length; i++) (await applyFields(nodes[i], map)).forEach(function (k) { if (done.indexOf(k) < 0) done.push(k); });
  return done;
}
// ---- campaign of this board -------------------------------------------------
function fileKey() { try { return figma.fileKey || ""; } catch (e) { return ""; } }
function campaignOf(key) { return state.campaigns.filter(function (c) { return c.key === key; })[0] || null; }
function camp() { return (state.data && state.data.campaign) || campaignOf(state.campaign) || { key: state.campaign, name: state.campaign, root: "" }; }
function prefix() { return String(camp().key || "").toUpperCase(); }
// this file belongs to another campaign's board → no build, no sync here
function wrongBoard() {
  var c = campaignOf(state.campaign), fk = fileKey();
  return !!(c && c.figmaFile && fk && c.figmaFile !== fk);
}
async function loadCampaigns() {
  var res = await fetch(apiUrl("_campaigns")), j = await res.json();
  if (!res.ok) throw new Error(j && j.error ? j.error : "HTTP " + res.status);
  state.campaigns = j.campaigns || [];
  var fk = fileKey(), saved = figma.root.getSharedPluginData(NS, "campaign");
  var onBoard = fk ? state.campaigns.filter(function (c) { return c.figmaFile === fk; }) : [];
  var pick = null;
  if (onBoard.length === 1) pick = onBoard[0].key;
  else if (onBoard.length > 1) pick = (onBoard.filter(function (c) { return c.key === saved; })[0] || onBoard.filter(function (c) { return c.figmaPage === figma.currentPage.id; })[0] || onBoard[0]).key;
  else if (saved && campaignOf(saved)) pick = saved;
  else if (state.campaigns.length === 1) pick = state.campaigns[0].key;
  state.campaign = pick || "";
  if (pick) figma.root.setSharedPluginData(NS, "campaign", pick);
  sendCampaigns();
}
function sendCampaigns() {
  var c = campaignOf(state.campaign);
  send("campaigns", { list: state.campaigns.map(function (x) { return { key: x.key, name: x.name, figmaUrl: x.figmaUrl, board: !!x.figmaFile }; }), current: state.campaign, wrong: wrongBoard(), boardUrl: c ? c.figmaUrl : "", fileKnown: !!fileKey() });
}
async function goToCampaignPage() {
  if (wrongBoard()) throw new Error("This file is not the Figma board of " + camp().name + ". Open its board, or change the board on af1-ktulu.vercel.app/figma.");
  var id = state.data && state.data.campaign && state.data.campaign.figmaPage;
  var page = id ? await figma.getNodeByIdAsync(id) : null;
  if (!(page && page.type === "PAGE")) {
    // no page given (or not in this file): the campaign's own page, made once
    var name = "AF1 · " + camp().name;
    page = figma.root.children.filter(function (x) { return x.name === name; })[0] || null;
    if (!page) { page = figma.createPage(); page.name = name; }
  }
  if (figma.currentPage !== page) await figma.setCurrentPageAsync(page);
  return figma.currentPage;
}

// ---- local modules (not in the 07 library) --------------------------------
var localCache = {};
async function styleText(t, kind, size, color) {
  var fam = (await loadFont({ family: "Audi Type", style: kind })) ? "Audi Type" : "Inter";
  var st = fam === "Inter" ? (kind === "Extended Normal" ? "Bold" : "Regular") : kind;
  await loadFont({ family: fam, style: st });
  t.fontName = { family: fam, style: st }; t.fontSize = size; t.fills = color || GRAPH;
  t.lineHeight = { unit: "PERCENT", value: kind === "Extended Normal" ? 120 : 150 };
}
async function newText(parent, name, chars, kind, size, color) {
  var t = figma.createText(); parent.appendChild(t); await styleText(t, kind, size, color);
  t.name = name; t.characters = chars; t.layoutSizingHorizontal = "FILL"; t.textAutoResize = "HEIGHT"; return t;
}
async function localComponent(name) {
  if (localCache[name]) return localCache[name];
  var p = figma.root.children.filter(function (x) { return x.name === "AF1 Local Modules"; })[0];
  if (!p) { p = figma.createPage(); p.name = "AF1 Local Modules"; }
  await p.loadAsync();
  var c = p.findOne(function (n) { return n.type === "COMPONENT" && n.name === name; });
  if (c) return (localCache[name] = c);
  var desk = / Desktop$/.test(name), W = desk ? 1440 : 375, PX = desk ? 120 : 24, K = desk ? 1.4 : 1;
  c = figma.createComponent(); c.name = name; p.appendChild(c);
  c.layoutMode = "VERTICAL"; c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "FIXED"; c.resize(W, 100);
  c.paddingLeft = c.paddingRight = PX; c.itemSpacing = 16; c.x = p.children.length * 1600;
  if (/^List Section/.test(name)) {
    c.paddingTop = c.paddingBottom = desk ? 96 : 48; c.fills = CHALK; c.itemSpacing = 12;
    await newText(c, "Headline", "Headline", "Extended Normal", Math.round(28 * K)); await newText(c, "Subline", "Subline", "Wide Normal", Math.round(16 * K)); await newText(c, "Copy", "Copy", "Wide Normal", 14, MUTED);
    for (var i = 1; i <= 6; i++) {
      var it = autoLayout("VERTICAL"); it.name = "Item " + i; c.appendChild(it); it.layoutSizingHorizontal = "FILL"; it.paddingTop = 16; it.itemSpacing = 6;
      it.strokes = solid(0.878, 0.867, 0.867); it.strokeTopWeight = 1; it.strokeBottomWeight = 0; it.strokeLeftWeight = 0; it.strokeRightWeight = 0;
      await newText(it, "Item " + i + " · Label", "Item", "Extended Normal", 18); await newText(it, "Item " + i + " · Caption", "Caption", "Wide Normal", 14, MUTED);
    }
  } else if (/^iFrame/.test(name)) {
    c.paddingTop = c.paddingBottom = desk ? 320 : 240; c.fills = GRAPH; c.counterAxisAlignItems = "CENTER";
    await newText(c, "Label", "iFrame embed", "Extended Normal", 20, CHALK); await newText(c, "URL", "https://", "Wide Normal", 12, solid(0.7, 0.7, 0.7));
  }
  c.description = "AF1 " + name + " · built by AF1 Ktulu Sync (not in the 07 library yet).";
  return (localCache[name] = c);
}

// ---- build ----------------------------------------------------------------
// layout like 05-1 AF1 Design Loyalty · São Paulo: one section per landing page, stacked under the
// overview; DESKTOP on top, MOBILE (in a phone) below, the Team Card journey to the right of the phone
var SP_BG = solid(0.226, 0.233, 0.224), PHONE = solid(0.07, 0.07, 0.07);
var COL0 = 2040, COLW = 1840, ROWH = 1093;
var setCache = {};
async function variantOf(key, variant) {
  if (!setCache[key]) setCache[key] = await figma.importComponentSetByKeyAsync(key);
  var set = setCache[key];
  return (variant && set.children.filter(function (c) { return c.name === variant; })[0]) || set.defaultVariant;
}
function valuesOf(fields) { var o = {}; fields.forEach(function (f) { o[f.key] = f.value; }); return o; }
function tagFields(fields) { return fields.map(function (f) { return { key: f.key, layer: f.layer, kind: f.kind }; }); }
async function label(parent, chars, size, style, fills, x, y, w) {
  await loadFont({ family: "Inter", style: style });
  var t = figma.createText(); parent.appendChild(t); t.fontName = { family: "Inter", style: style }; t.fontSize = size; t.characters = chars; t.fills = fills || ON_DARK; t.x = x; t.y = y;
  if (w) { t.resize(w, t.height); t.textAutoResize = "HEIGHT"; }
  return t;
}
// arrow from a to b ([x,y] points, optional bend points between); the label sits over the middle
async function arrow(parent, pts, text, dash) {
  var v = figma.createVector(); parent.appendChild(v); v.name = "Arrow";
  var mx = Math.min.apply(null, pts.map(function (p) { return p[0]; })), my = Math.min.apply(null, pts.map(function (p) { return p[1]; }));
  await v.setVectorNetworkAsync({ vertices: pts.map(function (p, i) { return { x: p[0] - mx, y: p[1] - my, strokeCap: i === pts.length - 1 ? "ARROW_LINES" : "NONE" }; }), segments: pts.slice(1).map(function (_, i) { return { start: i, end: i + 1 }; }), regions: [] });
  v.x = mx; v.y = my; v.strokes = ON_DARK; v.strokeWeight = 4; v.dashPattern = dash || [];
  if (text) {
    var a = pts[pts.length - 2], b = pts[pts.length - 1], t = await label(parent, text, 20, "Bold", ON_DARK, 0, 0);
    t.name = "Arrow label";
    if (Math.abs(a[0] - b[0]) < 2) { t.x = a[0] + 14; t.y = (a[1] + b[1]) / 2 - t.height / 2; }
    else { t.x = (a[0] + b[0]) / 2 - t.width / 2; t.y = (a[1] + b[1]) / 2 - t.height - 12; }
  }
  return v;
}
// a stylized phone around a mobile screen
function phone(parent, child, x, y) {
  var ph = autoLayout("VERTICAL"); ph.name = "Phone"; parent.appendChild(ph);
  ph.paddingTop = ph.paddingBottom = ph.paddingLeft = ph.paddingRight = 12; ph.cornerRadius = 52; ph.fills = PHONE;
  ph.strokes = solid(0.32, 0.32, 0.32); ph.strokeWeight = 2; ph.strokeAlign = "OUTSIDE";
  ph.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.45 }, offset: { x: 0, y: 30 }, radius: 60, spread: 0, visible: true, blendMode: "NORMAL" }];
  ph.appendChild(child); child.cornerRadius = 40; child.clipsContent = true;
  var notch = figma.createRectangle(); ph.appendChild(notch); notch.name = "Notch"; notch.layoutPositioning = "ABSOLUTE";
  notch.resize(120, 30); notch.cornerRadius = 15; notch.fills = PHONE; notch.x = (375 + 24) / 2 - 60; notch.y = 24;
  ph.x = x - 12; ph.y = y - 12;
  return ph;
}

async function moduleInstance(b, desk) {
  var def = state.data.modules[b.blockType];
  if (!def) return null;
  if (desk) def = def.desktop;
  if (!def) return null;
  var variant = (def.variantByBg && b.bg && def.variantByBg[b.bg]) || def.variant;
  var comp = def.local ? await localComponent(def.local) : await variantOf(def.key, variant);
  var missing = await preloadFonts(comp);
  var inst = comp.createInstance();
  if (missing.length) await replaceMissingFonts(inst);
  return inst;
}
// a font that is not installed (e.g. Audi TRN) blocks moving the instance: swap it for Audi Type first
async function replaceMissingFonts(node) {
  var texts = textNodes(node);
  for (var i = 0; i < texts.length; i++) {
    var segs = texts[i].getStyledTextSegments(["fontName"]);
    for (var j = 0; j < segs.length; j++) {
      if (await loadFont(segs[j].fontName)) continue;
      var bold = /display|extended|bold/i.test(segs[j].fontName.family + " " + segs[j].fontName.style);
      var nf = { family: "Audi Type", style: bold ? "Extended Normal" : "Wide Normal" };
      if (!(await loadFont(nf))) { nf = { family: "Inter", style: bold ? "Bold" : "Regular" }; await loadFont(nf); }
      try { texts[i].setRangeFontName(segs[j].start, segs[j].end, nf); } catch (e) { log("⚠ font " + segs[j].fontName.family + ": " + (e && e.message ? e.message : e)); }
    }
  }
}

async function placeholder(b, desk) {
  await loadFont({ family: "Inter", style: "Semi Bold" });
  var f = autoLayout("VERTICAL"); f.paddingTop = f.paddingBottom = 40; f.paddingLeft = f.paddingRight = desk ? 120 : 24; f.fills = solid(0.878, 0.867, 0.867);
  var t = figma.createText(); t.fontName = { family: "Inter", style: "Semi Bold" }; t.fontSize = 18; t.characters = b.blockType + " · no " + (desk ? "desktop" : "mobile") + " module in the library yet"; f.appendChild(t);
  return f;
}

async function buildPageFrame(sec, p, x, y, desk) {
  var W = desk ? 1440 : 375;
  var fr = autoLayout("VERTICAL"); fr.name = (desk ? "Desktop / page:" : "Mobile / page:") + p.url; sec.appendChild(fr);
  fr.x = x; fr.y = y; fr.resize(W, 100); fr.counterAxisSizingMode = "FIXED"; fr.primaryAxisSizingMode = "AUTO"; fr.clipsContent = true; fr.fills = solid(1, 1, 1);
  writeData(fr, { type: desk ? "page-desktop" : "page", url: p.url, stagingId: p.id });
  for (var i = 0; i < p.blocks.length; i++) {
    var b = p.blocks[i], node = null;
    if (b.hidden) continue; // hidden in the CMS: not on the page, not in Figma
    try { node = await moduleInstance(b, desk); } catch (e) { log("⚠ /" + p.url + " · " + b.blockType + (desk ? " (desktop)" : "") + ": " + (e && e.message ? e.message : e)); }
    if (!node) node = await placeholder(b, desk); // never drop a module: a labelled frame keeps the page order
    fr.appendChild(node); node.layoutSizingHorizontal = "FILL";
    node.name = (i < 9 ? "0" : "") + (i + 1) + " " + b.blockType + " · " + b.id;
    writeData(node, { type: "block", pageId: p.id, blockId: b.id, blockType: b.blockType, badge: b.badge || "", fields: tagFields(b.fields), last: {}, imgs: {} });
    await applyFields(node, valuesOf(b.fields), true);
    // carousels / galleries: tiles without a CMS item are hidden (no sample images)
    if (/^(carousel|carousel-tags|gallery)$/.test(b.blockType)) {
      var nItems = 0;
      b.fields.forEach(function (f) { var m = /(?:ImageItem|Tile |Rectangle 16:9@)(\d+)/.exec(f.layer); if (m) nItems = Math.max(nItems, Number(m[1]) + (/@/.test(m[0]) ? 1 : 0)); });
      node.findAll(function (x) { var m = /^\.?(?:ImageItem|Grid Tile 0?)(\d+)$/.exec(x.name); return m && Number(m[1]) > nItems; }).forEach(function (x) { x.visible = false; });
    }
    if (b.blockType === "list-section") for (var k = 1; k <= 6; k++) { var lf = b.fields.filter(function (x) { return x.layer === "Item " + k + " · Label"; })[0]; var it = node.findOne(function (x) { return x.name === "Item " + k && x.type === "FRAME"; }); if (it) it.visible = !!(lf && lf.value); }
  }
  return fr;
}

// a small pill next to every module that only logged-in or logged-out users see
async function authPills(sec, fr, p, x0) {
  await loadFont({ family: "Inter", style: "Bold" });
  var kids = fr.children;
  for (var i = 0; i < kids.length; i++) {
    var d = readData(kids[i]); if (!d || d.type !== "block") continue;
    var b = p.blocks.filter(function (x) { return x.id === d.blockId; })[0];
    if (!b || !b.auth || b.auth === "PUBLIC") continue;
    var txt = b.auth === "LOGGED_OUT" ? "LOGGED OUT ONLY" : b.auth === "AUTHENTICATED" ? "LOGGED IN ONLY" : b.auth;
    var pill = autoLayout("HORIZONTAL"); pill.name = "Visibility · " + txt; pill.paddingTop = pill.paddingBottom = 6; pill.paddingLeft = pill.paddingRight = 10; pill.cornerRadius = 999;
    pill.fills = b.auth === "LOGGED_OUT" ? solid(0.9, 0.9, 0.9) : LAVA;
    var t = figma.createText(); t.fontName = { family: "Inter", style: "Bold" }; t.fontSize = 12; t.characters = txt; t.fills = b.auth === "LOGGED_OUT" ? GRAPH : solid(1, 1, 1); pill.appendChild(t);
    sec.appendChild(pill); pill.x = x0 - pill.width - 16; pill.y = fr.absoluteTransform[1][2] - sec.absoluteTransform[1][2] + kids[i].y + 16;
  }
}

function cleanTitle(t) { return String(t || "").replace(/^\s*[A-Z]{2,4}\s*\|\s*/, ""); }

// one Team Card state: a phone with the overlay, title + Payload note above
async function stateScreen(sec, card, s, n, x, y) {
  var comp = await variantOf(state.data.overlayKey, "State=" + s.state); await preloadFonts(comp);
  var inst = comp.createInstance(); inst.name = "Team Card Overlay · " + s.state;
  var scr = autoLayout("VERTICAL"); scr.name = "Mobile / " + n + " " + s.label; scr.fills = []; scr.appendChild(inst);
  var ph = phone(sec, scr, x, y);
  writeData(inst, { type: "card", badgeId: card.badgeId, state: s.state, fields: tagFields(s.fields), last: {}, imgs: {} });
  await applyFields(inst, valuesOf(s.fields), true);
  await label(sec, n + " · " + s.label, 28, "Bold", ON_DARK, x, y - 130);
  await label(sec, s.note, 18, "Regular", ON_DARK_MUTED, x, y - 86, 520);
  return { node: ph, x: x, y: y, w: 375, h: ph.height - 24, cy: y + (ph.height - 24) / 2 };
}
async function decision(sec, x, y) {
  var f = figma.createFrame(); sec.appendChild(f); f.name = "Decision · Logged in?"; f.resize(375, 200); f.x = x; f.y = y; f.fills = [];
  f.strokes = ON_DARK; f.strokeWeight = 3; f.dashPattern = [12, 8]; f.cornerRadius = 24;
  var a = await label(f, "Logged in /\nregistered?", 30, "Bold", ON_DARK, 0, 0); a.textAlignHorizontal = "CENTER"; a.x = (375 - a.width) / 2; a.y = 46;
  var b = await label(f, "System check when the card opens", 18, "Regular", ON_DARK_MUTED, 0, 0); b.x = (375 - b.width) / 2; b.y = 132;
  return { x: x, y: y, w: 375, h: 200, cy: y + 100 };
}
var R = function (n) { return [n.x + n.w + 20, n.cy]; }, L = function (n) { return [n.x - 20, n.cy]; };

// the card journey: (announced) → logged in? → no: logged out → login → not earned yet → earned (reward branch of this card) → back
async function journey(sec, card, from, Y) {
  var st = {}; card.states.forEach(function (s) { st[s.state] = s; });
  var col = 0, n = 2, right = COL0;
  var num = function () { return String(n++).padStart(2, "0"); };
  var X = function (c) { return COL0 + c * COLW; };
  var prev = from, prevLabel = "Card tapped";
  if (st.Announced) {
    var an = await stateScreen(sec, card, st.Announced, num(), X(col), Y);
    await arrow(sec, [R(from), [an.x - 20, an.cy]], "Card announced (countdown)");
    prev = an; prevLabel = "Card goes live"; col++;
  }
  var dc = await decision(sec, X(col), Y + 793 / 2 - 100);
  await arrow(sec, [R(prev), L(dc)], prevLabel);
  var lo = st["Logged Out"] ? await stateScreen(sec, card, st["Logged Out"], num(), X(col), Y + ROWH) : null;
  if (lo) await arrow(sec, [[dc.x + 187, dc.y + dc.h + 20], [dc.x + 187, lo.y - 150]], "No");
  col++;
  var df = await stateScreen(sec, card, st.Default, num(), X(col), Y);
  await arrow(sec, [R(dc), L(df)], "Yes");
  if (lo) await arrow(sec, [R(lo), [df.x - 20, df.cy + 120]], "After login / registration");
  col++;
  var earnedKeys = ["Link", "Download", "Code", "Raffle"].filter(function (k) { return st[k]; });
  var main = null;
  for (var i = 0; i < earnedKeys.length; i++) {
    var e = await stateScreen(sec, card, st[earnedKeys[i]], num(), X(col), Y + i * ROWH);
    await arrow(sec, [R(df), L(e)], i === 0 ? "Card earned (Reward Type)" : null);
    if (!main) main = e;
  }
  var last = col;
  if (st.Raffle) {
    var ent = st["Raffle Entered"] ? await stateScreen(sec, card, st["Raffle Entered"], num(), X(col + 1), Y) : null;
    if (ent) await arrow(sec, [R(main), L(ent)], "Entry submitted");
    var cl = st["Raffle Closed"] ? await stateScreen(sec, card, st["Raffle Closed"], num(), X(col + 1), Y + ROWH) : null;
    if (cl) await arrow(sec, [R(main), L(cl)], "After the end date", [16, 10]);
    last = col + 1;
  }
  if (st.Back) {
    var bk = await stateScreen(sec, card, st.Back, num(), X(last + 1), Y);
    await arrow(sec, [R(main || df), [bk.x - 20, bk.cy]], "Flip card");
    last++;
  }
  right = X(last) + 375;
  var rows = lo || (st["Raffle Closed"]) || earnedKeys.length > 1 ? Math.max(2, earnedKeys.length) : 1;
  return { right: right, bottom: Y + (rows - 1) * ROWH + 793 };
}

// one section per landing page; the activation page also gets the card journey
async function buildSection(p, num, card, group, isMain, mainUrl, ov) {
  var sec = figma.createSection(); sec.name = prefix() + " · " + String(num).padStart(2, "0") + " · " + cleanTitle(p.title);
  sec.fills = SP_BG; sec.x = -60000; sec.y = 0;
  writeData(sec, { type: "section", url: p.url, group: group.key });
  try {
    var title = String(num).padStart(2, "0") + " · " + cleanTitle(p.title), sub = "/" + p.url + (group.note ? "   ·   " + group.note : "");
    if (ov) { var back = await label(sec, "↑ Back to the overview", 24, "Semi Bold", LAVA, 200, 60); back.hyperlink = { type: "NODE", value: ov.id }; }
    progress("Building /" + p.url + " · desktop …");
    await label(sec, "DESKTOP", 24, "Bold", ON_DARK, 200, 140);
    await label(sec, title, 40, "Regular", ON_DARK, 200, 190);
    await label(sec, sub, 20, "Regular", ON_DARK_MUTED, 200, 250);
    var dk = await buildPageFrame(sec, p, 200, 320, true);
    await authPills(sec, dk, p, 200);
    progress("Building /" + p.url + " · mobile …");
    var Y = 320 + dk.height + 700;
    await label(sec, "MOBILE", 24, "Bold", ON_DARK, 200, Y - 180);
    await label(sec, title, 40, "Regular", ON_DARK, 200, Y - 130);
    var fr = await buildPageFrame(sec, p, 0, 0, false);
    var ph = phone(sec, fr, 200, Y);
    await authPills(sec, fr, p, 188);
    var right = 1640, bottom = Y + fr.height;
    var hasCard = card && p.blocks.some(function (b) { return b.badge === card.badgeId; });
    if (!isMain && hasCard) {
      var note = await label(sec, "Same Team Card as /" + mainUrl + " → its journey is shown there", 28, "Semi Bold", LAVA, COL0, Y, 1100);
      note.name = "Same card note";
      right = Math.max(right, COL0 + 1100);
    }
    if (isMain && card) {
      progress("Building /" + p.url + " · Team Card journey …");
      // the arrow starts at the module that carries the card
      var at = fr.children.filter(function (c) { var d = readData(c); return d && d.badge === card.badgeId; })[0];
      var cy = at ? Y + at.y + Math.min(at.height / 2, 400) : Y + 400;
      var j = await journey(sec, card, { x: 200, w: 375 + 12, cy: cy }, Y);
      await label(sec, "→ Team Card journey of " + (card.title || "this card") + " · only the reward branch it uses: " + ({ couponCode: "voucher code", raffleSignup: "raffle", downloadAsset: "download" }[card.rewardType] || (/download/i.test(card.rewardType || "") ? "download" : "no reward / link")), 28, "Regular", ON_DARK, COL0, 190);
      right = Math.max(right, j.right); bottom = Math.max(bottom, j.bottom);
    }
    sec.resizeWithoutConstraints(right + 300, bottom + 400);
    return sec;
  } catch (e) { sec.remove(); throw e; }
}

function overviewSection(page) { return page.findOne(function (n) { return n.type === "SECTION" && /Flow_Overview$/.test(n.name); }); }

// the overview on top, every section under it (like the São Paulo file)
function arrange(page, secs) {
  var ov = overviewSection(page), GAP = 1200;
  if (ov) { ov.x = 0; ov.y = 0; }
  var y = ov ? ov.height + GAP : 0;
  secs.forEach(function (s) { s.x = 0; s.y = y; y += s.height + GAP; });
}

// a contents list right of the overview: one link per section
async function contents(page, secs, ov) {
  page.children.filter(function (n) { return n.name === "AF1 Contents"; }).forEach(function (n) { n.remove(); });
  var f = autoLayout("VERTICAL"); f.name = "AF1 Contents"; page.appendChild(f);
  f.paddingTop = f.paddingBottom = 48; f.paddingLeft = f.paddingRight = 56; f.itemSpacing = 14; f.cornerRadius = 24; f.fills = SP_BG;
  await loadFont({ family: "Inter", style: "Bold" }); await loadFont({ family: "Inter", style: "Regular" });
  var h = figma.createText(); f.appendChild(h); h.fontName = { family: "Inter", style: "Bold" }; h.fontSize = 36; h.characters = "Contents"; h.fills = ON_DARK;
  var s2 = figma.createText(); f.appendChild(s2); s2.fontName = { family: "Inter", style: "Regular" }; s2.fontSize = 18; s2.characters = "Click a page to jump to its desktop, mobile and Team Card journey."; s2.fills = ON_DARK_MUTED;
  secs.forEach(function (s) {
    var t = figma.createText(); f.appendChild(t); t.fontName = { family: "Inter", style: "Regular" }; t.fontSize = 26;
    t.characters = s.name.replace(/^[A-Z0-9-]+ · /, ""); t.fills = ON_DARK; t.textDecoration = "UNDERLINE"; t.hyperlink = { type: "NODE", value: s.id };
  });
  f.x = ov ? ov.x + ov.width + 300 : -1200; f.y = 0;
  return f;
}

// overview titles → the screens, tiles → the activation page
var TILE = { tile_adidas: "adidas-singapore-special-drop", tile_rs5: "audi-rs5-singapores-most-wanted", tile_helmets: "mini-helmets", tile_run: "adidas-5km-run", tile_mascot: "spot-the-driver", tile_paulaner: "paulaner-pro", tile_livery: "reveal-the-livery", tile_revolut: "revolut-titanium", hub_vegas_tile: "vegas-grand-prize-2026", hub_hero: "" };
async function linkOverview(page, secByUrl) {
  var ov = overviewSection(page); if (!ov) return 0;
  var n = 0;
  var boxes = ov.children.filter(function (c) { return c.type === "FRAME"; });
  for (var i = 0; i < boxes.length; i++) {
    var c = boxes[i], url = null;
    if (c.name.indexOf("page:") === 0) url = c.name.slice(5);
    else if (c.name in TILE && camp().root === "unlock-singapore") url = TILE[c.name] ? "unlock-singapore/" + TILE[c.name] : "unlock-singapore";
    if (!url || !secByUrl[url]) continue;
    var texts = c.findAll(function (x) { return x.type === "TEXT"; });
    var title = texts.filter(function (x) { return x.name === "Title"; })[0] || texts.filter(function (x) { return x.fontName !== figma.mixed && /Bold/.test(x.fontName.style); })[0] || texts[0];
    if (!title) continue;
    await loadFonts(title);
    title.hyperlink = { type: "NODE", value: secByUrl[url].id }; title.textDecoration = "UNDERLINE"; n++;
  }
  return n;
}

async function buildAll() {
  state.data = await api("GET");
  var page = await goToCampaignPage();
  // a full rebuild: remove every screen section (the overview stays)
  page.children.filter(function (n) { return n.type === "SECTION" && !/Flow_Overview$/.test(n.name); }).forEach(function (n) { n.remove(); });
  var ov = overviewSection(page);
  var d = state.data, num = 0, secs = [], secByUrl = {}, built = 0;
  // sitemap order: hub column first, then the activations (activation page, then its QR page)
  var order = d.groups.filter(function (g) { return g.col === "center"; }).concat(d.groups.filter(function (g) { return g.col !== "center"; }));
  for (var gi = 0; gi < order.length; gi++) {
    var g = order[gi], card = d.cards.filter(function (c) { return c.group === g.key; })[0];
    for (var ui = 0; ui < g.urls.length; ui++) {
      var p = d.pages.filter(function (x) { return x.url === g.urls[ui]; })[0]; if (!p) continue;
      num++;
      try {
        var s = await buildSection(p, num, card, g, ui === 0, g.urls[0], ov);
        secByUrl[p.url] = s; built++; secs.push(s);
      } catch (e) { log("⚠ /" + p.url + " not built: " + (e && e.message ? e.message : e)); }
    }
  }
  arrange(page, secs);
  // QR pages: their note links to the activation page
  page.findAll(function (n) { return n.type === "TEXT" && n.name === "Same card note"; }).forEach(function (t) {
    var m = t.characters.match(/\/([^ ]+) →/); if (m && secByUrl[m[1]]) t.hyperlink = { type: "NODE", value: secByUrl[m[1]].id };
  });
  var links = await linkOverview(page, secByUrl);
  await contents(page, secs, ov);
  if (ov) figma.viewport.scrollAndZoomIntoView([ov]);
  log("Built " + built + " pages (desktop + mobile), linked " + links + " overview titles.");
  await api("POST", { action: "ack-command" });
  progress("Recording the state …");
  await sync({}, null, true);
}

// ---- sync ----------------------------------------------------------------
async function check() {
  sendCampaigns();
  if (!state.campaign) { send("checked", { pick: true }); return null; }
  if (wrongBoard()) { send("checked", { wrong: true, name: camp().name, boardUrl: (campaignOf(state.campaign) || {}).figmaUrl }); return null; }
  state.data = await api("GET");
  var page = await goToCampaignPage(), c = collect(page);
  var forCheck = {}; for (var k in c.values) if (String(c.values[k]).indexOf("upload:") !== 0) forCheck[k] = c.values[k];
  var pre = await api("POST", { action: "check", figma: forCheck });
  var builtPages = Object.keys(c.nodes).length;
  send("checked", {
    pages: state.data.pages.length, built: builtPages, command: state.data.command,
    diffs: pre.diffs.filter(function (d) { return d.state !== "missing-in-figma"; }), uploads: c.uploads.length,
    stale: c.stale, campaign: camp().name,
    inSync: pre.inSync, total: pre.total, pending: Object.keys(state.data.pending || {}).length, user: state.data.user, syncedAt: pre.syncedAt, live: state.live,
  });
  return pre;
}

// the stale screens take the changed text, then the change goes to the CMS
async function copyAcross(keys) {
  var page = await goToCampaignPage(), c = collect(page), map = {};
  c.stale.forEach(function (x) { if (!keys || keys.indexOf(x.key) >= 0) map[x.key] = x.value; });
  var w = await writeKeys(map, c.byKey);
  log("Copied " + w.length + " text(s) to the other screen.");
  await sync({}, Object.keys(map));
}

// only: list of field keys to apply (null = everything that has a newer side)
async function sync(decisions, only, quiet) {
  if (!state.data) state.data = await api("GET");
  var page = await goToCampaignPage(), c = collect(page);
  var pend = state.data.pending || {};
  if (Object.keys(pend).length) {
    var w = await writeKeys(pend, c.byKey);
    await api("POST", { action: "ack", keys: Object.keys(pend) });
    if (w.length) log("Took " + w.length + " change(s) from the AF1 Tool into Figma.");
    c = collect(page);
  }
  if (c.uploads.length) await runUploads(c);
  var body = { action: "sync", figma: c.values, nodes: c.nodes, decisions: decisions || {} };
  if (only) body.only = only;
  var r = await api("POST", body);
  // what went to the CMS also goes onto every other screen with that field (mobile → desktop and back)
  var across = {}, nAcross = 0;
  r.toCms.forEach(function (d) { if ((c.byKey[d.key] || []).length > 1) { across[d.key] = d.figma || ""; nAcross++; } });
  // already in the CMS (synced before this existed): the old screen just catches up
  var openKeys = {}; r.open.forEach(function (d) { openKeys[d.key] = true; });
  (c.stale || []).forEach(function (x) { if (!(x.key in across) && !openKeys[x.key] && String(c.values[x.key]) === String(x.value)) { across[x.key] = x.value; nAcross++; } });
  if (nAcross) { var wa = await writeKeys(across, c.byKey); if (wa.length) log("Copied " + wa.length + " change(s) to the other screen (mobile ↔ desktop)."); }
  var map = {}; r.toFigma.forEach(function (d) { map[d.key] = d.cms || ""; });
  var w2 = await writeKeys(map, c.byKey);
  if (r.toFigma.length) await api("POST", { action: "ack", keys: r.toFigma.map(function (d) { return d.key; }) });
  state.data = null;
  if (!quiet || r.toCms.length || w2.length) send("synced", { toCms: r.toCms.length, toFigma: w2.length, open: r.open.length, written: r.written });
  return r;
}

setInterval(async function () {
  if (!state.live || state.busy || !state.token || !state.campaign || wrongBoard()) return;
  state.busy = true;
  try {
    // a rebuild queued in the AF1 Tool runs even while the plugin stays open
    var d0 = await api("GET"); state.data = d0;
    if (d0.command && /^build/.test(d0.command.command)) { log("A full rebuild was requested in the AF1 Tool, building now …"); await buildAll(); await check(); return; }
    var r = await sync({}, null, true); if (r.toCms.length || r.toFigma.length) await check();
  }
  catch (e) { /* stay quiet in the background */ }
  finally { state.busy = false; }
}, 20000);

figma.ui.onmessage = async function (msg) {
  if (msg.reqId && waits[msg.reqId]) { var w = waits[msg.reqId]; delete waits[msg.reqId]; if (msg.error) w.reject(new Error(msg.error)); else w.resolve(msg.result); return; }
  if (msg.type === "live") { state.live = !!msg.on; await figma.clientStorage.setAsync("live", state.live); return; }
  if (state.busy) { log("Still working, one moment."); return; }
  state.busy = true;
  try {
    if (msg.type === "init") {
      state.token = (await figma.clientStorage.getAsync("token")) || "";
      var lv = await figma.clientStorage.getAsync("live"); state.live = lv === undefined ? true : !!lv;
      send("token", { token: state.token });
      if (state.token) await loadCampaigns();
      if (state.token && state.campaign && !wrongBoard()) {
        var pre = await api("GET"); state.data = pre;
        if (pre.command && /^build/.test(pre.command.command)) { log("A full rebuild was requested in the AF1 Tool, building now …"); await buildAll(); }
        await check();
      }
    }
    if (msg.type === "save-token") { state.token = msg.token.trim(); await figma.clientStorage.setAsync("token", state.token); await loadCampaigns(); await check(); }
    if (msg.type === "set-campaign") { state.campaign = msg.key; state.data = null; figma.root.setSharedPluginData(NS, "campaign", msg.key); await check(); }
    if (msg.type === "copy-across") { await copyAcross(msg.keys); await check(); }
    if (msg.type === "check") await check();
    if (msg.type === "build") { await buildAll(); await check(); }
    if (msg.type === "apply") { await sync(msg.decisions, msg.only); await check(); }
  } catch (e) {
    send("error", { msg: e && e.message ? e.message : String(e) });
  } finally { state.busy = false; progress(""); }
};
