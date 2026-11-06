// Time-chainage drawing engine. Produces SVG markup for the screen and for the printed page.
// Chainage runs across, time runs down (or up). Everything is placed through one geometry object.
import { DAY, MON, tms, esc, chFmt, chUnitLabel, lenFmt, isoWeek, labelText, niceDate, niceFinish } from "./util.js";
import { bandHeight, bandsSvg, sideColsSvg, resourcesSvg, overlaysSvg, headerPinsSvg, onChart, actGeo } from "./extras.js";

export const PAPER = { ink: "#18262B", muted: "#5D6B70", rule: "#C9D2D2", faint: "#EEF2F1", band: "#EDF2F1", band2: "#E2EAE8",
  sheet: "#FFFFFF", ghost: "#9AA5A8", hatch: "#9AA7AA", sel: "#E0A400", link: "#C00000" };
// Fallbacks cover non-Latin scripts (Thai, CJK) when the chart is printed or rendered to video
export const FONT = "IBM Plex Sans Condensed, Arial Narrow, Arial, Leelawadee UI, Tahoma, Noto Sans Thai, Microsoft YaHei, sans-serif";
const MONO = "IBM Plex Mono, Consolas, monospace";

export function styleMap(p) { return Object.fromEntries(p.styles.map(s => [s.code, s])); }
function typeMap(p) { return Object.fromEntries(p.location_types.map(t => [t.id, t])); }

// ------------------------------------------------------------------ geometry
export function geometry(p, opts = {}) {
  const { width = 1200, ppd = null, height = null, compact = false, noHeader = false, squeeze = 1 } = opts;
  const c = p.chainage, T = p.time;
  // left to right: month column | period column (if on the left) | side columns | grid | side columns | period column | month column | resources
  const per = T.period_labels || "weeks", perSide = per === "none" ? null : T.period_side || "right", monSide = T.month_side || "left";
  const monW = compact ? 58 : 78, perW = compact ? 40 : 54;
  const cols = (p.side_cols || []).filter(s => s.show !== false);
  const colW = s => (s.width || 90) * (compact ? 0.75 : 1);
  const colsLW = cols.filter(s => s.side !== "right").reduce((n, s) => n + colW(s), 0), colsRW = cols.filter(s => s.side === "right").reduce((n, s) => n + colW(s), 0);
  const rs = p.resources || {}, rp = rs.panel || {};
  const resW = !noHeader && rp.show && (rs.series || []).length ? ((rp.width || 150) + (rp.table ? 96 : 0)) * (compact ? 0.8 : 1) : 0;
  const ML = monW + (perSide === "left" ? perW : 0) + colsLW;
  const MR = (perSide === "right" ? perW : 14) + (monSide !== "left" ? monW - 14 : 0) + colsRW + resW;
  const W = Math.max(compact ? 300 : 700, width, compact ? 0 : ML + MR + 480), PW = Math.max(60, W - ML - MR);
  // broken chainage: empty stretches between work areas are squeezed to a narrow gap with a break symbol
  const cLo = Math.min(c.start_m, c.end_m), cHi = Math.max(c.start_m, c.end_m), span = (cHi - cLo) || 1;
  const breaks = [];
  for (const b of (c.breaks || []).map(b => [Math.max(cLo, Math.min(b.from_m, b.to_m)), Math.min(cHi, Math.max(b.from_m, b.to_m))]).filter(([a, b]) => b - a > 1e-6).sort((x, y) => x[0] - y[0])) {
    const l = breaks[breaks.length - 1]; if (l && b[0] <= l[1]) l[1] = Math.max(l[1], b[1]); else breaks.push(b);
  }
  const BP = compact ? 12 : 18, live = Math.max(1e-6, span - breaks.reduce((n, [a, b]) => n + b - a, 0)), k = Math.max(1e-9, (PW - BP * breaks.length) / live);
  const fwd = m => { let px = 0, prev = cLo; for (const [a, b] of breaks) { if (m <= a) return px + (m - prev) * k; px += (a - prev) * k; if (m < b) return px + BP * (m - a) / (b - a); px += BP; prev = b; } return px + (m - prev) * k; };
  const inv = f => { let px = 0, prev = cLo; for (const [a, b] of breaks) { const pa = px + (a - prev) * k; if (f <= pa) return prev + (f - px) / k; if (f < pa + BP) return a + (b - a) * (f - pa) / BP; px = pa + BP; prev = b; } return prev + (f - px) / k; };
  const X = m => ML + (c.reverse ? PW - fwd(m) : fwd(m));
  const Xi = x => inv(c.reverse ? PW - (x - ML) : x - ML);
  const types = typeMap(p);
  // header rows: sections band, then location rows; a row that shows labels is tall enough for vertical text
  const nrows = Math.max(1, p.location_rows || 4);
  const rowOf = l => Math.min(nrows, Math.max(1, l.row || (types[l.type] || {}).row || nrows));
  const rowH = [];
  for (let r = 1; r <= nrows; r++) {
    const lab = p.locations.filter(l => rowOf(l) === r && l.label && l.ch_m >= c.start_m - 1 && l.ch_m <= c.end_m + 1);
    const any = p.locations.some(l => rowOf(l) === r);
    const longest = lab.reduce((m, l) => Math.max(m, (l.name || "").length + 9), 0);
    rowH.push(noHeader || !any ? 0 : (lab.length ? Math.min(compact ? 90 : 150, 18 + longest * (compact ? 4.6 : 5.6)) : 16) * (lab.length ? squeeze : 1));
  }
  const SH = !noHeader && p.sections.length ? 30 : 0;
  const AX = 24;
  // header image: stretched between two chainages (or the full chart width), above the section bands
  const L0 = Math.min(X(c.start_m), X(c.end_m)), R0 = Math.max(X(c.start_m), X(c.end_m));
  const hi = !noHeader && p.header_image && p.header_image.data && p.header_image.show !== false ? p.header_image : null;
  let img = null;
  if (hi) {
    const a = hi.fit === "full" ? L0 : X(hi.ch_start_m ?? c.start_m), b = hi.fit === "full" ? R0 : X(hi.ch_end_m ?? c.end_m);
    const w = Math.abs(b - a);
    const ih = hi.height_px > 0 ? hi.height_px * (compact ? 0.7 : 1) : w * ((hi.nat_h || 1) / (hi.nat_w || 1));
    img = { x: Math.min(a, b), y: 6, w, h: Math.min(ih, compact ? 420 : 900) * squeeze };
  }
  const headTop = 6 + (img ? img.h + 6 : 0);
  const rowsTop = headTop + SH + 4;
  // bands (long section, quantities, extents, plan, strips) above the chainage axis or below the chart
  const bands = noHeader ? [] : (p.bands || []).filter(b => b.show !== false);
  const bh = b => Math.max(16, bandHeight(b, compact) * squeeze);
  const aboveTop = rowsTop + rowH.reduce((a, b) => a + b, 0);
  const aboveH = bands.filter(b => b.position === "above").reduce((n, b) => n + bh(b) + 6, 0);
  const ax = c.axis || "both", axTop = ax === "both" || ax === "top", axBot = ax === "both" || ax === "bottom";
  const top = aboveTop + aboveH + (axTop ? AX : 8);
  const t0 = tms(T.start), t1 = tms(T.finish) + DAY;
  const nd = Math.max(1, (t1 - t0) / DAY);
  const belowH = bands.filter(b => b.position !== "above").reduce((n, b) => n + bh(b) + 6, 0);
  const bottomPad = (axBot ? 36 : 12) + belowH;
  let px = ppd || T.px_per_day || 2;
  if (height && squeeze === 1 && top + bottomPad > height * 0.5) return geometry(p, { ...opts, squeeze: Math.max(0.25, (height * 0.5 - 40) / Math.max(1, top + bottomPad - 40)) });
  if (height) px = Math.max(0.05, (height - top - bottomPad) / nd);
  const GH = nd * px;
  const up = T.orientation === "up";
  const Y = ms => (up ? top + GH - ((ms - t0) / DAY) * px : top + ((ms - t0) / DAY) * px);
  const Yi = y => (up ? t0 + ((top + GH - y) / px) * DAY : t0 + ((y - top) / px) * DAY);
  // where the side columns sit, and the x positions of the date columns
  const colPos = []; let xl = ML - colsLW, xr = R0;
  for (const s of cols) { const w = colW(s); if (s.side === "right") { colPos.push({ s, x: xr, w }); xr += w; } else { colPos.push({ s, x: xl, w }); xl += w; } }
  const edgeL = ML - colsLW, edgeR = R0 + colsRW;
  const xs = {
    monL: monSide !== "right" ? edgeL - (perSide === "left" ? perW : 0) - 10 : null,
    perL: perSide === "left" ? edgeL - 6 : null,
    perR: perSide === "right" ? edgeR + 6 : null,
    monR: monSide !== "left" ? edgeR + (perSide === "right" ? perW : 0) + 8 : null,
    res: W - resW, resW,
  };
  const breakPx = breaks.map(([a, b]) => [a, b, X(a), X(b)]);
  return { W, H: top + GH + bottomPad, ML, MR, PW, X, Xi, Y, Yi, top, GH, t0, t1, ppd: px, nd, SH, rowsTop, rowH, rowOf, headTop, AX, compact, img, noHeader, L: L0, R: R0,
    cols: colPos, edgeL, edgeR, xs, breaks: breakPx, aboveTop, bands, bandH: bh, axTop, axBot, belowTop: top + GH + (axBot ? 34 : 10) };
}

