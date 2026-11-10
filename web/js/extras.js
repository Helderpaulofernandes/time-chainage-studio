// Extra chart layers: bands above / below the chart (long section, quantities, package extents, schematic plan,
// strips), side columns for work with no chainage, the resource histogram panel, crew steps, progress lines,
// text notes, haul arrows and pins on the header image. Called by renderChart with its geometry G.
import { PAPER, FONT, locSymbol } from "./render.js";
import { DAY, tms, esc, chFmt, chToM, lenFmt, niceDate, niceFinish } from "./util.js";

const MONO = "IBM Plex Mono, Consolas, monospace";
const HALO = `paint-order="stroke" stroke="#FFFFFF" stroke-width="3" stroke-linejoin="round"`;
const t = (x, y, s, attrs = "", fill = "#18262B") => `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" ${attrs} fill="${fill}">${esc(s)}</text>`;
const f1 = v => (+v).toFixed(1);
export const PALETTE = ["#C65911", "#1F4E79", "#548235", "#7030A0", "#BF8F00", "#00B0F0", "#C00000", "#7F7F7F", "#FF66CC", "#2F8A55"];

// ------------------------------------------------------------------ what is drawn where
// An activity placed in a side column, or on a track that is switched off, is not drawn on the grid. If its column is
// deleted it comes back onto the grid at its chainage.
export function onChart(p, a) {
  if ((p.view.hidden_styles || []).includes(a.style)) return false;
  if (a.col && (p.side_cols || []).some(s => s.id === a.col)) return false; // in a column (shown or hidden), never on the grid
  if (a.track) { const tr = (p.tracks || []).find(x => x.name === a.track); if (tr && tr.show === false) return false; }
  return true;
}
export function trackOffset(p, a) { if (!a.track) return 0; const tr = (p.tracks || []).find(x => x.name === a.track); return tr ? +tr.offset_px || 0 : 0; }
export function actGeo(p, G, a) {
  const dx = trackOffset(p, a);
  const r = v => Math.round(v * 10) / 10; // a tenth of a pixel is plenty, and keeps the drawing small
  return { x0: r(G.X(a.ch0_m) + dx), x1: r(G.X(a.ch1_m) + dx), y0: r(G.Y(tms(a.start))), y1: r(G.Y(tms(a.finish))), dx };
}

// ------------------------------------------------------------------ CSV helpers for band data
// Rows of cells from pasted text (comma, tab or semicolon separated). Lines starting with # are notes.
export function rowsOf(text) {
  return String(text || "").split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"))
    .map(l => l.split(l.includes("\t") ? "\t" : l.includes(";") ? ";" : ",").map(c => c.trim()));
}
const isNum = v => v !== "" && v != null && !isNaN(+String(v).replace(/,/g, ""));
const num = v => +String(v).replace(/,/g, "");
const chM = (p, v) => chToM(p, v);
// Drops a header row (any row whose chainage column does not read as a chainage)
function dataRows(p, text, chCols) { return rowsOf(text).filter(r => chCols.every(i => chM(p, r[i]) != null)); }
function headerRow(text) { const r = rowsOf(text)[0]; return r && !isNum(r[0]) && !/^\d+\+/.test(r[0]) ? r : null; }

