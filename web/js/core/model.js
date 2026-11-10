// Project data model (browser). Chainage in metres; times are naive local "YYYY-MM-DDTHH:MM"; an activity's finish is exclusive.
export const SCHEMA_VERSION = 1;
export const newId = (prefix = "") => prefix + Math.random().toString(16).slice(2, 12).padEnd(10, "0");

const LT = (id, name, symbol, colour, row, grid) => ({ id, name, symbol, colour, row, grid });
export const PRESETS = {
  rail: { label: "Rail", location_types: [
    LT("loop", "Crossing loop / yard", "trapezoid", "#C26A12", 1, true), LT("station", "Station / town", "circle", "#1F6E8C", 1, true),
    LT("lx", "Level crossing", "tick", "#B13A3A", 2, false), LT("ped", "Pedestrian crossing", "tick", "#1F6E8C", 2, false),
    LT("bridge", "Bridge", "box", "#6A4FA3", 3, false), LT("culvert", "Culvert", "box", "#6A4FA3", 3, false),
    LT("turnout", "Turnout", "triangle", "#996633", 4, false), LT("zone", "Work zone / track section", "band", "#8B0000", 1, false),
    LT("limit", "Contract / network limit", "bar", "#18262B", 1, true), LT("other", "Other", "diamond", "#5D6B70", 4, false)],
    styles: [["RESLEEPER", "Re-sleepering", "line", "#002060"], ["DRAIN", "Drainage", "line", "#00B0F0"], ["BALLAST", "Ballast, lift & tamp", "line", "#FFC000"],
      ["TAMP", "Tamp & regulate", "line", "#92D050"], ["RERAIL", "Re-railing", "line", "#C00000"], ["STRUC", "Structures", "line", "#C65911"],
      ["SITE", "Site establishment", "block", "#548235"], ["POSS", "Possession", "block", "#B13A3A"]] },
  road: { label: "Road", location_types: [
    LT("interchange", "Interchange", "trapezoid", "#C26A12", 1, true), LT("intersection", "Intersection", "circle", "#1F6E8C", 1, true),
    LT("bridge", "Bridge / overpass", "box", "#6A4FA3", 2, true), LT("culvert", "Culvert", "box", "#6A4FA3", 3, false),
    LT("wall", "Retaining wall", "band", "#7F6000", 3, false), LT("utility", "Utility crossing", "tick", "#B13A3A", 4, false),
    LT("access", "Property access", "tick", "#5D6B70", 4, false), LT("limit", "Project limit", "bar", "#18262B", 1, true), LT("other", "Other", "diamond", "#5D6B70", 4, false)],
    styles: [["CLEAR", "Clear & grub", "line", "#548235"], ["EARTH", "Bulk earthworks", "block", "#C65911"], ["DRAIN", "Drainage", "line", "#00B0F0"],
      ["SUBBASE", "Subbase", "line", "#7F7F7F"], ["BASE", "Basecourse", "line", "#404040"], ["ASPHALT", "Asphalt", "line", "#18262B"],
      ["BRIDGE", "Bridge works", "block", "#6A4FA3"], ["TRAFFIC", "Traffic switch", "milestone", "#C00000"]] },
  tunnel: { label: "Tunnel", location_types: [
    LT("portal", "Portal", "bar", "#18262B", 1, true), LT("shaft", "Shaft", "circle", "#1F6E8C", 1, true), LT("station", "Station box", "band", "#1F6E8C", 1, true),
    LT("xp", "Cross passage", "tick", "#C26A12", 2, false), LT("geology", "Geology / fault zone", "band", "#B13A3A", 3, false),
    LT("vent", "Ventilation / services", "box", "#6A4FA3", 3, false), LT("other", "Other", "diamond", "#5D6B70", 4, false)],
    styles: [["TBM", "TBM drive", "line", "#002060"], ["DNB", "Drill & blast / roadheader", "line", "#C65911"], ["LINING", "Lining", "line", "#7F7F7F"],
      ["INVERT", "Invert", "line", "#404040"], ["XP", "Cross passage construction", "block", "#C26A12"], ["FITOUT", "Fit-out", "line", "#548235"],
      ["TBMLAUNCH", "TBM assembly / launch", "block", "#B13A3A"]] },
};
PRESETS.other = { label: "Other linear asset", location_types: PRESETS.road.location_types, styles: PRESETS.road.styles };
// Colours given to new activity styles (imports), in order
export const STYLE_PALETTE = ["#002060", "#00B0F0", "#FFC000", "#92D050", "#C00000", "#C65911", "#7030A0", "#548235", "#FF66CC",
  "#996633", "#404040", "#1F8A86", "#8B0000", "#7F7F7F", "#E2C46B", "#4F81BD", "#A33F7A", "#2F8A55"];