// The symbol for a location on a header line at y = base (a..b is its extent for ranged locations).
export function locSymbol(symbol, x, a, b, base, col) {
  switch (symbol) {
    case "trapezoid": { const aa = b - a < 16 ? (a + b) / 2 - 8 : a, bb = b - a < 16 ? (a + b) / 2 + 8 : b;
      return `<path d="M${aa} ${base} L${aa + 4} ${base - 7} L${bb - 4} ${base - 7} L${bb} ${base}" fill="none" stroke="${col}" stroke-width="2.4"/>`; }
    case "circle": return `<circle cx="${x}" cy="${base}" r="4.5" fill="${PAPER.sheet}" stroke="${col}" stroke-width="2.2"/>`;
    case "tick": return `<line x1="${x}" x2="${x}" y1="${base - 8}" y2="${base + 4}" stroke="${col}" stroke-width="2"/>`;
    case "box": return `<rect x="${Math.min(a, x - 3)}" y="${base - 6}" width="${Math.max(6, b - a)}" height="10" fill="${PAPER.sheet}" stroke="${col}" stroke-width="1.5"/>`;
    case "triangle": return `<path d="M${x - 5} ${base + 3} L${x} ${base - 7} L${x + 5} ${base + 3}Z" fill="${col}"/>`;
    case "bar": return `<line x1="${x}" x2="${x}" y1="${base - 10}" y2="${base + 5}" stroke="${col}" stroke-width="3.5"/>`;
    case "band": return `<rect x="${a}" y="${base - 5}" width="${Math.max(3, b - a)}" height="8" fill="${col}" fill-opacity=".45" stroke="${col}"/>`;
    default: return `<path d="M${x} ${base - 6} L${x + 5} ${base} L${x} ${base + 6} L${x - 5} ${base}Z" fill="${PAPER.sheet}" stroke="${col}" stroke-width="1.5"/>`;
  }
}

const T = (x, y, s, attrs = "", style = "") => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${attrs} style="${style}">${esc(s)}</text>`;
const halo = `paint-order="stroke" stroke="${PAPER.sheet}" stroke-width="3" stroke-linejoin="round"`;
const dashOf = d => (d === "dash" ? 'stroke-dasharray="10 6"' : d === "dot" ? 'stroke-dasharray="2 4"' : "");

// ---- line marks: symbols repeated along a line, so styles can be told apart in black and white
export const MARKS = [["none", "None"], ["tick", "Ticks"], ["arrow", "Arrows (direction of work)"], ["chevron", "V marks"], ["cross", "Crosses"], ["dot", "Dots"], ["flag", "Triangles"]];
export function marksSvg(kind, x0, y0, x1, y1, col, width = 2, spacing = 22, extra = "") {
  if (!kind || kind === "none") return "";
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy); if (len < 6) return "";
  const ux = dx / len, uy = dy / len; let nx = -uy, ny = ux;
  if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; } // marks stand on the upper side of the line
  const s = 3 + Math.min(4, width), n = Math.max(1, Math.floor(len / Math.max(6, spacing))), step = len / n, P = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  let d = "", f = "";
  for (let i = 0; i < n; i++) {
    const t = step * (i + 0.5), x = x0 + ux * t, y = y0 + uy * t;
    if (kind === "tick") d += `M${P(x, y)}L${P(x + nx * s, y + ny * s)}`;
    else if (kind === "arrow") d += `M${P(x - ux * s + nx * s * 0.6, y - uy * s + ny * s * 0.6)}L${P(x, y)}L${P(x - ux * s - nx * s * 0.6, y - uy * s - ny * s * 0.6)}`;
    else if (kind === "chevron") d += `M${P(x - ux * s * 0.6 + nx * s, y - uy * s * 0.6 + ny * s)}L${P(x, y)}L${P(x + ux * s * 0.6 + nx * s, y + uy * s * 0.6 + ny * s)}`;
    else if (kind === "cross") { const a = s * 0.6; d += `M${P(x - (ux + nx) * a, y - (uy + ny) * a)}L${P(x + (ux + nx) * a, y + (uy + ny) * a)}M${P(x - (ux - nx) * a, y - (uy - ny) * a)}L${P(x + (ux - nx) * a, y + (uy - ny) * a)}`; }
    else if (kind === "dot") { const r = s * 0.45; f += `M${P(x - r, y)}a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(2 * r).toFixed(1)} 0a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-2 * r).toFixed(1)} 0`; }
    else if (kind === "flag") f += `M${P(x - ux * s * 0.5, y - uy * s * 0.5)}L${P(x + nx * s * 1.2, y + ny * s * 1.2)}L${P(x + ux * s * 0.5, y + uy * s * 0.5)}Z`;
  }
  return (d ? `<path d="${d}" fill="none" stroke="${col}" stroke-width="${Math.max(1, Math.min(2, width * 0.5))}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>` : "") + (f ? `<path d="${f}" fill="${col}" ${extra}/>` : "");
}

// ---- area fills for blocks, cut and fill: solid, hatched, cross-hatched, dotted or outline only
export const FILLS = [["solid", "Solid"], ["hatch", "Hatched"], ["crosshatch", "Cross-hatched"], ["dots", "Dotted"], ["none", "Outline only"]];
export function areaPaint(st, col, defs) {
  const pat = st.fill_pattern || "solid", op = st.fill_opacity ?? 0.35;
  if (st.fill_colour && col === st.colour) col = st.fill_colour; // a style can fill with its own colour (outline in the line colour)
  if (pat === "none") return `fill="${col}" fill-opacity="0"`;
  if (pat === "solid" || !defs) return `fill="${col}" fill-opacity="${op}"`;
  const id = `fp-${pat}-${String(col).replace(/[^0-9a-z]/gi, "")}-${Math.round(op * 100)}`;
  if (!defs.has(id)) {
    const ln = `stroke="${col}" stroke-width="1.2"`;
    const inner = pat === "hatch" ? `<path d="M4 0V8" ${ln}/>` : pat === "crosshatch" ? `<path d="M4 0V8M0 4H8" ${ln}/>` : `<circle cx="4" cy="4" r="1.3" fill="${col}"/>`;
    defs.set(id, `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"${pat === "dots" ? "" : ' patternTransform="rotate(45)"'}><rect width="8" height="8" fill="${col}" fill-opacity="${(op * 0.5).toFixed(2)}"/>${inner}</pattern>`);
  }
  return `fill="url(#${id})"`;
}