// ------------------------------------------------------------------ bands
export const BAND_KINDS = {
  profile: { name: "Long section (ground and design levels)", h: 90, help: "One row per point: chainage, ground level, design level. Cut is shaded where the ground is above design, fill where it is below." },
  quantities: { name: "Quantities by section", h: 110, help: "First row: from, to, then one heading per quantity (for example Topsoil m3, Cut to fill m3). Then one row per section." },
  extents: { name: "Package / contract extents", h: 46, help: "One row per package: name, from, to, and an optional colour (#C00000)." },
  plan: { name: "Schematic plan (track and structures)", h: 96, help: "Draws the track with the location markers of the types you tick, named upright. No data needed." },
  strip: { name: "Strip (ground type, terrain, zones)", h: 26, help: "One row per stretch: from, to, label, and an optional colour." },
};
export function bandHeight(b, compact) {
  let h = +b.height || (BAND_KINDS[b.kind] || {}).h || 60;
  return compact ? h * 0.8 : h;
}
export function bandsSvg(p, G, pos) {
  const list = G.bands.filter(b => (b.position === "above") === (pos === "above"));
  if (!list.length) return "";
  let y = pos === "above" ? G.aboveTop + 2 : G.belowTop, o = "";
  for (const b of list) {
    const h = G.bandH(b), fn = { profile: profileBand, quantities: quantitiesBand, extents: extentsBand, plan: planBand, strip: stripBand }[b.kind];
    o += `<g data-band="${b.id}" class="band"><rect x="${G.L}" y="${f1(y)}" width="${f1(G.R - G.L)}" height="${f1(h)}" fill="${PAPER.sheet}" stroke="${PAPER.rule}" stroke-width=".8"/>`;
    o += `<text transform="translate(${f1(G.edgeL - 8)},${f1(y + h / 2)}) rotate(-90)" text-anchor="middle" font-size="${G.compact ? 8 : 9}" font-weight="600" font-family="${FONT}" fill="${PAPER.muted}">${esc(clip(b.name || (BAND_KINDS[b.kind] || {}).name || "", h / 5.5))}</text>`;
    // everything in a band stays inside the chart's width (a chart block can show only part of the line)
    o += `<clipPath id="${G.idp || ""}bw-${b.id}"><rect x="${G.L - 1}" y="${f1(y - 30)}" width="${f1(G.R - G.L + 2)}" height="${f1(h + 60)}"/></clipPath>`;
    try { o += fn ? `<g clip-path="url(#${G.idp || ""}bw-${b.id})">${fn(p, G, b, y, h)}</g>` : ""; } catch (e) { o += t(G.L + 8, y + 14, "Could not read this band's data: " + e.message, `font-size="10" font-family="${FONT}"`, "#B13A3A"); }
    o += `</g>`;
    y += h + 6;
  }
  return o;
}
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, Math.max(1, Math.floor(n) - 1)) + "…" : String(s));

function profileBand(p, G, b, y, h) {
  const pts = dataRows(p, b.data, [0]).map(r => [chM(p, r[0]), isNum(r[1]) ? num(r[1]) : null, isNum(r[2]) ? num(r[2]) : null]).filter(r => r[1] != null || r[2] != null).sort((a, c) => a[0] - c[0]);
  if (pts.length < 2) return t(G.L + 8, y + 16, "Paste chainage, ground level, design level (one point per row).", `font-size="10" font-family="${FONT}"`, PAPER.muted);
  const lv = pts.flatMap(r => [r[1], r[2]]).filter(v => v != null), lo = Math.min(...lv), hi = Math.max(...lv), pad = 8;
  const Ly = v => y + h - pad - ((v - lo) / ((hi - lo) || 1)) * (h - 2 * pad);
  let o = `<clipPath id="${G.idp || ""}bc-${b.id}"><rect x="${G.L}" y="${y}" width="${G.R - G.L}" height="${h}"/></clipPath><g clip-path="url(#${G.idp || ""}bc-${b.id})">`;
  // cut / fill shading between the lines, split where they cross
  const cutC = b.cut_colour || "#E07B39", fillC = b.fill_colour || "#1F4E79";
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ca, ga, da] = pts[i], [cb, gb, db] = pts[i + 1];
    if (ga == null || da == null || gb == null || db == null) continue;
    const ea = ga - da, eb = gb - db;
    const quad = (c0, g0, d0, c1, g1, d1, e) => `<path d="M${f1(G.X(c0))} ${f1(Ly(g0))}L${f1(G.X(c1))} ${f1(Ly(g1))}L${f1(G.X(c1))} ${f1(Ly(d1))}L${f1(G.X(c0))} ${f1(Ly(d0))}Z" fill="${e > 0 ? cutC : fillC}" fill-opacity=".55"/>`;
    if (ea * eb < 0) { const k = ea / (ea - eb), cm = ca + (cb - ca) * k, gm = ga + (gb - ga) * k; o += quad(ca, ga, da, cm, gm, gm, ea) + quad(cm, gm, gm, cb, gb, db, eb); }
    else o += quad(ca, ga, da, cb, gb, db, ea + eb);
  }
  const line = (k, col, w) => { const q = pts.filter(r => r[k] != null); return q.length > 1 ? `<path d="${q.map((r, i) => (i ? "L" : "M") + f1(G.X(r[0])) + " " + f1(Ly(r[k]))).join("")}" fill="none" stroke="${col}" stroke-width="${w}"/>` : ""; };
  o += line(1, "#3B2F2F", 1.4) + line(2, "#1F6E8C", 1.2) + `</g>`;
  o += t(G.L + 4, y + 10, `${hi.toFixed(1)}`, `font-size="8" font-family="${MONO}"`, PAPER.muted) + t(G.L + 4, y + h - 3, `${lo.toFixed(1)}`, `font-size="8" font-family="${MONO}"`, PAPER.muted);
  o += t(G.R - 4, y + 10, "Ground ━  Design ━  Cut ■  Fill ■", `text-anchor="end" font-size="8" font-family="${FONT}"`, PAPER.muted);
  return o;
}

