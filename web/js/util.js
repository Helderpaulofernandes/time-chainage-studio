// Shared helpers: dates, chainage formatting, DOM.
export const DAY = 864e5;
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// All times are naive local "YYYY-MM-DDTHH:MM" strings; they are handled as UTC milliseconds so DST never shifts them.
export function tms(s) {
  if (!s) return NaN;
  const [d, t = "00:00"] = String(s).replace(" ", "T").split("T");
  const [y, m, dd] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  return Date.UTC(y, m - 1, dd, hh || 0, mm || 0);
}
export function tstr(ms) { return new Date(ms).toISOString().slice(0, 16); }
export function dstr(ms) { return new Date(ms).toISOString().slice(0, 10); }
// Date order follows the open project: "dmy" (5 Apr 27), "mdy" (Apr 5, 27, US) or "ymd" (2027-04-05).
let DATE_ORDER = "dmy";
export function setDateOrder(o) { DATE_ORDER = o || "dmy"; }
export function niceDate(ms, withYear = true) {
  const d = new Date(ms), dd = d.getUTCDate(), mon = MON[d.getUTCMonth()], yy = String(d.getUTCFullYear()).slice(2);
  if (DATE_ORDER === "ymd") return withYear ? new Date(ms).toISOString().slice(0, 10) : new Date(ms).toISOString().slice(5, 10);
  if (DATE_ORDER === "mdy") return `${mon} ${dd}` + (withYear ? `, ${yy}` : "");
  return `${dd} ${mon}` + (withYear ? ` ${yy}` : "");
}
// A finish is exclusive (midnight after the last day); show the last working day instead.
export function niceFinish(ms) { return niceDate(ms - 60000); }
export function days(a, b) { return (b - a) / DAY; }
export function isoWeek(ms) {
  const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3);
  const y = Date.UTC(d.getUTCFullYear(), 0, 4);
  return 1 + Math.round(((d - y) / DAY - 3 + ((new Date(y).getUTCDay() + 6) % 7)) / 7);
}

// ---- chainage / stationing. Stored in metres; shown in the project's unit and format.
//   unit: m | km | ft | mi.  format: "decimal" (232.135, MP 12.40) or "station":
//   feet -> US stations of 100 ft ("12+34.56" = 1,234.56 ft); metres -> metric stations of 1 km ("12+345" = 12,345 m).
export const UNITS = { m: { factor: 1, name: "metres", len: "m" }, km: { factor: 1000, name: "kilometres", len: "m" },
  ft: { factor: 0.3048, name: "feet", len: "ft" }, mi: { factor: 1609.344, name: "miles", len: "ft" } };
export const unitFactor = u => (UNITS[u] || UNITS.m).factor;
const isStation = c => c.format === "station" && (c.unit === "ft" || c.unit === "m" || c.unit === "km");
const stationBase = c => (c.unit === "ft" ? 100 : 1000); // ft stations are 100 ft; metric stations are 1 km
function stationText(c, m) {
  const v = c.unit === "ft" ? m / 0.3048 : m, base = stationBase(c), dec = c.decimals ?? (c.unit === "ft" ? 2 : 0);
  const neg = v < 0, a = Math.abs(v), sta = Math.floor(a / base + 1e-9), rest = a - sta * base;
  const r = rest.toFixed(dec), [ip, fp] = r.split(".");
  return (neg ? "-" : "") + sta + "+" + ip.padStart(base === 100 ? 2 : 3, "0") + (fp ? "." + fp : "");
}
// Chainage equations: where the kilometrage jumps (a realignment), the chainage shown from there on restarts at a new value.
// Positions stay a running distance in metres; only the text changes.
export function shownM(p, m) {
  const eq = p.chainage.equations; if (!eq || !eq.length) return m;
  let best = null; for (const e of eq) if (m >= e.at_m - 1e-6 && (!best || e.at_m > best.at_m)) best = e;
  return best ? best.value_m + (m - best.at_m) : m;
}
export function chFmt(p, m, withPrefix = false) {
  const c = p.chainage; m = shownM(p, m);
  const v = isStation(c) ? stationText(c, m) : (m / unitFactor(c.unit)).toFixed(c.decimals ?? (c.unit === "km" ? 3 : c.unit === "mi" ? 2 : 0));
  return (withPrefix && c.prefix ? c.prefix + " " : "") + v;
}
// Full label for read-outs: "CH 232.135 km", "STA 12+34.56", "MP 12.40 mi"
export function chLabel(p, m) { const c = p.chainage; return chFmt(p, m, true) + (isStation(c) ? "" : " " + c.unit); }
// Axis caption after the prefix: "km", or "ft" for STA 12+34.56 stations
export function chUnitLabel(p) { const c = p.chainage; return isStation(c) ? (c.unit === "ft" ? "ft" : "m") : c.unit; }
// A length (not a position) in the display unit, e.g. for section lengths
export function lenFmt(p, m) { const c = p.chainage, u = c.unit === "mi" ? "mi" : c.unit === "ft" ? "ft" : c.unit; const v = m / unitFactor(u);
  return `${(+v.toFixed(u === "km" || u === "mi" ? 1 : 0)).toLocaleString()} ${u}`; }