// ------------------------------------------------------------------ main chart
let chartSeq = 0;
export function renderChart(p, opts = {}) {
  const G = geometry(p, opts);
  G.idp = `tc${++chartSeq}-`; // ids unique per chart, so several charts on one page keep their own clipping
  const { W, H, ML, X, Y, top, GH, t0, t1, L, R } = G;
  const c = p.chainage, S = styleMap(p), types = typeMap(p), view = p.view || {};
  const fs = G.compact ? 9 : 11;
  let o = `<defs>
    <clipPath id="${G.idp}grid"><rect x="${L}" y="${top}" width="${R - L}" height="${GH}"/></clipPath>
    <pattern id="hatchA" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${PAPER.hatch}" stroke-width="1.3"/></pattern>
  </defs>`;
  o += `<rect width="${W}" height="${H}" fill="${PAPER.sheet}"/>`;

  // ---- header image
  if (G.img) {
    const hi = p.header_image;
    o += `<image href="${hi.data}" x="${G.img.x.toFixed(1)}" y="${G.img.y}" width="${G.img.w.toFixed(1)}" height="${G.img.h.toFixed(1)}" preserveAspectRatio="${hi.keep_ratio ? "xMidYMid meet" : "none"}" opacity="${hi.opacity ?? 1}" data-hdr="1"/>`;
    o += headerPinsSvg(p, G);
  }

  // ---- header: sections
  if (!G.noHeader) p.sections.forEach((s, i) => {
    const a = Math.max(L, Math.min(X(s.from_m), X(s.to_m))), b = Math.min(R, Math.max(X(s.from_m), X(s.to_m))), w = b - a, cx = (a + b) / 2;
    if (w <= 0.5) return;
    o += `<rect x="${a}" y="${G.headTop}" width="${w}" height="${G.SH - 2}" fill="${i % 2 ? PAPER.band2 : PAPER.band}" stroke="${PAPER.rule}" stroke-width=".6"/>`;
    const nm = s.name.length * (fs * 0.55) < w - 6 ? s.name : w > 30 ? `S${i + 1}` : "";
    if (nm) o += T(cx, G.headTop + 13, nm, `text-anchor="middle" font-size="${fs}" font-weight="600" font-family="${FONT}"`, `fill:${PAPER.ink}`);
    if (w > 60) o += T(cx, G.headTop + 25, lenFmt(p, Math.abs(s.to_m - s.from_m)),
      `text-anchor="middle" font-size="${fs - 2}" font-family="${MONO}"`, `fill:${PAPER.muted}`);
  });

  // ---- header: location rows
  let ry = G.rowsTop;
  for (let r = 1; r <= G.rowH.length; r++) {
    const rh = G.rowH[r - 1];
    if (!rh) continue;
    const base = ry + rh - 6;
    if (r === 1) o += `<line x1="${L}" x2="${R}" y1="${base}" y2="${base}" stroke="${PAPER.ink}" stroke-width="2"/>`;
    else o += `<line x1="${L}" x2="${R}" y1="${ry + rh}" y2="${ry + rh}" stroke="${PAPER.faint}"/>`;
    p.locations.filter(l => G.rowOf(l) === r).forEach(l => {
      if (l.ch_m < c.start_m - 1 || l.ch_m > c.end_m + 1) return;
      const t = types[l.type] || { colour: PAPER.muted, symbol: "diamond" };
      const x = X(l.ch_m), x2 = l.to_m != null ? X(l.to_m) : x, col = l.colour || t.colour, sel = opts.selection?.kind === "loc" && opts.selection.id === l.id;
      let g = `<g data-loc="${l.id}" class="loc"><title>${esc(l.name)} · ${chFmt(p, l.ch_m)}${l.to_m != null ? "–" + chFmt(p, l.to_m) : ""}${l.notes ? " · " + esc(l.notes) : ""}</title>`;
      const a = Math.min(x, x2), b = Math.max(x, x2);
      g += `<rect x="${a - 5}" y="${ry}" width="${Math.max(10, b - a + 10)}" height="${rh}" fill="transparent"/>`;
      g += locSymbol(t.symbol, x, a, b, base, col);
      if (l.label) g += `<text transform="translate(${(x + 3).toFixed(1)},${(base - 10).toFixed(1)}) rotate(-90)" font-size="${fs - 1}" font-family="${FONT}" fill="${PAPER.ink}" ${sel ? 'text-decoration="underline"' : ""}>${esc(l.name)}<tspan dx="5" fill="${col}" font-family="${MONO}" font-size="${fs - 2}">${chFmt(p, l.ch_m)}</tspan></text>`;
      if (sel) g += `<rect x="${a - 6}" y="${ry + 1}" width="${Math.max(12, b - a + 12)}" height="${rh - 2}" fill="none" stroke="${PAPER.sel}" stroke-width="2"/>`;
      o += g + "</g>";
    });
    ry += rh;
  }

  // ---- bands above the chainage axis
  o += bandsSvg(p, G, "above");
  // ---- chainage axes
  if (G.axTop) o += chainageAxis(p, G, top - 2, true);
  if (G.axBot) o += chainageAxis(p, G, top + GH + 2, false);

  // ---- grid background, weekends, weeks, months
  o += `<rect x="${L}" y="${top}" width="${R - L}" height="${GH}" fill="${PAPER.sheet}"/>`;
  if (p.time.shade_weekends && G.ppd >= 4) {
    for (let d = t0; d < t1; d += DAY) { const wd = new Date(d).getUTCDay(); if (wd === 0 || wd === 6) o += `<rect x="${L}" y="${Math.min(Y(d), Y(d + DAY))}" width="${R - L}" height="${G.ppd}" fill="${PAPER.faint}"/>`; }
  }
  if (G.ppd >= 10) for (let d = t0; d <= t1; d += DAY) o += `<line x1="${L}" x2="${R}" y1="${Y(d)}" y2="${Y(d)}" stroke="${PAPER.rule}" stroke-width=".3"/>`;
  const wk0 = (() => { const d = new Date(t0); const back = (d.getUTCDay() - (p.time.week_start ?? 1) + 7) % 7; return t0 - back * DAY; })();
  const wstep = G.ppd * 7 >= 13 ? 1 : G.ppd * 7 >= 6 ? 2 : G.ppd * 7 >= 3 ? 4 : 8;
  // period column: week numbers (project, ISO or week-start dates), months since the start, or project years
  const per = p.time.period_labels || "weeks", xs = G.xs;
  const perAt = (y, lab) => { if (xs.perR != null) o += T(xs.perR, y, lab, `font-size="${fs - 2}" font-family="${MONO}"`, `fill:${PAPER.muted}`);
    if (xs.perL != null) o += T(xs.perL, y, lab, `text-anchor="end" font-size="${fs - 2}" font-family="${MONO}"`, `fill:${PAPER.muted}`); };
  const origin = tms(p.time.period_origin || p.time.start);
  let wn = 0;
  for (let d = wk0; d <= t1; d += 7 * DAY, wn++) {
    if (d < t0) continue;
    o += `<line x1="${L}" x2="${R}" y1="${Y(d)}" y2="${Y(d)}" stroke="${PAPER.rule}" stroke-width="${G.ppd * 7 >= 6 ? 0.5 : 0.3}"/>`;
    if (per === "weeks" && wn % wstep === 0 && d + 7 * DAY <= t1 + DAY) {
      const lab = p.time.week_labels === "iso" ? "W" + isoWeek(d) : p.time.week_labels === "date" ? niceDate(d, false) : "W" + (Math.floor((d - wk0) / (7 * DAY)) + 1);
      perAt((Y(d) + Y(d + 7 * DAY)) / 2 + 3, lab);
    }
  }
  if (per === "months" || per === "years") {
    const od = new Date(origin);
    for (let n = 0; n < 1200; n++) {
      const a = per === "years" ? Date.UTC(od.getUTCFullYear() + n, od.getUTCMonth(), od.getUTCDate()) : Date.UTC(od.getUTCFullYear(), od.getUTCMonth() + n, od.getUTCDate());
      const b = per === "years" ? Date.UTC(od.getUTCFullYear() + n + 1, od.getUTCMonth(), od.getUTCDate()) : Date.UTC(od.getUTCFullYear(), od.getUTCMonth() + n + 1, od.getUTCDate());
      if (a >= t1) break; if (b <= t0) continue;
      const ya = Y(Math.max(a, t0)), yb = Y(Math.min(b, t1));
      if (per === "years") { [xs.perR != null ? xs.perR - 6 : null, xs.perL != null ? xs.perL - (fs * 4) : null].forEach(x0 => { if (x0 != null) o += `<line x1="${x0}" x2="${x0 + fs * 4 + 6}" y1="${Y(a)}" y2="${Y(a)}" stroke="${PAPER.muted}" stroke-width="1"/>`; }); }
      if (Math.abs(yb - ya) >= 10) perAt((ya + yb) / 2 + 3, (per === "years" ? "Y" : "M") + (n + 1));
    }
  }
  const sd = new Date(t0); let m = Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), 1), first = true;
  const monAt = (x, anchor, y, s, attrs) => { if (x != null) o += T(x, y, s, `text-anchor="${anchor}" ${attrs}`, `fill:${attrs.includes(MONO) ? PAPER.muted : PAPER.ink}`); };
  while (m < t1) {
    const dt = new Date(m), next = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1);
    if (m >= t0) o += `<line x1="${xs.monL != null ? L - 8 : L}" x2="${xs.monR != null ? R + 8 : R}" y1="${Y(m)}" y2="${Y(m)}" stroke="${PAPER.muted}" stroke-opacity=".55" stroke-width="1"/>`;
    const a = Math.max(m, t0), b = Math.min(next, t1), span = Math.abs(Y(b) - Y(a)), ym = Math.min(Y(a), Y(b));
    if (span >= 11) {
      const ma = `font-size="${fs}" font-weight="600" font-family="${FONT}"`, ya = `font-size="${fs - 2}" font-family="${MONO}"`;
      monAt(xs.monL, "end", ym + 11, MON[dt.getUTCMonth()], ma); monAt(xs.monR, "start", ym + 11, MON[dt.getUTCMonth()], ma);
      if ((dt.getUTCMonth() === 0 || first) && span >= 22) { monAt(xs.monL, "end", ym + 22, dt.getUTCFullYear(), ya); monAt(xs.monR, "start", ym + 22, dt.getUTCFullYear(), ya); }
    }
    first = false; m = next;
  }
  // side columns for work with no chainage (design, approvals, procurement), and the resource panel
  o += sideColsSvg(p, G) + resourcesSvg(p, G);

  o += `<g clip-path="url(#${G.idp}grid)">`;
  // ---- section boundaries and location grid lines
  if (view.show_location_grid !== false) {
    p.sections.forEach(s => [s.from_m, s.to_m].forEach(v => { o += `<line x1="${X(v)}" x2="${X(v)}" y1="${top}" y2="${top + GH}" stroke="${PAPER.muted}" stroke-opacity=".35" stroke-width="1"/>`; }));
    p.locations.forEach(l => {
      const t = types[l.type] || {}; if (!(l.grid ?? t.grid)) return;
      const col = l.colour || t.colour || PAPER.muted, x = X(l.ch_m);
      if (l.to_m != null && Math.abs(X(l.to_m) - x) > 2) o += `<rect x="${Math.min(x, X(l.to_m))}" y="${top}" width="${Math.abs(X(l.to_m) - x)}" height="${GH}" fill="${col}" fill-opacity=".09"/>`;
      o += `<line x1="${x}" x2="${x}" y1="${top}" y2="${top + GH}" stroke="${col}" stroke-opacity=".7" stroke-width=".9" ${l.type === "limit" ? "" : 'stroke-dasharray="3 3"'}/>`;
    });
  }
  // ---- chainage breaks: the squeezed gap is shaded with a zigzag at each edge
  for (const [, , xa, xb] of G.breaks) {
    o += `<rect x="${Math.min(xa, xb)}" y="${top}" width="${Math.abs(xb - xa)}" height="${GH}" fill="${PAPER.band2}"/>`;
    [xa, xb].forEach(x => { o += `<line x1="${x}" x2="${x}" y1="${top}" y2="${top + GH}" stroke="${PAPER.muted}" stroke-width=".8"/>`; });
  }
  // ---- the chainage scale repeated part-way down a long chart
  if (+p.chainage.repeat_days > 0) for (let d = t0 + p.chainage.repeat_days * DAY; d < t1 - 20 * DAY; d += p.chainage.repeat_days * DAY) o += chainageAxis(p, G, Y(d), false, true);
  // ---- time markers
  if (view.show_time_markers !== false) p.time_markers.forEach(mk => {
    const a = mk.ch0_m != null ? X(mk.ch0_m) : L, b = mk.ch1_m != null ? X(mk.ch1_m) : R, xa = Math.min(a, b), xb = Math.max(a, b);
    const ys = Y(tms(mk.start)), col = mk.colour || PAPER.muted, sel = opts.selection?.kind === "mk" && opts.selection.id === mk.id;
    let g = `<g data-mk="${mk.id}" class="mk"><title>${esc(mk.label)} · ${niceDate(tms(mk.start))}${mk.finish ? " – " + niceFinish(tms(mk.finish)) : ""}</title>`;
    if ((mk.kind === "milestone" || !mk.finish) && mk.label_style === "boxed") {
      // a solid line across with the label in a box in the middle (award, site access, completion)
      const bw = Math.min(xb - xa - 10, (mk.label || "").length * (fs + 2) * 0.56 + 20), bx = (xa + xb) / 2 - bw / 2;
      g += `<line x1="${xa}" x2="${xb}" y1="${ys}" y2="${ys}" stroke="${col}" stroke-width="${sel ? 3.4 : 2}"/>`;
      g += `<rect x="${bx}" y="${ys - fs - 2}" width="${bw}" height="${2 * fs + 4}" rx="2" fill="${PAPER.sheet}" stroke="${sel ? PAPER.sel : col}" stroke-width="${sel ? 2.5 : 1.2}"/>`;
      g += T((xa + xb) / 2, ys + fs * 0.38, mk.label, `text-anchor="middle" font-size="${fs + 2}" font-weight="700" font-family="${FONT}"`, `fill:${col}`);
    } else if (mk.kind === "milestone" || !mk.finish) {
      g += `<line x1="${xa}" x2="${xb}" y1="${ys}" y2="${ys}" stroke="${col}" stroke-width="${sel ? 3 : 1.4}" stroke-dasharray="8 4"/>`;
      g += `<rect x="${xa}" y="${ys - 5}" width="${xb - xa}" height="10" fill="transparent"/>`;
      g += `<path d="M${xa + 8} ${ys - 6} l6 6 l-6 6 l-6 -6z" fill="${col}"/>`;
      g += T(xa + 20, ys - 5, mk.label, `font-size="${fs}" font-weight="600" font-family="${FONT}" ${halo}`, `fill:${col}`);
    } else {
      const ye = Y(tms(mk.finish)), y0 = Math.min(ys, ye), hh = Math.max(1.5, Math.abs(ye - ys));
      const fill = mk.kind === "shutdown" ? "url(#hatchA)" : col;
      g += `<rect x="${xa}" y="${y0}" width="${xb - xa}" height="${hh}" fill="${fill}" fill-opacity="${mk.kind === "shutdown" ? 1 : 0.22}" stroke="${sel ? PAPER.sel : col}" stroke-width="${sel ? 2.5 : 0.8}" stroke-opacity=".7"/>`;
      if (hh >= 7 || sel) g += T(xa + 6, y0 + Math.min(hh / 2 + 4, 12), mk.label, `font-size="${Math.min(fs, Math.max(8, hh))}" font-family="${FONT}" ${halo}`, `fill:${PAPER.ink}`);
    }
    o += g + "</g>";
  });

  // ---- activities
  const main = view.main_dataset, cmp = view.compare_dataset;
  const visible = a => (a.dataset === main || (cmp && a.dataset === cmp)) && onChart(p, a);
  const acts = p.activities.filter(visible);
  const ghostActs = acts.filter(a => a.dataset !== main), mainActs = acts.filter(a => a.dataset === main);
  const kindOrder = { block: 0, cut: 0, fill: 0, taper: 0, bar: 1, line: 2, milestone: 3 };
  mainActs.sort((a, b) => (kindOrder[S[a.style]?.kind] ?? 2) - (kindOrder[S[b.style]?.kind] ?? 2));
  const geo = a => actGeo(p, G, a);
  const actStart = o.length; // activity markup from here on is drawn twice during playback
  // footprints underneath everything
  if (view.show_footprints !== false) mainActs.forEach(a => {
    const st = S[a.style] || {}; const fp = { ...(st.footprint || {}), ...(a.footprint || {}) };
    if (!fp.enabled || ((fp.length_m || 0) <= 0 && (fp.lag_days || 0) <= 0)) return;
    const dir = Math.sign(a.ch1_m - a.ch0_m) || 1, len = fp.length_m || 0, lag = (fp.lag_days || 0) * DAY;
    const s = tms(a.start), f = tms(a.finish);
    const pts = [[a.ch0_m, s], [a.ch1_m, f], [a.ch1_m - dir * len, f + lag], [a.ch0_m - dir * len, s + lag]];
    o += `<polygon data-act="${a.id}" class="act fp" points="${pts.map(([cm, t]) => `${X(cm).toFixed(1)},${Y(t).toFixed(1)}`).join(" ")}" fill="${st.colour || PAPER.muted}" fill-opacity="${fp.opacity ?? 0.18}" stroke="${st.colour || PAPER.muted}" stroke-opacity=".5" stroke-width=".8"/>`;
  });
  const labels = [], pdefs = new Map();
  const drawAct = (a, ghost) => {
    const st = S[a.style] || { kind: "line", colour: PAPER.muted, width: 2, label: { show: true, text: "{name}" } };
    const col = ghost ? PAPER.ghost : st.colour, g = geo(a), sel = !ghost && opts.selection?.kind === "act" && opts.selection.id === a.id;
    const kind = st.kind || "line";
    let s = `<g ${ghost ? "" : `data-act="${a.id}" class="act"`} ${ghost ? 'opacity=".55"' : ""}><title>${esc(a.code)} ${esc(a.name)} · ${chFmt(p, a.ch0_m)}–${chFmt(p, a.ch1_m)} · ${niceDate(tms(a.start))} – ${niceFinish(tms(a.finish))}</title>`;
    if (kind === "block") {
      const xa = Math.min(g.x0, g.x1), w = Math.max(4, Math.abs(g.x1 - g.x0)), ya = Math.min(g.y0, g.y1), hh = Math.max(2, Math.abs(g.y1 - g.y0));
      const xx = Math.abs(g.x1 - g.x0) < 4 ? (g.x0 + g.x1) / 2 - 2 : xa;
      if (sel) s += `<rect x="${xx - 4}" y="${ya - 4}" width="${w + 8}" height="${hh + 8}" fill="none" stroke="${PAPER.sel}" stroke-width="2.5"/>`;
      s += `<rect x="${xx}" y="${ya}" width="${w}" height="${hh}" ${areaPaint(st, col, pdefs)} stroke="${col}" stroke-width="${st.width || 1.2}" ${dashOf(st.dash)}/>`;
    } else if (kind === "cut" || kind === "fill") {
      // earthworks: cut and fill as right-angle triangles (see triPath)
      const xa = Math.min(g.x0, g.x1), w = Math.max(6, Math.abs(g.x1 - g.x0)), ya = Math.min(g.y0, g.y1), hh = Math.max(4, Math.abs(g.y1 - g.y0));
      const xx = Math.abs(g.x1 - g.x0) < 6 ? (g.x0 + g.x1) / 2 - 3 : xa;
      if (sel) s += `<rect x="${xx - 4}" y="${ya - 4}" width="${w + 8}" height="${hh + 8}" fill="none" stroke="${PAPER.sel}" stroke-width="2.5"/>`;
      if (!ghost) s += `<rect x="${xx}" y="${ya}" width="${w}" height="${hh}" fill="transparent"/>`;
      s += `<path d="${triPath(kind, xx, ya, w, hh)}" ${areaPaint(st, col, pdefs)} stroke="${col}" stroke-width="${st.width || 1.2}" stroke-linejoin="round" ${dashOf(st.dash)}/>`;
    } else if (kind === "taper") {
      // an area whose chainage range changes over time: start range at the start date, finish range at the finish date
      const f0 = X(a.fin_ch0_m ?? a.ch0_m) + (g.dx || 0), f1 = X(a.fin_ch1_m ?? a.ch1_m) + (g.dx || 0);
      const pts = `${g.x0.toFixed(1)},${g.y0.toFixed(1)} ${g.x1.toFixed(1)},${g.y0.toFixed(1)} ${f1.toFixed(1)},${g.y1.toFixed(1)} ${f0.toFixed(1)},${g.y1.toFixed(1)}`;
      if (sel) s += `<polygon points="${pts}" fill="none" stroke="${PAPER.sel}" stroke-width="5" stroke-linejoin="round"/>`;
      s += `<polygon points="${pts}" ${areaPaint(st, col, pdefs)} stroke="${col}" stroke-width="${st.width || 1.2}" stroke-linejoin="round" ${dashOf(st.dash)}/>`;
    } else if (kind === "milestone") {
      if (Math.abs(g.x1 - g.x0) > 2) s += `<line x1="${g.x0}" x2="${g.x1}" y1="${g.y0}" y2="${g.y0}" stroke="${col}" stroke-width="${st.width || 2}" ${dashOf(st.dash)}/>`;
      s += `<path d="M${g.x0} ${g.y0 - 7} l7 7 l-7 7 l-7 -7z" fill="${col}" stroke="${sel ? PAPER.sel : PAPER.sheet}" stroke-width="${sel ? 2.5 : 1}"/>`;
    } else {
      const wdt = kind === "bar" ? Math.max(8, (st.width || 3) * 3) : st.width || 3;
      if (sel) s += `<line x1="${g.x0}" y1="${g.y0}" x2="${g.x1}" y2="${g.y1}" stroke="${PAPER.sel}" stroke-width="${wdt + 7}" stroke-linecap="round" stroke-opacity=".6"/>`;
      if (!ghost) s += `<line x1="${g.x0}" y1="${g.y0}" x2="${g.x1}" y2="${g.y1}" stroke="transparent" stroke-width="${Math.max(14, wdt + 8)}"/>`;
      s += `<line x1="${g.x0}" y1="${g.y0}" x2="${g.x1}" y2="${g.y1}" stroke="${col}" stroke-width="${wdt}" stroke-linecap="${kind === "bar" ? "butt" : "round"}" ${kind === "bar" ? 'stroke-opacity=".55"' : ""} ${dashOf(st.dash)}/>`;
      s += marksSvg(st.marks, g.x0, g.y0, g.x1, g.y1, col, st.width || 3, st.mark_spacing || 22);
    }
    o += s + "</g>";
    const lab = { ...(st.label || {}), ...(a.label || {}) };
    if (!ghost && view.show_labels !== false && lab.show !== false) labels.push({ a, g, st, lab, kind, col });
  };
  ghostActs.forEach(a => drawAct(a, true));
  mainActs.forEach(a => drawAct(a, false));
  if (pdefs.size) o += `<defs>${[...pdefs.values()].join("")}</defs>`;
  // logic links from P6 (View → Logic links): predecessor end to successor end, by relationship type
  if (view.show_links) {
    const byCode = new Map(mainActs.map(a => [a.code, a]));
    const end = (a, fin) => { const g = geo(a), k = (S[a.style] || {}).kind || "line"; return AREA.has(k) ? [(g.x0 + g.x1) / 2, fin ? g.y1 : g.y0] : fin ? [g.x1, g.y1] : [g.x0, g.y0]; };
    let lk = "";
    const flt = view.link_filter || "all", elbow = view.link_route === "elbow", crit = x => !!(x.p6?.driving || x.ms?.critical);
    for (const a of mainActs) for (const l of a.links || []) {
      const b = byCode.get(l.code); if (!b) continue;
      if (flt === "driving" && !(crit(a) && crit(b))) continue;
      if (flt === "cross" && a.style === b.style) continue;
      const ty = (l.type || "FS").toUpperCase(), [xa, ya] = end(b, ty[0] === "F"), [xb, yb] = end(a, ty[1] === "F");
      if (Math.hypot(xb - xa, yb - ya) < 3) continue;
      const d = elbow ? `M${xa.toFixed(1)} ${ya.toFixed(1)}H${xb.toFixed(1)}V${yb.toFixed(1)}` : `M${xa.toFixed(1)} ${ya.toFixed(1)}L${xb.toFixed(1)} ${yb.toFixed(1)}`;
      lk += `<path d="${d}" fill="none" stroke="${PAPER.link}" stroke-width="${crit(a) && crit(b) ? 1.5 : 0.9}" stroke-opacity=".75" marker-end="url(#lkarrow)"><title>${esc(b.code)} → ${esc(a.code)} · ${ty}${l.lag_days ? ` lag ${l.lag_days} d` : ""}</title></path>`;
    }
    if (lk) o += `<defs><marker id="lkarrow" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" fill="${PAPER.link}"/></marker></defs><g class="links" pointer-events="none">${lk}</g>`;
  }
  o += overlaysSvg(p, G, mainActs, opts.selection);
  // labels on top
  labels.forEach(({ a, g, st, lab, kind, col }) => {
    const text = labelText(lab.text || "{name}", a, p, st.name);
    if (!text) return;
    const size = lab.size || fs, side = lab.side === "below" ? size + 4 : -6;
    const tcol = lab.colour || col;
    if (AREA.has(kind)) {
      const xa = Math.min(g.x0, g.x1), w = Math.abs(g.x1 - g.x0), ya = Math.min(g.y0, g.y1), hh = Math.abs(g.y1 - g.y0);
      const inside = w > text.length * size * 0.55 + 8 && hh > size + 4;
      if (!inside && hh > text.length * size * 0.55 + 8 && hh > w * 1.5) { // tall and narrow: the label stands upright, inside if it fits
        const tx = w >= size + 4 ? xa + w / 2 + size / 3 : xa + w + size + 2;
        o += `<text transform="translate(${tx.toFixed(1)},${(ya + hh / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" font-size="${size}" font-weight="500" font-family="${FONT}" ${halo} fill="${tcol}" data-act="${a.id}">${esc(text)}</text>`;
        return;
      }
      o += T(inside ? xa + w / 2 : Math.max(xa, Math.max(g.x0, g.x1)) + 6, ya + hh / 2 + size / 3, text,
        `font-size="${size}" font-weight="500" font-family="${FONT}" ${inside ? 'text-anchor="middle"' : ""} ${halo} data-act="${a.id}"`, `fill:${tcol}`);
      return;
    }
    if (kind === "milestone") { o += T(g.x0 + 10, g.y0 + size / 3, text, `font-size="${size}" font-weight="500" font-family="${FONT}" ${halo}`, `fill:${tcol}`); return; }
    const t = lab.position === "start" ? 0.1 : lab.position === "end" ? 0.9 : 0.5;
    const mx = g.x0 + (g.x1 - g.x0) * t, my = g.y0 + (g.y1 - g.y0) * t;
    let ang = 0;
    if (lab.follow_slope !== false) { ang = (Math.atan2(g.y1 - g.y0, g.x1 - g.x0) * 180) / Math.PI; if (ang > 90) ang -= 180; if (ang <= -90) ang += 180; }
    const anchor = lab.position === "start" ? "start" : lab.position === "end" ? "end" : "middle";
    o += `<text transform="translate(${mx.toFixed(1)},${my.toFixed(1)}) rotate(${ang.toFixed(2)})" y="${side}" text-anchor="${anchor}" font-size="${size}" font-weight="500" font-family="${FONT}" ${halo} fill="${tcol}" data-act="${a.id}">${esc(text)}</text>`;
  });
  const PT = opts.playTime;
  if (PT != null) {
    // playback: the future faint, the past at full strength (cut off at the play date), plus the moving parts
    const actsSvg = o.slice(actStart); o = o.slice(0, actStart);
    const d = playDynamic(p, G, PT);
    o += `<defs><clipPath id="playclip"><rect id="play-clip" x="${L}" y="${d.clipY}" width="${R - L}" height="${d.clipH}"/></clipPath></defs>`;
    o += `<g opacity=".13">${actsSvg}</g><g clip-path="url(#playclip)">${actsSvg}</g><g id="play-grid">${d.grid}</g>`;
  }
  o += `</g>`;
  if (PT != null) { o += `<g id="play-top">${playDynamic(p, G, PT).top}</g>`; G.playY = Y(PT); }
  o += `<rect x="${L}" y="${top}" width="${R - L}" height="${GH}" fill="none" stroke="${PAPER.muted}"/>`;
  // selection handles (outside the clip so they stay grabbable)
  if (opts.selection?.kind === "act") {
    const a = p.activities.find(x => x.id === opts.selection.id);
    if (a && a.dataset === main) { const g = geo(a);
      [[g.x0, g.y0, 0], [g.x1, g.y1, 1]].forEach(([x, y, i]) => { o += `<circle data-h="${i}" cx="${x}" cy="${y}" r="6" fill="${PAPER.sheet}" stroke="${PAPER.ink}" stroke-width="2"/>`; }); }
  }
  if (opts.interactive) o += `<g id="ov" pointer-events="none"><line id="xv" y1="${top}" y2="${top + GH}" stroke="${PAPER.muted}" stroke-width=".7" display="none"/><line id="xh" x1="${L}" x2="${R}" stroke="${PAPER.muted}" stroke-width=".7" display="none"/><line id="rb" stroke="${PAPER.ink}" stroke-width="2.5" stroke-dasharray="6 4" display="none"/></g>`;
  return { svg: o, G };
}