// Chainage units: everything is stored in metres; these say how to show it.
export const UNIT_FACTOR = { m: 1, km: 1000, ft: 0.3048, mi: 1609.344 };
export const unitFactor = u => UNIT_FACTOR[u] || 1;
export const PAPER_MM = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], Letter: [279, 216], Ledger: [432, 279], "ANSI D": [864, 559] };

export function makeStyle(code, name, kind = "line", colour = "#1F6E8C", extra = {}) {
  return { code, name, kind, colour, width: kind === "line" || kind === "bar" ? 3 : 1.5, dash: "solid", fill_opacity: kind === "block" || kind === "cut" || kind === "fill" ? 0.35 : 0.2,
    label: { show: true, text: "{name}", follow_slope: true, position: "mid", side: "above", size: 11 },
    footprint: { enabled: false, length_m: 0, lag_days: 0, opacity: 0.18 }, legend: true, ...extra };
}

function niceStep(span) {
  const raw = Math.max(span, 1) / 20, mag = 10 ** (String(Math.floor(raw)).length - 1);
  for (const m of [1, 2, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

export function defaultPage() {
  return { paper: "A3", orientation: "landscape", margins_mm: { top: 10, right: 10, bottom: 10, left: 10 },
    blocks: [
      { id: "title", kind: "title", x: 0, y: 0, w: 0.72, h: 0.07, text: "{title}", font_size: 22, bold: true, border: false },
      { id: "titleblock", kind: "titleblock", x: 0.72, y: 0, w: 0.28, h: 0.07, border: true },
      { id: "chart", kind: "chart", x: 0, y: 0.08, w: 0.82, h: 0.92, border: true },
      { id: "legend", kind: "legend", x: 0.83, y: 0.08, w: 0.17, h: 0.6, border: true },
      { id: "notes", kind: "text", title: "Notes", show_title: true, shrink: true, x: 0.83, y: 0.69, w: 0.17, h: 0.31, text: "", font_size: 9, border: true }] };
}

export function newProject(name = "Untitled", discipline = "rail", chStart = 0, chEnd = 10000, start = null, finish = null, unit = "km") {
  const preset = PRESETS[discipline] || PRESETS.rail, now = new Date();
  start = start || new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
  finish = finish || new Date(Date.UTC(now.getFullYear() + 1, now.getMonth(), 1)).toISOString().slice(0, 10);
  const ds = newId("ds_"), step = niceStep(chEnd - chStart);
  return {
    schema: SCHEMA_VERSION, id: newId("prj_"), name, discipline, rev: 0,
    meta: { title: name, subtitle: "", client: "", contract: "", revision: "A", author: "", data_date: "" },
    chainage: { start_m: chStart, end_m: chEnd, unit, format: unit === "ft" ? "station" : "decimal", prefix: unit === "ft" ? "STA" : unit === "mi" ? "MP" : "CH",
      decimals: unit === "km" ? 3 : unit === "mi" || unit === "ft" ? 2 : 0, major_m: step * 2, minor_m: step, reverse: false, snap_m: 10 },
    locale: { date_order: unit === "ft" || unit === "mi" ? "mdy" : "dmy" },
    time: { start, finish, px_per_day: 2, orientation: "down", week_start: unit === "ft" || unit === "mi" ? 0 : 1, week_labels: "project", shade_weekends: false, work_days_per_week: 7, tz: "Australia/Melbourne" },
    location_types: JSON.parse(JSON.stringify(preset.location_types)), location_rows: 4,
    styles: preset.styles.map(([c, n, k, col]) => makeStyle(c, n, k, col)),
    datasets: [{ id: ds, name: "Main", source: "manual" }],
    view: { main_dataset: ds, compare_dataset: null, show_footprints: true, show_labels: true, show_time_markers: true, show_location_grid: true,
      pause_on_shutdowns: false, corridor: corridorDefaults(), video: videoDefaults() },
    sections: [], locations: [], time_markers: [], activities: [], productivities: [], page: { ...defaultPage(), paper: unit === "ft" || unit === "mi" ? "Ledger" : "A3" }, p6: null, header_image: null, brand: null,
  };
}

// Video export settings: intro and outro cards, and music levels (the music file itself is chosen at export).
export function videoDefaults() {
  return { intro: { on: true, seconds: 4, bg: "white", title: "", subtitle: "", details: true },
    outro: { on: true, seconds: 3, bg: "white", line: "", details: true, content: "project", tagline: "" },
    music: { volume: 0.8, fade_in: 1, fade_out: 3, start_at: 0 } };
}

// Corridor view (crew playback) settings, kept with the project's other view settings.
export function corridorDefaults() {
  return { show: "both", lanes: null, stages: [], lookahead_days: 21, lane_height: 30, show_tags: true, chart_header: true };
}

export function makeActivity(dataset, code, name, start, finish, ch0_m, ch1_m, style, extra = {}) {
  return { id: newId("a_"), dataset, code, name, start, finish, ch0_m, ch1_m, style, wbs: "", notes: "", qty: null, qty_unit: "", rate: null, rate_unit: "",
    label: null, footprint: null, locked: false, p6: null, ...extra };
}

// Fill gaps in older or hand-edited documents so the UI can rely on every key.
export function normalise(p) {
  const base = newProject(p.name || "Untitled", p.discipline || "rail");
  for (const [k, v] of Object.entries(base)) if (!(k in p)) p[k] = v;
  if (!p.locale) p.locale = { date_order: "dmy" };
  for (const k of ["meta", "chainage", "time", "view"]) for (const [kk, vv] of Object.entries(base[k])) if (!(kk in p[k])) p[k][kk] = vv;
  const vd = videoDefaults();
  if (!p.view.video || typeof p.view.video !== "object") p.view.video = vd;
  for (const k of Object.keys(vd)) { p.view.video[k] = { ...vd[k], ...(p.view.video[k] || {}) }; }
  if (!p.view.corridor || typeof p.view.corridor !== "object") p.view.corridor = corridorDefaults();
  for (const [kk, vv] of Object.entries(corridorDefaults())) if (!(kk in p.view.corridor)) p.view.corridor[kk] = vv;
  if (!Array.isArray(p.view.corridor.stages)) p.view.corridor.stages = [];
  p.styles.forEach(s => {
    const ref = makeStyle(s.code || "X", s.name || "", s.kind || "line", s.colour || "#1F6E8C");
    for (const [kk, vv] of Object.entries(ref)) if (!(kk in s)) s[kk] = vv;
    for (const sub of ["label", "footprint"]) for (const [kk, vv] of Object.entries(ref[sub])) if (!(kk in s[sub])) s[sub][kk] = vv;
  });
  if (!p.datasets.length) p.datasets = base.datasets;
  if (!p.datasets.some(d => d.id === p.view.main_dataset)) p.view.main_dataset = p.datasets[0].id;
  return sanitise(p);
}

// ------------------------------------------------------------------ sanitising
// A project file can come from anyone. Everything that goes into the chart drawing as an attribute (colours, ids,
// numbers, images) is checked here, so a crafted file cannot inject markup or script. Text is escaped where drawn.
const HEX6 = /^#[0-9a-f]{6}$/i, HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const IMG = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]*$/;
export const safeColour = (v, fb = null) => { if (typeof v !== "string") return fb; if (HEX6.test(v)) return v; const m = HEX3.exec(v); return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : fb; };
export const safeImage = v => (typeof v === "string" && IMG.test(v) ? v : null);
export const safeId = v => (v == null || v === "" ? v : String(v).replace(/[^\w.:-]/g, "_"));
const num = (v, fb) => (v === "" || v == null || !Number.isFinite(+v) ? fb : +v);
const oneOf = (v, list, fb) => (list.includes(v) ? v : fb);
export function sanitise(p) {
  const arr = k => (Array.isArray(p[k]) ? p[k] : (p[k] = []));
  const c = p.chainage, t = p.time;
  for (const k of ["start_m", "end_m", "major_m", "minor_m", "snap_m", "repeat_days", "decimals"]) c[k] = num(c[k], k === "end_m" ? 1000 : 0);
  c.breaks = (c.breaks || []).map(b => ({ from_m: num(b.from_m, 0), to_m: num(b.to_m, 0) }));
  c.equations = (c.equations || []).map(e => ({ at_m: num(e.at_m, 0), value_m: num(e.value_m, 0) }));
  t.px_per_day = num(t.px_per_day, 2); t.work_days_per_week = num(t.work_days_per_week, 7);
  for (const s of arr("styles")) {
    s.colour = safeColour(s.colour, "#1F6E8C"); s.fill_colour = safeColour(s.fill_colour, null);
    s.kind = oneOf(s.kind, ["line", "bar", "block", "cut", "fill", "taper", "milestone"], "line");
    s.dash = oneOf(s.dash, ["solid", "dash", "dot"], "solid"); s.fill_pattern = oneOf(s.fill_pattern, ["solid", "hatch", "crosshatch", "dots", "none"], "solid");
    s.marks = oneOf(s.marks, ["none", "tick", "arrow", "chevron", "cross", "dot", "flag"], "none");
    s.width = num(s.width, 2); s.fill_opacity = num(s.fill_opacity, 0.35); s.mark_spacing = num(s.mark_spacing, 22);
    if (s.label) { s.label.size = num(s.label.size, 11); s.label.colour = safeColour(s.label.colour, null); }
    if (s.footprint) for (const k of ["length_m", "lag_days", "opacity"]) s.footprint[k] = num(s.footprint[k], k === "opacity" ? 0.18 : 0);
  }
  for (const lt of arr("location_types")) { lt.id = safeId(lt.id); lt.colour = safeColour(lt.colour, "#5D6B70"); lt.row = num(lt.row, 1); }
  for (const l of arr("locations")) { l.id = safeId(l.id); l.type = safeId(l.type); l.colour = safeColour(l.colour, null); l.ch_m = num(l.ch_m, 0); l.to_m = num(l.to_m, null); l.row = num(l.row, null); l.pin_y = num(l.pin_y, null); }
  for (const s of arr("sections")) { s.id = safeId(s.id); s.from_m = num(s.from_m, 0); s.to_m = num(s.to_m, 0); }
  for (const m of arr("time_markers")) { m.id = safeId(m.id); m.colour = safeColour(m.colour, null); m.ch0_m = num(m.ch0_m, null); m.ch1_m = num(m.ch1_m, null); }
  for (const d of arr("datasets")) d.id = safeId(d.id);
  p.view.main_dataset = safeId(p.view.main_dataset); p.view.compare_dataset = safeId(p.view.compare_dataset) || null;
  for (const a of arr("activities")) {
    a.id = safeId(a.id); a.dataset = safeId(a.dataset); a.col = safeId(a.col) || null;
    a.ch0_m = num(a.ch0_m, 0); a.ch1_m = num(a.ch1_m, a.ch0_m); a.fin_ch0_m = num(a.fin_ch0_m, null); a.fin_ch1_m = num(a.fin_ch1_m, null);
    if (a.label) { if ("size" in a.label) a.label.size = num(a.label.size, null); if ("colour" in a.label) a.label.colour = safeColour(a.label.colour, null); }
    if (a.links) a.links = a.links.map(l => ({ code: String(l.code ?? ""), type: oneOf(String(l.type || "FS").toUpperCase(), ["FS", "SS", "FF", "SF"], "FS"), lag_days: num(l.lag_days, 0) }));
  }
  for (const n of arr("notes")) { n.id = safeId(n.id); n.colour = safeColour(n.colour, "#18262B"); n.size = num(n.size, null); n.angle = num(n.angle, 0); n.ch_m = num(n.ch_m, 0); n.leader_ch_m = num(n.leader_ch_m, null); }
  for (const h of arr("hauls")) { h.id = safeId(h.id); h.colour = safeColour(h.colour, "#7F6000"); for (const k of ["from0_m", "from1_m", "to0_m", "to1_m"]) h[k] = num(h[k], null); h.from0_m ??= 0; h.to0_m ??= 0; }
  for (const pl of arr("progress_lines")) { pl.id = safeId(pl.id); pl.colour = safeColour(pl.colour, "#C00000"); pl.width = num(pl.width, null); pl.points = (pl.points || []).map(([d, m]) => [String(d), num(m, null)]); }
  for (const b of arr("bands")) { b.id = safeId(b.id); b.height = num(b.height, null); b.cut_colour = safeColour(b.cut_colour, null); b.fill_colour = safeColour(b.fill_colour, null); b.colours = (b.colours || []).map(x => safeColour(x, "#7F7F7F")); b.types = b.types ? b.types.map(safeId) : b.types; }
  for (const s of arr("side_cols")) { s.id = safeId(s.id); s.width = num(s.width, 90); s.side = oneOf(s.side, ["left", "right"], "left"); }
  for (const tr of arr("tracks")) tr.offset_px = num(tr.offset_px, 0);
  for (const v of arr("views")) { v.id = safeId(v.id); v.ch_from = num(v.ch_from, null); v.ch_to = num(v.ch_to, null); }
  if (p.resources) { for (const s of p.resources.series || []) { s.id = safeId(s.id); s.colour = safeColour(s.colour, "#7F7F7F"); } if (p.resources.panel) p.resources.panel.width = num(p.resources.panel.width, 150); }
  if (p.header_image) { p.header_image.data = safeImage(p.header_image.data); for (const k of ["height_px", "opacity", "nat_w", "nat_h", "ch_start_m", "ch_end_m"]) p.header_image[k] = num(p.header_image[k], k === "opacity" ? 1 : null); if (!p.header_image.data) p.header_image = null; }
  if (p.brand) { p.brand.logo = safeImage(p.brand.logo); p.brand.colour = safeColour(p.brand.colour, "#18262B"); p.brand.accent = safeColour(p.brand.accent, "#C00000"); p.brand.logo_w = num(p.brand.logo_w, 0); p.brand.logo_h = num(p.brand.logo_h, 0); }
  for (const b of (p.page && p.page.blocks) || []) { b.id = safeId(b.id); if (b.data) b.data = safeImage(b.data); for (const k of ["x", "y", "w", "h"]) b[k] = num(b[k], 0.1); b.font_size = num(b.font_size, null); b.ch_from = num(b.ch_from, null); b.ch_to = num(b.ch_to, null); }
  for (const sg of (p.view.corridor && p.view.corridor.stages) || []) sg.colour = safeColour(sg.colour, null) || undefined;
  return p;
}

// "YYYY-MM-DDTHH:MM" helpers on UTC milliseconds (wall-clock time, no zone)
export const parseT = s => { const [d, t = "00:00"] = String(s).trim().replace(" ", "T").split("T"); const [y, m, dd] = d.split("-").map(Number); const [hh, mm] = t.split(":").map(Number); return Date.UTC(y, m - 1, dd, hh || 0, mm || 0); };
export const fmtT = ms => new Date(ms).toISOString().slice(0, 16);
export const DAY = 864e5;