// Lengths for quantities and rates: metres on metric projects, feet on US ones
export const lenUnit = p => UNITS[p.chainage.unit]?.len || "m";
export const lenFromM = (p, m) => (lenUnit(p) === "ft" ? m / 0.3048 : m);
// Parse what a user typed: a number in the project unit, or a station ("12+34.56" ft, "12+345" metric)
export function chToM(p, v, raw = false) {
  const m = chToMRaw(p, v); return raw ? m : runningM(p, m);
}
function chToMRaw(p, v) {
  const c = p.chainage, s = String(v ?? "").trim().replace(/,/g, "").replace(/^(ch|sta|mp|km)\s*/i, "");
  if (s === "") return null;
  const st = s.match(/^(-?)(\d+)\+(\d+(?:\.\d+)?)$/);
  if (st) { const sign = st[1] ? -1 : 1, base = c.unit === "ft" || c.unit === "mi" ? 100 : 1000, n = +st[2] * base + +st[3]; return sign * (base === 100 ? n * 0.3048 : n); }
  const n = parseFloat(s); return isNaN(n) ? null : n * unitFactor(c.unit);
}
// Value for an input box: a station string on station projects, otherwise a plain number in the project unit.
// Both directions follow chainage equations, so what you type is what the chart shows (raw = running distance).
export function mToCh(p, m, raw = false) { if (m == null) return ""; if (!raw) m = shownM(p, m); return isStation(p.chainage) ? stationText(p.chainage, m) : +(m / unitFactor(p.chainage.unit)).toFixed(6); }
// Running distance for a shown chainage: the stretch after the last equation whose shown values contain it
export function runningM(p, v) {
  const eq = (p.chainage.equations || []).slice().sort((a, b) => a.at_m - b.at_m); if (!eq.length || v == null) return v;
  for (let i = eq.length - 1; i >= 0; i--) { const e = eq[i], m = e.at_m + (v - e.value_m), next = eq[i + 1]; if (m >= e.at_m - 1e-6 && (!next || m < next.at_m)) return m; }
  return v; // before the first equation, shown and running are the same
}
export const chIsStation = p => isStation(p.chainage);
export const chName = p => (isStation(p.chainage) ? "station" : `chainage (${p.chainage.unit})`);

export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const uid = (p = "") => p + Math.random().toString(36).slice(2, 12);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v; else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
// A labelled form field: label, the input, and an optional hint under it
export const field = (label, input, hint) => h("label", { class: "fld" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
export function download(name, data, type = "application/octet-stream") {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// Label template: {name} {code} {style} {rate} {rate_unit} {qty} {dur} {start} {finish} {ch0} {ch1} {wbs}
export function labelText(tpl, a, p, styleName) {
  const s = tms(a.start), f = tms(a.finish);
  const map = {
    name: a.name, code: a.code, style: styleName || a.style, wbs: a.wbs || "",
    rate: a.rate == null ? "" : (Math.round(a.rate * 10) / 10).toLocaleString(), rate_unit: a.rate_unit || "",
    qty: a.qty == null ? "" : Math.round(a.qty).toLocaleString(), qty_unit: a.qty_unit || "",
    dur: Math.round(days(s, f) * 10) / 10, start: niceDate(s), finish: niceFinish(f),
    ch0: chFmt(p, a.ch0_m), ch1: chFmt(p, a.ch1_m),
  };
  return String(tpl || "{name}").replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m)).replace(/\s+·\s*$/, "").trim();
}
