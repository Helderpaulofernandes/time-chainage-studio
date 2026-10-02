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
export function niceDate(ms, withYear = true) {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` + (withYear ? ` ${String(d.getUTCFullYear()).slice(2)}` : "");
}
// A finish is exclusive (midnight after the last day); show the last working day instead.
export function niceFinish(ms) { return niceDate(ms - 60000); }
export function days(a, b) { return (b - a) / DAY; }
export function isoWeek(ms) {
  const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3);
  const y = Date.UTC(d.getUTCFullYear(), 0, 4);
  return 1 + Math.round(((d - y) / DAY - 3 + ((new Date(y).getUTCDay() + 6) % 7)) / 7);
}

export function chFmt(p, m, withPrefix = false) {
  const c = p.chainage; const k = c.unit === "km" ? 1000 : 1;
  const v = (m / k).toFixed(c.decimals ?? (c.unit === "km" ? 3 : 0));
  return (withPrefix && c.prefix ? c.prefix : "") + v;
}
export function chToM(p, v) { const n = parseFloat(v); return isNaN(n) ? null : n * (p.chainage.unit === "km" ? 1000 : 1); }
export function mToCh(p, m) { return m == null ? "" : +(m / (p.chainage.unit === "km" ? 1000 : 1)).toFixed(6); }

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