function quantitiesBand(p, G, b, y, h) {
  const head = headerRow(b.data), rows = dataRows(p, b.data, [0, 1]);
  if (!rows.length) return t(G.L + 8, y + 16, "Paste from, to, then one column per quantity (first row: headings).", `font-size="10" font-family="${FONT}"`, PAPER.muted);
  const ns = Math.max(...rows.map(r => r.length)) - 2, names = Array.from({ length: ns }, (_, i) => (head && head[i + 2]) || `Qty ${i + 1}`);
  const cols = names.map((_, i) => (b.colours || [])[i] || PALETTE[i % PALETTE.length]);
  const tableH = b.table === false ? 0 : ns * 10 + 4, barH = h - tableH - 6;
  const vals = rows.map(r => names.map((_, i) => (isNum(r[i + 2]) ? num(r[i + 2]) : 0)));
  const max = Math.max(1, ...vals.flat());
  let o = "";
  rows.forEach((r, ri) => {
    const a = G.X(chM(p, r[0])), c = G.X(chM(p, r[1])), xa = Math.min(a, c), w = Math.abs(c - a), bw = Math.max(1, (w - 6) / ns);
    o += `<line x1="${f1(xa)}" x2="${f1(xa)}" y1="${y}" y2="${y + h}" stroke="${PAPER.rule}" stroke-width=".6"/>`;
    vals[ri].forEach((v, i) => { const bh = (v / max) * (barH - 4); if (bh > 0) o += `<rect x="${f1(xa + 3 + i * bw)}" y="${f1(y + barH - bh)}" width="${f1(Math.max(1, bw - 1))}" height="${f1(bh)}" fill="${cols[i]}"><title>${esc(names[i])}: ${v.toLocaleString()}</title></rect>`; });
    if (tableH) vals[ri].forEach((v, i) => { o += t(xa + w / 2, y + barH + 12 + i * 10, v ? Math.round(v).toLocaleString() : "", `text-anchor="middle" font-size="8" font-family="${MONO}"`, cols[i]); });
  });
  if (tableH) names.forEach((n, i) => { o += t(G.L + 4, y + barH + 12 + i * 10, n, `font-size="8" font-weight="600" font-family="${FONT}" ${HALO}`, cols[i]); });
  o += t(G.L + 4, y + 10, max.toLocaleString(), `font-size="8" font-family="${MONO}"`, PAPER.muted);
  return o;
}

function extentsBand(p, G, b, y, h) {
  const rows = dataRows(p, b.data, [1, 2]);
  if (!rows.length) return t(G.L + 8, y + 16, "Paste name, from, to (one package per row).", `font-size="10" font-family="${FONT}"`, PAPER.muted);
  let o = `<defs><marker id="exa-${b.id}" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="context-stroke"/></marker></defs>`;
  const ym = y + h / 2;
  rows.forEach((r, i) => {
    const a = chM(p, r[1]), c = chM(p, r[2]), xa = G.X(Math.min(a, c)), xc = G.X(Math.max(a, c)), col = /^#[0-9a-f]{6}$/i.test(r[3] || "") ? r[3] : PALETTE[i % PALETTE.length];
    o += `<line x1="${f1(xa)}" x2="${f1(xc)}" y1="${f1(ym)}" y2="${f1(ym)}" stroke="${col}" stroke-width="1.6" marker-start="url(#exa-${b.id})" marker-end="url(#exa-${b.id})"/>`;
    [xa, xc].forEach(x => { o += `<line x1="${f1(x)}" x2="${f1(x)}" y1="${f1(ym - 9)}" y2="${f1(ym + 9)}" stroke="#C00000" stroke-width="2"/>`; });
    const label = r[0] || "", len = lenFmt(p, Math.abs(c - a)), w = Math.max(label.length, len.length + 2) * 6 + 14;
    if (xc - xa > 30) {
      const bw = Math.min(w, xc - xa - 8);
      o += `<rect x="${f1((xa + xc) / 2 - bw / 2)}" y="${f1(ym - 15)}" width="${f1(bw)}" height="30" rx="2" fill="#FFF8EC" stroke="${col}" stroke-width=".8"/>`;
      o += t((xa + xc) / 2, ym - 3, clip(label, bw / 6), `text-anchor="middle" font-size="10" font-weight="700" font-family="${FONT}"`) + t((xa + xc) / 2, ym + 10, `(${len})`, `text-anchor="middle" font-size="9" font-family="${FONT}"`, PAPER.muted);
    }
  });
  return o;
}

