// Excel time-chainage workbook import in the browser (SheetJS for cells, JSZip for the drawn shapes).
// Sheets are recognised by header rows: activity registers (one data set each), assets, productivities, assumptions,
// and the drawn chart sheet (section row, full-width bands and milestone lines drawn as shapes).
import { makeActivity, makeStyle, newId, newProject, fmtT, DAY } from "./model.js";

const PALETTE = ["#002060", "#00B0F0", "#FFC000", "#92D050", "#C00000", "#C65911", "#7030A0", "#548235", "#FF66CC",
  "#996633", "#404040", "#1F8A86", "#8B0000", "#7F7F7F", "#E2C46B", "#4F81BD", "#A33F7A", "#2F8A55"];
const norm = v => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const DATE_RE = /(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{4})/i;
const serialToMs = n => Math.round((Date.UTC(1899, 11, 30) + n * DAY) / 60000) * 60000; // Excel day number -> wall-clock ms
const dayStr = ms => new Date(ms).toISOString().slice(0, 10);

class Sheet {
  constructor(name, ws) {
    this.name = name; this.ws = ws;
    const r = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
    this.maxRow = r.e.r + 1; this.maxCol = r.e.c + 1;
  }
  cell(r, c) { const x = this.ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })]; return x ? x : null; }
  v(r, c) { const x = this.cell(r, c); return x ? x.v : null; }
  isDate(r, c) { const x = this.cell(r, c); return !!x && x.t === "n" && !!x.z && XLSX.SSF.is_date(x.z); }
  date(r, c) { const x = this.cell(r, c); if (!x) return null; if (x.t === "n") return serialToMs(x.v); if (x.t === "d") return Date.UTC(x.v.getFullYear(), x.v.getMonth(), x.v.getDate()); return null; }
  rowHeightPt(r) { const rows = this.ws["!rows"] || []; return (rows[r - 1] && (rows[r - 1].hpt || rows[r - 1].hpx * 0.75)) || 15; }
  merges() { return (this.ws["!merges"] || []).map(m => ({ minRow: m.s.r + 1, minCol: m.s.c + 1, maxRow: m.e.r + 1, maxCol: m.e.c + 1 })); }
}

function findHeader(sh, required, maxRows = 12) {
  for (let r = 1; r <= Math.min(sh.maxRow, maxRows); r++) {
    const cells = {};
    for (let c = 1; c <= Math.min(sh.maxCol, 40); c++) cells[c] = norm(sh.v(r, c));
    const ok = required.every(al => Object.values(cells).some(t => t && al.some(a => t === a || t.startsWith(a))));
    if (ok) return [r, cells];
  }
  return [null, null];
}
const colOf = (cells, ...al) => { for (const [c, t] of Object.entries(cells)) if (t && al.some(a => t === a || t.startsWith(a))) return +c; return null; };