// Kinds drawn as an area over their chainage and dates (static, no moving front)
export const AREA = new Set(["block", "cut", "fill", "taper"]);
// Right-angle triangles on a flat base. Cut ◣: the slope falls left to right. Fill ◢: the slope rises left to right.
export function triPath(kind, x, y, w, h) {
  const X0 = x.toFixed(1), X1 = (x + w).toFixed(1), Y0 = y.toFixed(1), Y1 = (y + h).toFixed(1);
  return kind === "cut" ? `M${X0} ${Y0}V${Y1}H${X1}Z` : `M${X1} ${Y0}V${Y1}H${X0}Z`;
}

// The parts of a playback frame that move: cut-off of the done layer, work fronts, date line, date tag and crew markers.
// Called once per frame; the rest of the chart is drawn once when playback starts.
export function playDynamic(p, G, t) {
  const S = styleMap(p), { X, Y, L, R, top, GH } = G, fs = G.compact ? 9 : 11, up = p.time.orientation === "up";
  const yp = Y(t), clipY = up ? yp : top, clipH = Math.max(0, up ? top + GH - yp : yp - top);
  const fronts = activeAt(p, t).map(({ a, frac, paused }) => ({ a, paused, st: S[a.style] || {}, m: a.ch0_m + (a.ch1_m - a.ch0_m) * frac }));
  let grid = "", topSvg = "";
  for (const { a, st, m, paused } of fronts) {
    const col = st.colour || PAPER.ink, x = X(m), kind = st.kind || "line";
    if (AREA.has(kind)) {
      const xa = Math.min(X(a.ch0_m), X(a.ch1_m)), w = Math.max(4, Math.abs(X(a.ch1_m) - X(a.ch0_m)));
      grid += `<rect x="${(xa - 2).toFixed(1)}" y="${(yp - 4).toFixed(1)}" width="${(w + 4).toFixed(1)}" height="8" fill="${col}" stroke="${PAPER.sheet}" stroke-width="1.5"><title>${esc(a.name)} – working</title></rect>`;
    } else if (kind !== "milestone") {
      grid += paused ? `<circle cx="${x.toFixed(1)}" cy="${yp.toFixed(1)}" r="5.5" fill="${PAPER.sheet}" stroke="${col}" stroke-width="2.5"><title>${esc(a.name)} · ${chFmt(p, m)} · stood down</title></circle>`
        : `<circle cx="${x.toFixed(1)}" cy="${yp.toFixed(1)}" r="6.5" fill="${col}" stroke="${PAPER.sheet}" stroke-width="2"><title>${esc(a.name)} · ${chFmt(p, m)}</title></circle>`;
      grid += T(x + 9, yp - 7, a.code || a.name, `font-size="${fs - 1}" font-weight="600" font-family="${FONT}" ${halo}`, `fill:${col}`);
    }
  }
  grid += `<line x1="${L}" x2="${R}" y1="${yp.toFixed(1)}" y2="${yp.toFixed(1)}" stroke="#C00000" stroke-width="2"/>`;
  topSvg += `<rect x="2" y="${(yp - 10).toFixed(1)}" width="${L - 8}" height="20" rx="3" fill="#C00000"/>` +
    T((L - 6) / 2 + 2, yp + 4, niceDate(t), `text-anchor="middle" font-size="${fs}" font-weight="700" font-family="${FONT}"`, "fill:#fff");
  // crew markers ride on the first header row (the track line), like trains on the diagram
  let ty = G.rowsTop; const r1 = G.rowH.findIndex(hh => hh > 0);
  for (let i = 0; i < Math.max(0, r1); i++) ty += G.rowH[i];
  const trackY = r1 >= 0 ? ty + G.rowH[r1] - 6 : G.headTop + G.SH + 8;
  if (!G.noHeader) for (const { a, st, m } of fronts) {
    if ((st.kind || "line") === "milestone") continue;
    const x = X(m);
    topSvg += `<path d="M${(x - 7).toFixed(1)} ${trackY - 14} L${(x + 7).toFixed(1)} ${trackY - 14} L${x.toFixed(1)} ${trackY - 2}Z" fill="${st.colour || PAPER.ink}" stroke="${PAPER.sheet}" stroke-width="1.2"><title>${esc(a.name)} · ${chFmt(p, m)}</title></path>`;
  }
  return { clipY, clipH, grid, top: topSvg, y: yp, count: fronts.length };
}