function planBand(p, G, b, y, h) {
  const types = new Set(b.types && b.types.length ? b.types : p.location_types.map(x => x.id));
  const tm = Object.fromEntries(p.location_types.map(x => [x.id, x])), base = y + h - 18, lo = Math.min(p.chainage.start_m, p.chainage.end_m), hi = Math.max(p.chainage.start_m, p.chainage.end_m);
  let o = `<line x1="${G.L}" x2="${G.R}" y1="${base}" y2="${base}" stroke="${PAPER.ink}" stroke-width="2.4"/><line x1="${G.L}" x2="${G.R}" y1="${base + 5}" y2="${base + 5}" stroke="${PAPER.ink}" stroke-width="1"/>`;
  for (const l of p.locations) {
    if (!types.has(l.type) || l.ch_m < lo - 1 || l.ch_m > hi + 1) continue;
    const ty = tm[l.type] || { colour: PAPER.muted, symbol: "diamond" }, col = l.colour || ty.colour, x = G.X(l.ch_m), x2 = l.to_m != null ? G.X(l.to_m) : x;
    o += `<g data-loc="${l.id}" class="loc">` + locSymbol(ty.symbol === "band" ? "box" : ty.symbol, x, Math.min(x, x2), Math.max(x, x2), base, col);
    o += `<text transform="translate(${f1(x + 3)},${f1(base - 11)}) rotate(-90)" font-size="${G.compact ? 7.5 : 8.5}" font-family="${FONT}" fill="${PAPER.ink}" ${HALO}>${esc(clip(l.name, (h - 30) / 4.6))}</text></g>`;
  }
  return o;
}

function stripBand(p, G, b, y, h) {
  const rows = dataRows(p, b.data, [0, 1]);
  if (!rows.length) return t(G.L + 8, y + h / 2 + 4, "Paste from, to, label (one stretch per row).", `font-size="10" font-family="${FONT}"`, PAPER.muted);
  let o = "";
  rows.forEach((r, i) => {
    const a = G.X(chM(p, r[0])), c = G.X(chM(p, r[1])), xa = Math.min(a, c), w = Math.abs(c - a), col = /^#[0-9a-f]{6}$/i.test(r[3] || "") ? r[3] : PALETTE[i % PALETTE.length];
    o += `<rect x="${f1(xa)}" y="${f1(y + 2)}" width="${f1(Math.max(1, w))}" height="${f1(h - 4)}" fill="${col}" fill-opacity=".75"><title>${esc(r[2] || "")}</title></rect>`;
    if (r[2] && w > r[2].length * 5.5 + 6) o += t(xa + w / 2, y + h / 2 + 3.5, r[2], `text-anchor="middle" font-size="9" font-weight="600" font-family="${FONT}" ${HALO}`);
  });
  return o;
}