function smartTitle(s) { return s.split(" ").map(w => (w.length <= 3 && /^[A-Z]+$/.test(w) && !["AND", "THE", "FOR", "ALL", "OFF"].includes(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(" "); }
function styleKey(name) {
  let base = name.trim().split(/\s+[–—-]\s+/)[0].replace(/\s*\(.*?\)\s*/g, " ").trim();
  const words = base.replace(/[^A-Za-z0-9 ]/g, " ").toUpperCase().split(/\s+/).filter(w => w && !["AND", "THE", "OF", "CREW"].includes(w));
  let code = "";
  for (const w of words) { if (code.length + w.length + (code ? 1 : 0) > 16) break; code = code ? code + "_" + w : w; }
  return [code || (words[0] || "ACT").slice(0, 16), base === base.toUpperCase() ? smartTitle(base) : base];
}

export async function importWorkbook(buf, discipline = "rail") {
  const bytes = new Uint8Array(buf);
  const wb = XLSX.read(bytes, { type: "array", cellDates: false, cellNF: true, cellStyles: true });
  const sheets = wb.SheetNames.map(n => new Sheet(n, wb.Sheets[n]));
  const registers = [], assets = [], prods = [], notes = {}, charts = [];
  for (const sh of sheets) {
    let [hr, cells] = findHeader(sh, [["id"], ["start"], ["finish"], ["ch from", "chainage from", "start chainage", "from ch"], ["ch to", "chainage to", "end chainage", "to ch"]]);
    if (hr) { let title = sh.name; outer: for (let r = 1; r < hr; r++) for (let c = 1; c <= 3; c++) if (sh.v(r, c)) { title = String(sh.v(r, c)); break outer; } registers.push({ sh, hr, cells, title }); continue; }
    [hr, cells] = findHeader(sh, [["type"], ["chainage from", "ch from"]]);
    if (hr) { assets.push({ sh, hr, cells }); continue; }
    [hr, cells] = findHeader(sh, [["activity"], ["crew"], ["productivity"]]);
    if (hr) { prods.push({ sh, hr, cells }); continue; }
    if (findHeader(sh, [["section"]], 6)[0] && findHeader(sh, [["km (start of column)", "km"]], 10)[0]) { charts.push(sh); continue; }
    if (sh.maxCol <= 4 && sh.name.toLowerCase().includes("assumption")) {
      notes[sh.name] = [];
      for (let r = 2; r <= sh.maxRow; r++) if (sh.v(r, 2) && sh.v(r, 3)) notes[sh.name].push([String(sh.v(r, 2)), String(sh.v(r, 3))]);
    }
  }
  if (!registers.length) throw new Error("No activity register found. A register needs the columns ID, Start, Finish, CH from and CH to.");

  // ---- activities
  const datasets = [], raw = [];
  for (const { sh, hr, cells, title } of registers) {
    const c = { id: colOf(cells, "id"), name: colOf(cells, "activity", "name", "description"), leg: colOf(cells, "leg", "direction"), start: colOf(cells, "start"),
      finish: colOf(cells, "finish"), ch0: colOf(cells, "ch from", "chainage from", "start chainage", "from ch"), ch1: colOf(cells, "ch to", "chainage to", "end chainage", "to ch"),
      qty: colOf(cells, "qty", "quantity"), stand: colOf(cells, "stand-down", "standdown"), basis: colOf(cells, "source", "basis") };
    const nm = title.replace(/^activity register\s*[—–-]\s*/i, "").trim();
    const ds = { id: newId("ds_"), name: nm === nm.toUpperCase() ? nm.toLowerCase().replace(/(^|[\s:(])\S/g, s => s.toUpperCase()) : nm, source: `excel:${sh.name}`, notes: [] };
    const key = sh.name.toLowerCase().replace("activity register", "").replace(/^[\s-]+|[\s-]+$/g, "");
    for (const [nt, rs] of Object.entries(notes)) if (nt.toLowerCase().replace("assumptions", "").replace(/^[\s-]+|[\s-]+$/g, "") === key) ds.notes = rs;
    datasets.push(ds);
    for (let r = hr + 1; r <= sh.maxRow; r++) {
      const g = k => (c[k] ? sh.v(r, c[k]) : null);
      const s = c.start ? sh.date(r, c.start) : null, f = c.finish ? sh.date(r, c.finish) : null;
      if (!g("id") || s == null || f == null || g("ch0") == null || g("ch1") == null) continue;
      raw.push({ ds: ds.id, id: String(g("id")), name: String(g("name") || g("id")), leg: String(g("leg") || ""), start: s, finish: f, ch0: +g("ch0"), ch1: +g("ch1"),
        qty: g("qty"), stand: g("stand"), basis: g("basis") });
    }
  }
  const big = Math.max(...raw.map(x => Math.max(Math.abs(x.ch0), Math.abs(x.ch1))));
  const unit = big < 5000 ? "km" : "m", k = unit === "km" ? 1000 : 1;

  // ---- styles by activity family
  const families = {}, byLabel = {};
  for (const x of raw) {
    let [code, label] = styleKey(x.name);
    if (!(label in byLabel)) { const base = code; let n = 2; while (families[code]) code = `${base.slice(0, 14)}_${n++}`; byLabel[label] = code; }
    code = byLabel[label];
    (families[code] = families[code] || { name: label, rows: [] }).rows.push(x); x.style = code;
  }
  const bandLeg = l => ["interface", "all crews"].includes(norm(l));
  let styles = Object.entries(families).map(([code, f], i) => {
    const stat = f.rows.every(x => Math.abs(x.ch1 - x.ch0) * k < 1 || ["static", "corridor-wide", "interface", "all crews"].includes(norm(x.leg)));
    return makeStyle(code, f.name, stat ? "block" : "line", PALETTE[i % PALETTE.length]);
  });
  const acts = [];
  for (const x of raw) {
    if (bandLeg(x.leg) && Math.abs(x.ch1 - x.ch0) * k > 1) continue; // interface / stand-down rows become time markers
    const a = makeActivity(x.ds, x.id, x.name, fmtT(x.start), fmtT(x.finish + DAY), x.ch0 * k, x.ch1 * k, x.style,
      { notes: [x.leg, x.qty, x.basis].filter(v => v && String(v) !== "—").join(" · ") });
    const days = (x.finish - x.start) / DAY + 1, len = Math.abs(x.ch1 - x.ch0) * k;
    if (len > 1) { a.qty = Math.round(len * 10) / 10; a.qty_unit = "m"; a.rate = Math.round((len / days) * 10) / 10; a.rate_unit = "m/day"; }
    if (x.stand) a.notes = (a.notes ? a.notes + " · " : "") + `stand-downs ${x.stand}`;
    acts.push(a);
  }

  // ---- locations
  const TYPE_MAP = [["loop", "loop"], ["level crossing", "lx"], ["pedestrian", "ped"], ["bridge", "bridge"], ["culvert", "culvert"], ["turnout", "turnout"], ["track", "zone"], ["station", "station"], ["limit", "limit"]];
  const locations = [];
  for (const { sh, hr, cells } of assets) {
    const ct = colOf(cells, "type"), cn = colOf(cells, "name", "description"), c0 = colOf(cells, "chainage from", "ch from"), c1 = colOf(cells, "chainage to", "ch to"), cw = colOf(cells, "works", "notes", "scope");
    for (let r = hr + 1; r <= sh.maxRow; r++) {
      const v0 = sh.v(r, c0); if (typeof v0 !== "number") continue;
      const tn = norm(sh.v(r, ct)), tid = (TYPE_MAP.find(([key]) => tn.includes(key)) || [0, "other"])[1], v1 = c1 ? sh.v(r, c1) : null;
      locations.push({ id: newId("l_"), name: String(sh.v(r, cn) || tn), ch_m: v0 * k, to_m: typeof v1 === "number" ? v1 * k : null, type: tid, row: null,
        label: ["loop", "lx", "station", "limit", "zone"].includes(tid), grid: ["loop", "limit"].includes(tid), notes: cw ? String(sh.v(r, cw) || "") : "" });
    }
  }

  // ---- productivities
  const productivities = [];
  for (const { sh, hr, cells } of prods) {
    const cA = colOf(cells, "activity"), cC = colOf(cells, "crew"), cP = colOf(cells, "productivity"), cPn = colOf(cells, "productivity no"), cQ = colOf(cells, "qty"),
      cQn = colOf(cells, "qty no"), cSh = colOf(cells, "no. shifts", "shifts"), crewCols = Object.entries(cells).filter(([, t]) => t === "crew").map(([c]) => +c), cCrew = crewCols[1];
    for (let r = hr + 1; r <= sh.maxRow; r++) {
      const act = sh.v(r, cA); if (!act) continue;
      productivities.push({ id: newId("p_"), activity: String(act), resources: String(sh.v(r, cC) || ""), rate_text: String(sh.v(r, cP) || ""), rate: cPn ? sh.v(r, cPn) : null,
        qty_text: String(sh.v(r, cQ) || ""), qty: cQn ? sh.v(r, cQn) : null, crew: cCrew ? String(sh.v(r, cCrew) || "") : "", shifts: cSh ? sh.v(r, cSh) : null });
    }
  }

  // ---- chart sheet: sections, drawn bands and milestones
  let sections = [], markers = [], title = null;
  if (charts.length) {
    const sh = charts[0]; title = sh.v(1, 2);
    sections = readSections(sh, locations, k);
    markers = await drawnMarkers(bytes, sh);
  }
  if (!markers.length) for (const x of raw) if (bandLeg(x.leg)) markers.push({ id: newId("t_"), label: x.name, kind: x.name.toLowerCase().includes("stand") ? "shutdown" : "band",
    start: fmtT(x.start), finish: fmtT(x.finish + DAY), ch0_m: null, ch1_m: null, colour: "#808080" });
  for (const x of raw) {  // short band rows (a stand-down) take their exact dates from the register
    if (!bandLeg(x.leg) || (x.finish - x.start) / DAY > 31) continue;
    const first = x.name.split(" ")[0].toLowerCase();
    markers.forEach(m => { if (m.kind !== "milestone" && m.label.toLowerCase().startsWith(first)) { m.start = fmtT(x.start); m.finish = fmtT(x.finish + DAY); } });
  }
  const used = new Set(acts.map(a => a.style)); styles = styles.filter(s => used.has(s.code));

  // ---- assemble
  const chLo = Math.min(...acts.map(a => Math.min(a.ch0_m, a.ch1_m))), chHi = Math.max(...acts.map(a => Math.max(a.ch0_m, a.ch1_m)));
  const tLo = acts.map(a => a.start).sort()[0].slice(0, 10);
  let tHi = acts.map(a => a.finish).sort().at(-1).slice(0, 10);
  if (markers.length) {
    const cutoff = dayStr(Date.parse(tHi) + 45 * DAY);
    markers = markers.filter(m => m.kind === "milestone" || m.start.slice(0, 10) <= cutoff);
    for (const m of markers) { const e = dayStr(Date.parse(m.start.slice(0, 10)) + 7 * DAY); if (e > tHi) tHi = e; }
  }
  const step = unit === "km" ? 1000 : 100;
  const p = newProject(String(title || registers[0].title).slice(0, 120), discipline, Math.floor(chLo / (10 * step)) * 10 * step, Math.ceil(chHi / (10 * step)) * 10 * step, tLo, tHi, unit);
  p.meta.title = String(title || p.name).split(/\s+[—–]\s+/)[0].slice(0, 80); p.meta.subtitle = String(title || "");
  Object.assign(p.chainage, { major_m: 10 * step, minor_m: unit === "km" ? step : 50, decimals: unit === "km" ? 3 : 0, snap_m: 10 });
  const t0 = Date.parse(tLo), wd = (new Date(t0).getUTCDay() + 6) % 7;
  p.time.start = dayStr(t0 - wd * DAY); p.time.px_per_day = 1.6;
  if (sections.length) { sections[0].from_m = chLo; sections.at(-1).to_m = chHi; }
  Object.assign(p, { styles, datasets, activities: acts, locations, sections, time_markers: markers, productivities });
  p.view.main_dataset = datasets[0].id; p.view.compare_dataset = datasets[1] ? datasets[1].id : null;
  if (!locations.some(l => l.type === "limit")) for (const v of [chLo, chHi]) p.locations.push({ id: newId("l_"), name: "Limit", ch_m: v, to_m: null, type: "limit", row: null, label: true, grid: true, notes: "From the activity extents" });
  const nb = p.page.blocks.at(-1);
  if (datasets[0].notes.length) Object.assign(nb, { title: "Assumptions", shrink: true, text: datasets[0].notes.map(([a, b]) => `${a}: ${b}`).join("\n") });
  return p;
}

function readSections(sh, locations, k) {
  let secRow = null, kmRow = null;
  for (let r = 1; r < 12; r++) { const l = norm(sh.v(r, 2)); if (l === "section") secRow = r; if (l.startsWith("km (start of column)")) kmRow = r; }
  if (!secRow || !kmRow) return [];
  const km = {};
  for (let c = 3; c <= sh.maxCol; c++) { const v = sh.v(kmRow, c); if (typeof v === "number") km[c] = v; }
  const cols = Object.keys(km).map(Number); if (!cols.length) return [];
  const out = [];
  for (const m of sh.merges().filter(m => m.minRow === secRow).sort((a, b) => a.minCol - b.minCol)) {
    const name = sh.v(secRow, m.minCol); if (!name || !(m.minCol in km)) continue;
    out.push({ id: newId("s_"), name: String(name).toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase()), from_m: km[m.minCol] * k, to_m: ((km[m.maxCol] ?? km[Math.max(...cols)]) + 1) * k });
  }
  const places = locations.filter(l => ["loop", "station", "limit"].includes(l.type));
  for (let i = 0; i < out.length - 1; i++) {
    const left = out[i].name.split(/\s*[–—-]\s*/).at(-1).toLowerCase(), word = left.split(" ")[0];
    const hit = word && places.find(l => l.name.toLowerCase().includes(word));
    if (hit) out[i].to_m = out[i + 1].from_m = hit.ch_m;
  }
  return out;
}

async function drawnMarkers(bytes, sh) {
  if (typeof JSZip === "undefined") return [];
  let zip; try { zip = await JSZip.loadAsync(bytes); } catch (e) { return []; }
  const rd = async n => (zip.file(n) ? zip.file(n).async("string") : null);
  // sheet name -> sheet file -> drawing file
  const wbx = await rd("xl/workbook.xml"), wbr = await rd("xl/_rels/workbook.xml.rels"); if (!wbx || !wbr) return [];
  const esc = sh.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const rid = (new RegExp(`<sheet[^>]*name="${esc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*r:id="(\\w+)"`).exec(wbx) || new RegExp(`<sheet[^>]*r:id="(\\w+)"[^>]*name="${esc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).exec(wbx) || [])[1];
  const target = rid && (new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(wbr) || new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(wbr) || [])[1];
  if (!target) return [];
  const sheetPath = "xl/" + target.replace(/^\/?xl\//, "").replace(/^\//, ""), sheetFile = sheetPath.split("/").pop();
  const srels = await rd(sheetPath.replace(sheetFile, `_rels/${sheetFile}.rels`)); if (!srels) return [];
  const dm = /Target="\.\.\/drawings\/(drawing\d+\.xml)"/.exec(srels); if (!dm) return [];
  const xml = await rd(`xl/drawings/${dm[1]}`); if (!xml) return [];
  // time grid: "Week commencing" column, first date row and rows per week
  let head = null;
  for (let r = 1; r < 40 && !head; r++) for (let c = 1; c < 4; c++) if (norm(sh.v(r, c)).startsWith("week commencing")) { head = [r, c]; break; }
  if (!head) return [];
  const dateRows = []; for (let r = head[0] + 1; r <= sh.maxRow; r++) if (sh.isDate(r, head[1])) dateRows.push(r);
  if (dateRows.length < 2) return [];
  const r0 = dateRows[0], perWeek = dateRows[1] - dateRows[0], d0 = sh.date(r0, head[1]);
  const when = (row0, off) => { const r = row0 + 1; return d0 + (7 * DAY * ((r - r0) + off / (sh.rowHeightPt(r) * 12700))) / perWeek; };
  const pos = /<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>(-?\d+)<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row><xdr:rowOff>(-?\d+)<\/xdr:rowOff><\/xdr:from><xdr:to><xdr:col>(\d+)<\/xdr:col><xdr:colOff>(-?\d+)<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row><xdr:rowOff>(-?\d+)<\/xdr:rowOff>/;
  const items = [];
  for (const a of xml.match(/<xdr:twoCellAnchor[\s\S]*?<\/xdr:twoCellAnchor>/g) || []) {
    const m = pos.exec(a); if (!m) continue;
    const g = m.slice(1).map(Number);
    const text = (a.match(/<a:t>([^<]*)<\/a:t>/g) || []).map(t => t.slice(5, -6)).join("").replace(/&amp;/g, "&").trim();
    const geom = (/prst="(\w+)"/.exec(a) || [])[1] || "", colr = (/srgbClr val="(\w+)"/.exec(a) || [])[1];
    items.push({ c0: g[0], r0: g[2], o0: g[3], c1: g[4], r1: g[6], o1: g[7], text, geom, colour: colr ? "#" + colr : "#808080" });
  }
  const lastCol = Math.max(0, ...items.map(i => i.c1)), out = [];
  items.forEach((it, i) => {
    if (!(it.c0 <= 3 && it.c1 >= lastCol - 3)) return;
    let label = it.text;
    if (!label && items[i + 1] && items[i + 1].text && Math.abs(items[i + 1].r0 - it.r0) <= 1) label = items[i + 1].text;
    const t0 = when(it.r0, it.o0), t1 = when(it.r1, it.o1);
    if (it.geom === "rect" && (t1 - t0) / DAY < 60 && label) {
      const L = label.toUpperCase(), d = new Date(t0);
      let s = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + (d.getUTCHours() >= 12 ? DAY : 0);
      if (L.includes("TUE") && new Date(s).getUTCDay() !== 2) { const wd = (new Date(t0).getUTCDay() + 6) % 7; s = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - wd * DAY + DAY; }
      const span = L.includes("TUE") && L.includes("THU") ? 2 : Math.max(1, Math.round((t1 - t0) / DAY));
      const stand = L.includes("STAND-DOWN");
      out.push({ id: newId("t_"), label: label.split(" — ")[0], kind: stand ? "shutdown" : "band",
        start: fmtT(s), finish: fmtT(s + span * DAY), ch0_m: null, ch1_m: null, colour: stand ? "#808080" : "#BF8F00" });
    } else if (it.geom === "line" && it.r0 === it.r1) {
      const near = items.slice(i + 1, i + 3).find(x => x.text), lab = near ? near.text : "";
      const dm2 = DATE_RE.exec(lab);
      const day = dm2 ? Date.UTC(+dm2[3], MONTHS[dm2[2].toUpperCase().slice(0, 3)], +dm2[1]) : Math.floor(t0 / DAY) * DAY;
      out.push({ id: newId("t_"), label: (lab.split(" — ")[0].split(" (")[0] || "Milestone").slice(0, 70), kind: "milestone", start: fmtT(day), finish: null, ch0_m: null, ch1_m: null, colour: it.colour });
    }
  });
  const seen = new Set();
  return out.sort((a, b) => a.start.localeCompare(b.start)).filter(m => { const key = m.label + m.start; if (seen.has(key)) return false; seen.add(key); return true; });
}
