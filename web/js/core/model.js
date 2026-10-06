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
export const PAPER_MM = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], Letter: [279, 216], Ledger: [432, 279], "ANSI D": [864, 559] };

export function makeStyle(code, name, kind = "line", colour = "#1F6E8C", extra = {}) {
  return { code, name, kind, colour, width: kind === "line" || kind === "bar" ? 3 : 1.5, dash: "solid", fill_opacity: kind === "block" ? 0.35 : 0.2,
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
    chainage: { start_m: chStart, end_m: chEnd, unit, prefix: "CH", decimals: unit === "km" ? 3 : 0, major_m: step * 2, minor_m: step, reverse: false, snap_m: 10 },
    time: { start, finish, px_per_day: 2, orientation: "down", week_start: 1, week_labels: "project", shade_weekends: false, work_days_per_week: 7, tz: "Australia/Melbourne" },
    location_types: JSON.parse(JSON.stringify(preset.location_types)), location_rows: 4,
    styles: preset.styles.map(([c, n, k, col]) => makeStyle(c, n, k, col)),
    datasets: [{ id: ds, name: "Main", source: "manual" }],
    view: { main_dataset: ds, compare_dataset: null, show_footprints: true, show_labels: true, show_time_markers: true, show_location_grid: true },
    sections: [], locations: [], time_markers: [], activities: [], productivities: [], page: defaultPage(), p6: null, header_image: null,
  };
}

export function makeActivity(dataset, code, name, start, finish, ch0_m, ch1_m, style, extra = {}) {
  return { id: newId("a_"), dataset, code, name, start, finish, ch0_m, ch1_m, style, wbs: "", notes: "", qty: null, qty_unit: "", rate: null, rate_unit: "",
    label: null, footprint: null, locked: false, p6: null, ...extra };
}

// Fill gaps in older or hand-edited documents so the UI can rely on every key.
export function normalise(p) {
  const base = newProject(p.name || "Untitled", p.discipline || "rail");
  for (const [k, v] of Object.entries(base)) if (!(k in p)) p[k] = v;
  for (const k of ["meta", "chainage", "time", "view"]) for (const [kk, vv] of Object.entries(base[k])) if (!(kk in p[k])) p[k][kk] = vv;
  p.styles.forEach(s => {
    const ref = makeStyle(s.code || "X", s.name || "", s.kind || "line", s.colour || "#1F6E8C");
    for (const [kk, vv] of Object.entries(ref)) if (!(kk in s)) s[kk] = vv;
    for (const sub of ["label", "footprint"]) for (const [kk, vv] of Object.entries(ref[sub])) if (!(kk in s[sub])) s[sub][kk] = vv;
  });
  if (!p.datasets.length) p.datasets = base.datasets;
  if (!p.datasets.some(d => d.id === p.view.main_dataset)) p.view.main_dataset = p.datasets[0].id;
  return p;
}

// "YYYY-MM-DDTHH:MM" helpers on UTC milliseconds (wall-clock time, no zone)
export const parseT = s => { const [d, t = "00:00"] = String(s).trim().replace(" ", "T").split("T"); const [y, m, dd] = d.split("-").map(Number); const [hh, mm] = t.split(":").map(Number); return Date.UTC(y, m - 1, dd, hh || 0, mm || 0); };
export const fmtT = ms => new Date(ms).toISOString().slice(0, 16);
export const DAY = 864e5;