// ------------------------------------------------------------------ side columns
// Work with no chainage (design, approvals, procurement) drawn as bars against the same dates, beside the chart.
export function sideColsSvg(p, G) {
  if (!G.cols.length) return "";
  const S = Object.fromEntries(p.styles.map(s => [s.code, s])), fs = G.compact ? 8 : 9.5;
  let o = "";
  for (const { s, x, w } of G.cols) {
    o += `<rect x="${f1(x)}" y="${G.top}" width="${f1(w)}" height="${G.GH}" fill="${PAPER.faint}" stroke="${PAPER.rule}"/>`;
    o += `<text transform="translate(${f1(x + w / 2 + 3)},${f1(G.top - 4)}) rotate(-90)" font-size="${fs}" font-weight="700" font-family="${FONT}" fill="${PAPER.ink}">${esc(clip(s.name || "Column", 26))}</text>`;
    const acts = p.activities.filter(a => a.col === s.id && a.dataset === p.view.main_dataset).sort((a, b) => tms(a.start) - tms(b.start));
    const lanes = []; // greedy lanes so overlapping work sits side by side
    const lane = acts.map(a => { const s0 = tms(a.start); let i = lanes.findIndex(f => f <= s0); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = tms(a.finish); return i; });
    const n = Math.max(1, lanes.length), lw = (w - 6) / n;
    acts.forEach((a, k) => {
      const st = S[a.style] || { colour: PAPER.muted }, col = st.colour, xa = x + 3 + lane[k] * lw, y0 = G.Y(tms(a.start)), y1 = G.Y(tms(a.finish));
      const ya = Math.min(y0, y1), hh = Math.max(2, Math.abs(y1 - y0));
      o += `<g data-act="${a.id}" class="act"><title>${esc(a.code)} ${esc(a.name)} · ${niceDate(tms(a.start))} – ${niceFinish(tms(a.finish))}</title>`;
      if (st.kind === "milestone" || hh < 3) o += `<path d="M${f1(xa + lw / 2)} ${f1(ya - 6)}l6 6l-6 6l-6 -6z" fill="${col}"/>`;
      else o += `<rect x="${f1(xa)}" y="${f1(ya)}" width="${f1(Math.max(2, lw - 2))}" height="${f1(hh)}" fill="${col}" fill-opacity=".85" stroke="${PAPER.sheet}" stroke-width=".8"/>`;
      if (hh > a.name.length * fs * 0.5 + 6 && lw > fs + 2) o += `<text transform="translate(${f1(xa + lw / 2 + fs / 3)},${f1(ya + hh / 2)}) rotate(-90)" text-anchor="middle" font-size="${fs}" font-family="${FONT}" fill="#fff">${esc(a.name)}</text>`;
      o += `</g>`;
    });
  }
  return o;
}

// ------------------------------------------------------------------ resource histogram panel
// One bar per week beside the chart rows: stacked by series (labour, plant, water…), with an optional table of
// the weekly total and the running total.
export function weekStart(p, ms) { const d = new Date(ms); const back = (d.getUTCDay() - (p.time.week_start ?? 1) + 7) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - back * DAY; }
export function weeklySeries(p) {
  const rs = p.resources || {}, out = [];
  for (const s of rs.series || []) {
    const m = new Map();
    for (const [d, v] of Object.entries(s.values || {})) { const k = weekStart(p, tms(d)); m.set(k, (m.get(k) || 0) + (+v || 0)); }
    out.push({ ...s, weeks: m });
  }
  return out;
}
export function resourcesSvg(p, G) {
  const W0 = G.xs.resW; if (!W0) return "";
  const rp = p.resources.panel || {}, series = weeklySeries(p).filter(s => s.show !== false), fs = G.compact ? 8 : 9;
  const x0 = G.xs.res + 8, tableW = rp.table ? 96 * (G.compact ? 0.8 : 1) : 0, barW = W0 - tableW - 14;
  const wk0 = weekStart(p, G.t0), keys = [];
  for (let d = wk0; d < G.t1; d += 7 * DAY) keys.push(d);
  const tot = keys.map(k => series.reduce((n, s) => n + (s.weeks.get(k) || 0), 0)), max = Math.max(1, ...tot);
  let o = `<rect x="${f1(x0 - 4)}" y="${G.top}" width="${f1(W0 - 6)}" height="${G.GH}" fill="none" stroke="${PAPER.rule}"/>`;
  // heading and key above the panel
  o += t(x0, G.top - 30, rp.title || "Resources", `font-size="${fs + 1}" font-weight="700" font-family="${FONT}"`);
  series.forEach((s, i) => { const yy = G.top - 18 + (i % 2) * 10, xx = x0 + Math.floor(i / 2) * 70; o += `<rect x="${f1(xx)}" y="${yy - 6}" width="7" height="7" fill="${s.colour}"/>` + t(xx + 10, yy, clip(s.name, 11), `font-size="${fs - 1}" font-family="${FONT}"`); });
  if (tableW) { o += t(x0 + barW + 8 + tableW * 0.42, G.top - 6, "Week", `text-anchor="end" font-size="${fs - 1}" font-family="${FONT}"`, PAPER.muted) + t(x0 + barW + 8 + tableW - 4, G.top - 6, "To date", `text-anchor="end" font-size="${fs - 1}" font-family="${FONT}"`, PAPER.muted); }
  o += t(x0 + barW, G.top - 6, max.toLocaleString(), `text-anchor="end" font-size="${fs - 1}" font-family="${MONO}"`, PAPER.muted);
  let cum = 0;
  keys.forEach((k, i) => {
    const ya = G.Y(Math.max(k, G.t0)), yb = G.Y(Math.min(k + 7 * DAY, G.t1)), y = Math.min(ya, yb), hh = Math.max(0.6, Math.abs(yb - ya) - (Math.abs(yb - ya) > 4 ? 1 : 0));
    let x = x0;
    for (const s of series) { const v = s.weeks.get(k) || 0; if (!v) continue; const w = (v / max) * barW; o += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(hh)}" fill="${s.colour}"><title>${esc(s.name)} · week of ${niceDate(k)}: ${v.toLocaleString()} ${esc(s.unit || "")}</title></rect>`; x += w; }
    cum += tot[i];
    if (tableW && Math.abs(yb - ya) >= fs) {
      o += t(x0 + barW + 8 + tableW * 0.42, y + hh / 2 + 3, tot[i] ? Math.round(tot[i]).toLocaleString() : "", `text-anchor="end" font-size="${fs - 1}" font-family="${MONO}"`, PAPER.ink);
      o += t(x0 + barW + 8 + tableW - 4, y + hh / 2 + 3, Math.round(cum).toLocaleString(), `text-anchor="end" font-size="${fs - 1}" font-family="${MONO}"`, PAPER.muted);
    }
  });
  return o;
}