// ------------------------------------------------------------------ progress (shared by the chart and the corridor view)
// Per project, per activity: start, finish and the stand-down intervals that stop its crew. Built on first use and
// thrown away by resetProgress(p) whenever the project changes, so a playback frame never re-scans the time markers.
const PCACHE = new WeakMap();
export function resetProgress(p) { if (p) PCACHE.delete(p); }
function shutdowns(p) {
  return (p.time_markers || []).filter(m => m.kind === "shutdown" && m.finish).map(m => {
    const a = m.ch0_m ?? -Infinity, b = m.ch1_m ?? Infinity;
    return { s: tms(m.start), f: tms(m.finish), a: Math.min(a, b), b: Math.max(a, b) };
  }).filter(m => m.f > m.s);
}
export function progressInfo(p, a) {
  let c = PCACHE.get(p);
  if (!c) { c = { acts: new WeakMap(), sd: p.view?.pause_on_shutdowns ? shutdowns(p) : [] }; PCACHE.set(p, c); }
  let k = c.acts.get(a);
  if (k) return k;
  const s = tms(a.start), f = tms(a.finish), lo = Math.min(a.ch0_m, a.ch1_m), hi = Math.max(a.ch0_m, a.ch1_m);
  const iv = c.sd.filter(m => m.s < f && m.f > s && m.a <= hi && m.b >= lo).map(m => [Math.max(s, m.s), Math.min(f, m.f)]).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [x, y] of iv) { const l = merged[merged.length - 1]; if (l && x <= l[1]) l[1] = Math.max(l[1], y); else merged.push([x, y]); }
  const lost = merged.reduce((n, [x, y]) => n + (y - x), 0);
  k = { s, f, iv: merged, work: f - s - lost };
  c.acts.set(a, k);
  return k;
}
// 0..1 progress of activity a at time t. If p.view.pause_on_shutdowns is on, time inside shutdown markers that overlap
// the activity's chainage does not count: the crew stops and the remaining work is spread over the activity's
// non-shutdown time, so the finish date is unchanged.
export function progressAt(p, a, t) {
  const { s, f, iv, work } = progressInfo(p, a);
  if (!(f > s)) return t >= s ? 1 : 0;
  if (t <= s) return 0;
  if (t >= f) return 1;
  if (!iv.length || work <= 0) return (t - s) / (f - s);
  let lost = 0;
  for (const [x, y] of iv) { if (t <= x) break; lost += Math.min(t, y) - x; }
  return (t - s - lost) / work;
}
// True when t falls inside a stand-down that stops this activity's crew (only with pause_on_shutdowns on).
export function isStoodDown(p, a, t) {
  const { iv } = progressInfo(p, a);
  for (const [x, y] of iv) { if (t < x) return false; if (t < y) return true; }
  return false;
}