// ------------------------------------------------------------------ overlays on the grid
export function crewKey(p, a) { const by = p.view.crew_by || "crew"; return by === "wbs" ? a.wbs : by === "style" ? a.style : a.crew; }
export function overlaysSvg(p, G, mainActs, sel) {
  const S = Object.fromEntries(p.styles.map(s => [s.code, s])), fs = G.compact ? 9 : 11;
  let o = "";
  // crew steps: join a crew's activities into one stepped line (work, move, work)
  if (p.view.show_crews) {
    const groups = new Map();
    for (const a of mainActs) { const k = crewKey(p, a); if (!k || (S[a.style] || {}).kind === "milestone") continue; (groups.get(k) || groups.set(k, []).get(k)).push(a); }
    for (const [, list] of groups) {
      list.sort((a, b) => tms(a.start) - tms(b.start));
      for (let i = 0; i + 1 < list.length; i++) {
        const a = actGeo(p, G, list[i]), b = actGeo(p, G, list[i + 1]);
        if (tms(list[i + 1].start) < tms(list[i].finish) - 6 * 36e5) continue; // overlapping work is a second crew, not a move
        const col = (S[list[i].style] || {}).colour || PAPER.muted;
        o += `<path d="M${f1(a.x1)} ${f1(a.y1)}V${f1(b.y0)}H${f1(b.x0)}" fill="none" stroke="${col}" stroke-width="1.4" stroke-dasharray="4 3" stroke-opacity=".85"/>`;
      }
    }
  }
  // progress lines: actual or forecast position of a front by date
  for (const pl of p.progress_lines || []) {
    if (pl.show === false) continue;
    const pts = (pl.points || []).map(([d, m]) => [tms(d), m]).filter(([d, m]) => !isNaN(d) && m != null).sort((a, b) => a[0] - b[0]);
    if (pts.length < 2) continue;
    let d = `M${f1(G.X(pts[0][1]))} ${f1(G.Y(pts[0][0]))}`;
    for (let i = 1; i < pts.length; i++) d += pl.stepped === false ? `L${f1(G.X(pts[i][1]))} ${f1(G.Y(pts[i][0]))}` : `V${f1(G.Y(pts[i][0]))}H${f1(G.X(pts[i][1]))}`;
    const col = pl.colour || "#C00000", last = pts[pts.length - 1];
    o += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${pl.width || 2.2}" stroke-linejoin="round"><title>${esc(pl.name)}</title></path>`;
    o += t(G.X(last[1]) + 6, G.Y(last[0]) + 4, pl.name, `font-size="${fs - 1}" font-weight="600" font-family="${FONT}" ${HALO}`, col);
  }
  // haul arrows between a cut and a fill area
  for (const hl of p.hauls || []) {
    const a = (hl.from0_m + (hl.from1_m ?? hl.from0_m)) / 2, b = (hl.to0_m + (hl.to1_m ?? hl.to0_m)) / 2, xa = G.X(a), xb = G.X(b), y = G.Y(tms(hl.at));
    const bend = Math.max(26, Math.abs(xb - xa) * 0.22), col = hl.colour || "#7F6000", isSel = sel?.kind === "haul" && sel.id === hl.id;
    o += `<g data-haul="${hl.id}" class="haul"><defs><marker id="ha-${hl.id}" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="${col}"/></marker></defs>`;
    o += `<path d="M${f1(xa)} ${f1(y)}Q${f1((xa + xb) / 2)} ${f1(y - bend * 2)} ${f1(xb)} ${f1(y)}" fill="none" stroke="${isSel ? PAPER.sel : col}" stroke-width="${isSel ? 4 : 2.6}" stroke-opacity=".85" marker-end="url(#ha-${hl.id})"/>`;
    o += `<path d="M${f1(xa)} ${f1(y)}Q${f1((xa + xb) / 2)} ${f1(y - bend * 2)} ${f1(xb)} ${f1(y)}" fill="none" stroke="transparent" stroke-width="14"/>`;
    if (hl.label) o += t((xa + xb) / 2, y - bend - 4, hl.label, `text-anchor="middle" font-size="${fs - 1}" font-weight="600" font-family="${FONT}" ${HALO}`, col);
    o += `</g>`;
  }
  // text notes placed at a chainage and date
  for (const n of p.notes || []) {
    const x = G.X(n.ch_m), y = G.Y(tms(n.at)), size = n.size || fs + 1, col = n.colour || PAPER.ink, isSel = sel?.kind === "note" && sel.id === n.id;
    o += `<g data-note="${n.id}" class="note">`;
    if (n.leader_ch_m != null && n.leader_at) { const lx = G.X(n.leader_ch_m), ly = G.Y(tms(n.leader_at)); o += `<line x1="${f1(x)}" y1="${f1(y)}" x2="${f1(lx)}" y2="${f1(ly)}" stroke="${col}" stroke-width="1"/><circle cx="${f1(lx)}" cy="${f1(ly)}" r="2.4" fill="${col}"/>`; }
    const w = String(n.text || "").length * size * 0.56 + 10;
    o += `<g transform="translate(${f1(x)},${f1(y)}) rotate(${-(+n.angle || 0)})">`;
    if (n.box || isSel) o += `<rect x="-5" y="${f1(-size - 3)}" width="${f1(w)}" height="${f1(size + 9)}" rx="2" fill="${n.box ? PAPER.sheet : "none"}" stroke="${isSel ? PAPER.sel : col}" stroke-width="${isSel ? 2 : 0.8}"/>`;
    o += `<text x="0" y="0" font-size="${size}" font-weight="${n.bold ? 700 : 500}" font-style="${n.italic ? "italic" : "normal"}" font-family="${FONT}" fill="${col}" ${n.box ? "" : HALO}>${esc(n.text)}</text></g></g>`;
  }
  return o;
}

// ------------------------------------------------------------------ pins on the header image (aerial or map strip)
export function headerPinsSvg(p, G) {
  if (!G.img) return "";
  const lo = Math.min(p.chainage.start_m, p.chainage.end_m), hi = Math.max(p.chainage.start_m, p.chainage.end_m);
  let o = "";
  for (const l of p.locations) {
    if (!l.pin || l.ch_m < lo || l.ch_m > hi) continue;
    const x = G.X(l.ch_m), y = G.img.y + G.img.h * (l.pin_y ?? 0.6), tm = p.location_types.find(tt => tt.id === l.type) || {}, col = l.colour || tm.colour || "#C00000";
    o += `<g data-loc="${l.id}" class="loc"><path d="M${f1(x)} ${f1(y)}c-2 -6 -7 -9 -7 -14a7 7 0 1 1 14 0c0 5 -5 8 -7 14z" fill="${col}" stroke="#fff" stroke-width="1.2"/><circle cx="${f1(x)}" cy="${f1(y - 14)}" r="2.6" fill="#fff"/>`;
    o += t(x, y - 25, l.name, `text-anchor="middle" font-size="${G.compact ? 9 : 11}" font-weight="600" font-family="${FONT}" paint-order="stroke" stroke="#18262B" stroke-width="3"`, "#FFFFFF") + `</g>`;
  }
  return o;
}