// Activities of the main data set under way at time t, with how far along each is (0..1) and whether the crew is stood down.
export function activeAt(p, t) {
  const out = [];
  for (const a of p.activities) {
    if (a.dataset !== p.view.main_dataset || !onChart(p, a)) continue;
    const { s, f } = progressInfo(p, a);
    if (t >= s && t <= f && f > s) out.push({ a, frac: progressAt(p, a, t), paused: isStoodDown(p, a, t) });
  }
  return out;
}

export function chainageAxis(p, G, y, topSide, inline = false) {
  const c = p.chainage, fs = G.compact ? 9 : 10.5;
  let o = inline ? "" : `<line x1="${G.L}" x2="${G.R}" y1="${y}" y2="${y}" stroke="${PAPER.muted}"/>`;
  const lo = Math.min(c.start_m, c.end_m), hi = Math.max(c.start_m, c.end_m);
  const step = c.minor_m > 0 ? c.minor_m : c.major_m > 0 ? c.major_m : (hi - lo) / 10;
  const n0 = Math.ceil(lo / step - 1e-9), n1 = Math.floor(hi / step + 1e-9);
  const inBreak = m => G.breaks.some(([a, b]) => m > a + 1e-6 && m < b - 1e-6);
  const dir = topSide ? -1 : 1, lab = (x, m) => T(x, topSide ? y - 10 : y + (inline ? 12 : 19), chFmt(p, m).replace(/\.0+$/, ""), `text-anchor="middle" font-size="${inline ? fs - 1 : fs}" font-family="${MONO}" ${inline ? halo : ""}`, `fill:${PAPER.muted}`);
  if (n1 - n0 <= 800) for (let n = n0; n <= n1; n++) {
    const m = n * step; if (inBreak(m)) continue;
    const nearBreak = G.breaks.some(([, , xa, xb]) => Math.abs(G.X(m) - xa) < 26 || Math.abs(G.X(m) - xb) < 26);
    const x = G.X(m), maj = c.major_m > 0 && Math.abs(m / c.major_m - Math.round(m / c.major_m)) < 1e-6;
    if (!inline || maj) o += `<line x1="${x}" x2="${x}" y1="${y}" y2="${y + dir * (maj ? 7 : 3.5)}" stroke="${PAPER.muted}"/>`;
    if (maj && !nearBreak) o += lab(x, m);
  }
  // at a break: the chainage either side, and a double slash on the axis
  for (const [a, b, xa, xb] of G.breaks) {
    if (!inline) o += `<rect x="${Math.min(xa, xb) + 1}" y="${y - 6}" width="${Math.max(0, Math.abs(xb - xa) - 2)}" height="12" fill="${PAPER.sheet}"/>` +
      `<path d="M${Math.min(xa, xb) + 2} ${y + 6}l5 -12M${Math.max(xa, xb) - 7} ${y + 6}l5 -12" stroke="${PAPER.ink}" stroke-width="1.4"/>`;
    o += T(Math.min(xa, xb) - 2, topSide ? y - 10 : y + 19, chFmt(p, c.reverse ? b : a).replace(/\.0+$/, ""), `text-anchor="end" font-size="${fs - 1}" font-family="${MONO}"`, `fill:${PAPER.ink}`);
    o += T(Math.max(xa, xb) + 2, topSide ? y - 10 : y + 19, chFmt(p, c.reverse ? a : b).replace(/\.0+$/, ""), `font-size="${fs - 1}" font-family="${MONO}"`, `fill:${PAPER.ink}`);
  }
  // chainage equations: where the kilometrage jumps
  for (const e of c.equations || []) { if (e.at_m < lo || e.at_m > hi) continue; const x = G.X(e.at_m);
    o += `<line x1="${x}" x2="${x}" y1="${y - 9}" y2="${y + 9}" stroke="#C00000" stroke-width="1.6"/>`; }
  if (!inline) o += T(G.edgeL - 10, topSide ? y - 10 : y + 19, (c.prefix ? c.prefix + " " : "") + chUnitLabel(p), `text-anchor="end" font-size="${fs - 1}" font-family="${MONO}"`, `fill:${PAPER.muted}`);
  return o;
}

// ------------------------------------------------------------------ legend
export function legendItems(p) {
  const view = p.view || {};
  const used = new Set(p.activities.filter(a => a.dataset === view.main_dataset).map(a => a.style));
  const hidden = new Set(view.hidden_styles || []);
  const styles = p.styles.filter(s => used.has(s.code) && s.legend !== false && !hidden.has(s.code));
  const ltypes = [...new Set(p.locations.map(l => l.type))].map(id => p.location_types.find(t => t.id === id)).filter(Boolean);
  const mk = [...new Set(p.time_markers.map(m => (m.kind === "milestone" || !m.finish ? "milestone" : m.kind)))];
  return { styles, ltypes, mk };
}

export function renderLegend(p, { width = 220, size = 11, title = "Legend" } = {}) {
  const { styles, ltypes, mk } = legendItems(p);
  const rh = size + 9;
  let y = size + 6, o = T(0, y, title.toUpperCase(), `font-size="${size}" font-weight="700" letter-spacing="1" font-family="${FONT}"`, `fill:${PAPER.ink}`);
  y += 8;
  const row = (sw, text) => { y += rh; o += sw(y - size / 2 + 1) + T(34, y, text, `font-size="${size}" font-family="${FONT}"`, `fill:${PAPER.ink}`); };
  const ldefs = new Map();
  styles.forEach(s => row(cy => s.kind === "block" ? `<rect x="2" y="${cy - 5}" width="24" height="10" ${areaPaint(s, s.colour, ldefs)} stroke="${s.colour}"/>`
    : s.kind === "cut" || s.kind === "fill" ? `<path d="${triPath(s.kind, 4, cy - 7, 20, 14)}" ${areaPaint(s, s.colour, ldefs)} stroke="${s.colour}" stroke-linejoin="round"/>`
    : s.kind === "taper" ? `<path d="M4 ${cy - 6}H16L26 ${cy + 6}H8Z" ${areaPaint(s, s.colour, ldefs)} stroke="${s.colour}" stroke-linejoin="round"/>`
    : s.kind === "milestone" ? `<path d="M14 ${cy - 6} l6 6 l-6 6 l-6 -6z" fill="${s.colour}"/>`
    : `<line x1="2" x2="26" y1="${cy + 4}" y2="${cy - 4}" stroke="${s.colour}" stroke-width="${Math.min(5, s.width || 3)}" ${dashOf(s.dash)} ${s.kind === "bar" ? 'stroke-opacity=".55"' : ""}/>` + marksSvg(s.marks, 2, cy + 4, 26, cy - 4, s.colour, Math.min(3, s.width || 3), 9), s.name));
  if (mk.length || ltypes.length) y += 6;
  const MKN = { milestone: "Milestone", band: "Access / interface band", shutdown: "Stand-down / shutdown", possession: "Possession", restriction: "Restriction" };
  mk.forEach(k => row(cy => k === "milestone" ? `<line x1="2" x2="26" y1="${cy}" y2="${cy}" stroke="#C00000" stroke-width="1.4" stroke-dasharray="6 3"/>`
    : `<rect x="2" y="${cy - 5}" width="24" height="10" fill="${k === "shutdown" ? "url(#hatchA)" : "#BF8F00"}" fill-opacity="${k === "shutdown" ? 1 : .3}" stroke="${PAPER.hatch}"/>`, MKN[k] || k));
  ltypes.forEach(t => row(cy => `<rect x="10" y="${cy - 5}" width="8" height="10" fill="${t.colour}" fill-opacity=".8"/>`, t.name));
  return { svg: `<defs>${[...ldefs.values()].join("")}<pattern id="hatchA" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${PAPER.hatch}" stroke-width="1.3"/></pattern></defs>` + o, height: y + 8 };
}
