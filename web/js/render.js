// Time-chainage drawing engine. Produces SVG markup for the screen and for the printed page.
// Chainage runs across, time runs down (or up). Everything is placed through one geometry object.
import { DAY, MON, tms, esc, chFmt, isoWeek, labelText, niceDate, niceFinish } from "./util.js";

export const PAPER = { ink: "#18262B", muted: "#5D6B70", rule: "#C9D2D2", faint: "#EEF2F1", band: "#EDF2F1", band2: "#E2EAE8",
  sheet: "#FFFFFF", ghost: "#9AA5A8", hatch: "#9AA7AA", sel: "#E0A400" };
const FONT = "IBM Plex Sans Condensed, Arial Narrow, Arial, sans-serif";
const MONO = "IBM Plex Mono, Consolas, monospace";

export function styleMap(p) { return Object.fromEntries(p.styles.map(s => [s.code, s])); }
function typeMap(p) { return Object.fromEntries(p.location_types.map(t => [t.id, t])); }

// ------------------------------------------------------------------ geometry
export function geometry(p, { width = 1200, ppd = null, height = null, compact = false } = {}) {
  const c = p.chainage, T = p.time;
  const ML = compact ? 58 : 78, MR = compact ? 44 : 60;
  const W = Math.max(compact ? 300 : 700, width), PW = W - ML - MR;
  const span = (c.end_m - c.start_m) || 1;
  const X = m => ML + ((c.reverse ? c.end_m - m : m - c.start_m) / span) * PW;
  const Xi = x => { const f = ((x - ML) / PW) * span; return c.reverse ? c.end_m - f : c.start_m + f; };
  const types = typeMap(p);
  // header rows: sections band, then location rows; a row that shows labels is tall enough for vertical text
  const nrows = Math.max(1, p.location_rows || 4);
  const rowOf = l => Math.min(nrows, Math.max(1, l.row || (types[l.type] || {}).row || nrows));
  const rowH = [];
  for (let r = 1; r <= nrows; r++) {
    const lab = p.locations.filter(l => rowOf(l) === r && l.label && l.ch_m >= c.start_m - 1 && l.ch_m <= c.end_m + 1);
    const any = p.locations.some(l => rowOf(l) === r);
    const longest = lab.reduce((m, l) => Math.max(m, (l.name || "").length + 9), 0);
    rowH.push(!any ? 0 : lab.length ? Math.min(compact ? 90 : 150, 18 + longest * (compact ? 4.6 : 5.6)) : 16);
  }
  const SH = p.sections.length ? 30 : 0;
  const AX = 24;
  const headTop = 6;
  const rowsTop = headTop + SH + 4;
  const top = rowsTop + rowH.reduce((a, b) => a + b, 0) + AX;
  const t0 = tms(T.start), t1 = tms(T.finish) + DAY;
  const nd = Math.max(1, (t1 - t0) / DAY);
  const bottomPad = 36;
  let px = ppd || T.px_per_day || 2;
  if (height) px = Math.max(0.05, (height - top - bottomPad) / nd);
  const GH = nd * px;
  const up = T.orientation === "up";
  const Y = ms => (up ? top + GH - ((ms - t0) / DAY) * px : top + ((ms - t0) / DAY) * px);
  const Yi = y => (up ? t0 + ((top + GH - y) / px) * DAY : t0 + ((y - top) / px) * DAY);
  return { W, H: top + GH + bottomPad, ML, MR, PW, X, Xi, Y, Yi, top, GH, t0, t1, ppd: px, nd, SH, rowsTop, rowH, rowOf, headTop, AX, compact,
    L: Math.min(X(c.start_m), X(c.end_m)), R: Math.max(X(c.start_m), X(c.end_m)) };
}

const T = (x, y, s, attrs = "", style = "") => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${attrs} style="${style}">${esc(s)}</text>`;
const halo = `paint-order="stroke" stroke="${PAPER.sheet}" stroke-width="3" stroke-linejoin="round"`;
const dashOf = d => (d === "dash" ? 'stroke-dasharray="10 6"' : d === "dot" ? 'stroke-dasharray="2 4"' : "");

// ------------------------------------------------------------------ main chart
export function renderChart(p, opts = {}) {
  const G = geometry(p, opts);
  const { W, H, ML, X, Y, top, GH, t0, t1, L, R } = G;
  const c = p.chainage, S = styleMap(p), types = typeMap(p), view = p.view || {};
  const fs = G.compact ? 9 : 11;
  let o = `<defs>
    <clipPath id="gridclip"><rect x="${L}" y="${top}" width="${R - L}" height="${GH}"/></clipPath>
    <pattern id="hatchA" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${PAPER.hatch}" stroke-width="1.3"/></pattern>
  </defs>`;
  o += `<rect width="${W}" height="${H}" fill="${PAPER.sheet}"/>`;

  // ---- header: sections
  p.sections.forEach((s, i) => {
    const a = Math.min(X(s.from_m), X(s.to_m)), b = Math.max(X(s.from_m), X(s.to_m)), w = b - a, cx = (a + b) / 2;
    o += `<rect x="${a}" y="${G.headTop}" width="${w}" height="${G.SH - 2}" fill="${i % 2 ? PAPER.band2 : PAPER.band}" stroke="${PAPER.rule}" stroke-width=".6"/>`;
    const nm = s.name.length * (fs * 0.55) < w - 6 ? s.name : w > 30 ? `S${i + 1}` : "";
    if (nm) o += T(cx, G.headTop + 13, nm, `text-anchor="middle" font-size="${fs}" font-weight="600" font-family="${FONT}"`, `fill:${PAPER.ink}`);
    if (w > 60) o += T(cx, G.headTop + 25, `${chFmt(p, Math.abs(s.to_m - s.from_m) * (c.unit === "km" ? 1 : 1)).replace(/\.?0+$/, "")} ${c.unit}`.replace(/^/, ""),
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
      switch (t.symbol) {
        case "trapezoid": { const aa = b - a < 16 ? (a + b) / 2 - 8 : a, bb = b - a < 16 ? (a + b) / 2 + 8 : b;
          g += `<path d="M${aa} ${base} L${aa + 4} ${base - 7} L${bb - 4} ${base - 7} L${bb} ${base}" fill="none" stroke="${col}" stroke-width="2.4"/>`; break; }
        case "circle": g += `<circle cx="${x}" cy="${base}" r="4.5" fill="${PAPER.sheet}" stroke="${col}" stroke-width="2.2"/>`; break;
        case "tick": g += `<line x1="${x}" x2="${x}" y1="${base - 8}" y2="${base + 4}" stroke="${col}" stroke-width="2"/>`; break;
        case "box": g += `<rect x="${Math.min(a, x - 3)}" y="${base - 6}" width="${Math.max(6, b - a)}" height="10" fill="${PAPER.sheet}" stroke="${col}" stroke-width="1.5"/>`; break;
        case "triangle": g += `<path d="M${x - 5} ${base + 3} L${x} ${base - 7} L${x + 5} ${base + 3}Z" fill="${col}"/>`; break;
        case "bar": g += `<line x1="${x}" x2="${x}" y1="${base - 10}" y2="${base + 5}" stroke="${col}" stroke-width="3.5"/>`; break;
        case "band": g += `<rect x="${a}" y="${base - 5}" width="${Math.max(3, b - a)}" height="8" fill="${col}" fill-opacity=".45" stroke="${col}"/>`; break;
        default: g += `<path d="M${x} ${base - 6} L${x + 5} ${base} L${x} ${base + 6} L${x - 5} ${base}Z" fill="${PAPER.sheet}" stroke="${col}" stroke-width="1.5"/>`;
      }
      if (l.label) g += `<text transform="translate(${(x + 3).toFixed(1)},${(base - 10).toFixed(1)}) rotate(-90)" font-size="${fs - 1}" font-family="${FONT}" fill="${PAPER.ink}" ${sel ? 'text-decoration="underline"' : ""}>${esc(l.name)}<tspan dx="5" fill="${col}" font-family="${MONO}" font-size="${fs - 2}">${chFmt(p, l.ch_m)}</tspan></text>`;
      if (sel) g += `<rect x="${a - 6}" y="${ry + 1}" width="${Math.max(12, b - a + 12)}" height="${rh - 2}" fill="none" stroke="${PAPER.sel}" stroke-width="2"/>`;
      o += g + "</g>";
    });
    ry += rh;
  }

  // ---- chainage axes
  o += chainageAxis(p, G, top - 2, true) + chainageAxis(p, G, top + GH + 2, false);

  // ---- grid background, weekends, weeks, months
  o += `<rect x="${L}" y="${top}" width="${R - L}" height="${GH}" fill="${PAPER.sheet}"/>`;
  if (p.time.shade_weekends && G.ppd >= 4) {
    for (let d = t0; d < t1; d += DAY) { const wd = new Date(d).getUTCDay(); if (wd === 0 || wd === 6) o += `<rect x="${L}" y="${Math.min(Y(d), Y(d + DAY))}" width="${R - L}" height="${G.ppd}" fill="${PAPER.faint}"/>`; }
  }
  if (G.ppd >= 10) for (let d = t0; d <= t1; d += DAY) o += `<line x1="${L}" x2="${R}" y1="${Y(d)}" y2="${Y(d)}" stroke="${PAPER.rule}" stroke-width=".3"/>`;
  const wk0 = (() => { const d = new Date(t0); const back = (d.getUTCDay() - (p.time.week_start ?? 1) + 7) % 7; return t0 - back * DAY; })();
  const wstep = G.ppd * 7 >= 13 ? 1 : G.ppd * 7 >= 6 ? 2 : G.ppd * 7 >= 3 ? 4 : 8;
  let wn = 0;
  for (let d = wk0; d <= t1; d += 7 * DAY, wn++) {
    if (d < t0) continue;
    o += `<line x1="${L}" x2="${R}" y1="${Y(d)}" y2="${Y(d)}" stroke="${PAPER.rule}" stroke-width="${G.ppd * 7 >= 6 ? 0.5 : 0.3}"/>`;
    if (wn % wstep === 0 && d + 7 * DAY <= t1 + DAY) {
      const lab = p.time.week_labels === "iso" ? "W" + isoWeek(d) : p.time.week_labels === "date" ? niceDate(d, false) : "W" + (Math.floor((d - wk0) / (7 * DAY)) + 1);
      o += T(R + 6, (Y(d) + Y(d + 7 * DAY)) / 2 + 3, lab, `font-size="${fs - 2}" font-family="${MONO}"`, `fill:${PAPER.muted}`);
    }
  }
  const sd = new Date(t0); let m = Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), 1), first = true;
  while (m < t1) {
    const dt = new Date(m), next = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1);
    if (m >= t0) o += `<line x1="${L - 8}" x2="${R}" y1="${Y(m)}" y2="${Y(m)}" stroke="${PAPER.muted}" stroke-opacity=".55" stroke-width="1"/>`;
    const a = Math.max(m, t0), b = Math.min(next, t1), span = Math.abs(Y(b) - Y(a)), ym = Math.min(Y(a), Y(b));
    if (span >= 11) {
      o += T(L - 10, ym + 11, MON[dt.getUTCMonth()], `text-anchor="end" font-size="${fs}" font-weight="600" font-family="${FONT}"`, `fill:${PAPER.ink}`);
      if ((dt.getUTCMonth() === 0 || first) && span >= 22) o += T(L - 10, ym + 22, dt.getUTCFullYear(), `text-anchor="end" font-size="${fs - 2}" font-family="${MONO}"`, `fill:${PAPER.muted}`);
    }
    first = false; m = next;
  }

  o += `<g clip-path="url(#gridclip)">`;
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
  // ---- time markers
  if (view.show_time_markers !== false) p.time_markers.forEach(mk => {
    const a = mk.ch0_m != null ? X(mk.ch0_m) : L, b = mk.ch1_m != null ? X(mk.ch1_m) : R, xa = Math.min(a, b), xb = Math.max(a, b);
    const ys = Y(tms(mk.start)), col = mk.colour || PAPER.muted, sel = opts.selection?.kind === "mk" && opts.selection.id === mk.id;
    let g = `<g data-mk="${mk.id}" class="mk"><title>${esc(mk.label)} · ${niceDate(tms(mk.start))}${mk.finish ? " – " + niceFinish(tms(mk.finish)) : ""}</title>`;
    if (mk.kind === "milestone" || !mk.finish) {
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
  const visible = a => a.dataset === main || (cmp && a.dataset === cmp);
  const acts = p.activities.filter(visible);
  const ghostActs = acts.filter(a => a.dataset !== main), mainActs = acts.filter(a => a.dataset === main);
  const kindOrder = { block: 0, bar: 1, line: 2, milestone: 3 };
  mainActs.sort((a, b) => (kindOrder[S[a.style]?.kind] ?? 2) - (kindOrder[S[b.style]?.kind] ?? 2));
  const geo = a => ({ x0: X(a.ch0_m), x1: X(a.ch1_m), y0: Y(tms(a.start)), y1: Y(tms(a.finish)) });
  // footprints underneath everything
  if (view.show_footprints !== false) mainActs.forEach(a => {
    const st = S[a.style] || {}; const fp = { ...(st.footprint || {}), ...(a.footprint || {}) };
    if (!fp.enabled || ((fp.length_m || 0) <= 0 && (fp.lag_days || 0) <= 0)) return;
    const dir = Math.sign(a.ch1_m - a.ch0_m) || 1, len = fp.length_m || 0, lag = (fp.lag_days || 0) * DAY;
    const s = tms(a.start), f = tms(a.finish);
    const pts = [[a.ch0_m, s], [a.ch1_m, f], [a.ch1_m - dir * len, f + lag], [a.ch0_m - dir * len, s + lag]];
    o += `<polygon data-act="${a.id}" class="act fp" points="${pts.map(([cm, t]) => `${X(cm).toFixed(1)},${Y(t).toFixed(1)}`).join(" ")}" fill="${st.colour || PAPER.muted}" fill-opacity="${fp.opacity ?? 0.18}" stroke="${st.colour || PAPER.muted}" stroke-opacity=".5" stroke-width=".8"/>`;
  });
  const labels = [];
  const drawAct = (a, ghost) => {
    const st = S[a.style] || { kind: "line", colour: PAPER.muted, width: 2, label: { show: true, text: "{name}" } };
    const col = ghost ? PAPER.ghost : st.colour, g = geo(a), sel = !ghost && opts.selection?.kind === "act" && opts.selection.id === a.id;
    const kind = st.kind || "line";
    let s = `<g ${ghost ? "" : `data-act="${a.id}" class="act"`} ${ghost ? 'opacity=".55"' : ""}><title>${esc(a.code)} ${esc(a.name)} · ${chFmt(p, a.ch0_m)}–${chFmt(p, a.ch1_m)} · ${niceDate(tms(a.start))} – ${niceFinish(tms(a.finish))}</title>`;
    if (kind === "block") {
      const xa = Math.min(g.x0, g.x1), w = Math.max(4, Math.abs(g.x1 - g.x0)), ya = Math.min(g.y0, g.y1), hh = Math.max(2, Math.abs(g.y1 - g.y0));
      const xx = Math.abs(g.x1 - g.x0) < 4 ? (g.x0 + g.x1) / 2 - 2 : xa;
      if (sel) s += `<rect x="${xx - 4}" y="${ya - 4}" width="${w + 8}" height="${hh + 8}" fill="none" stroke="${PAPER.sel}" stroke-width="2.5"/>`;
      s += `<rect x="${xx}" y="${ya}" width="${w}" height="${hh}" fill="${col}" fill-opacity="${st.fill_opacity ?? 0.35}" stroke="${col}" stroke-width="${st.width || 1.2}" ${dashOf(st.dash)}/>`;
    } else if (kind === "milestone") {
      if (Math.abs(g.x1 - g.x0) > 2) s += `<line x1="${g.x0}" x2="${g.x1}" y1="${g.y0}" y2="${g.y0}" stroke="${col}" stroke-width="${st.width || 2}" ${dashOf(st.dash)}/>`;
      s += `<path d="M${g.x0} ${g.y0 - 7} l7 7 l-7 7 l-7 -7z" fill="${col}" stroke="${sel ? PAPER.sel : PAPER.sheet}" stroke-width="${sel ? 2.5 : 1}"/>`;
    } else {
      const wdt = kind === "bar" ? Math.max(8, (st.width || 3) * 3) : st.width || 3;
      if (sel) s += `<line x1="${g.x0}" y1="${g.y0}" x2="${g.x1}" y2="${g.y1}" stroke="${PAPER.sel}" stroke-width="${wdt + 7}" stroke-linecap="round" stroke-opacity=".6"/>`;
      if (!ghost) s += `<line x1="${g.x0}" y1="${g.y0}" x2="${g.x1}" y2="${g.y1}" stroke="transparent" stroke-width="${Math.max(14, wdt + 8)}"/>`;
      s += `<line x1="${g.x0}" y1="${g.y0}" x2="${g.x1}" y2="${g.y1}" stroke="${col}" stroke-width="${wdt}" stroke-linecap="${kind === "bar" ? "butt" : "round"}" ${kind === "bar" ? 'stroke-opacity=".55"' : ""} ${dashOf(st.dash)}/>`;
    }
    o += s + "</g>";
    const lab = { ...(st.label || {}), ...(a.label || {}) };
    if (!ghost && view.show_labels !== false && lab.show !== false) labels.push({ a, g, st, lab, kind, col });
  };
  ghostActs.forEach(a => drawAct(a, true));
  mainActs.forEach(a => drawAct(a, false));
  // labels on top
  labels.forEach(({ a, g, st, lab, kind, col }) => {
    const text = labelText(lab.text || "{name}", a, p, st.name);
    if (!text) return;
    const size = lab.size || fs, side = lab.side === "below" ? size + 4 : -6;
    const tcol = lab.colour || col;
    if (kind === "block") {
      const xa = Math.min(g.x0, g.x1), w = Math.abs(g.x1 - g.x0), ya = Math.min(g.y0, g.y1), hh = Math.abs(g.y1 - g.y0);
      const inside = w > text.length * size * 0.55 + 8 && hh > size + 4;
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
  o += `</g>`;
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

function chainageAxis(p, G, y, topSide) {
  const c = p.chainage, fs = G.compact ? 9 : 10.5;
  let o = `<line x1="${G.L}" x2="${G.R}" y1="${y}" y2="${y}" stroke="${PAPER.muted}"/>`;
  const step = c.minor_m > 0 ? c.minor_m : c.major_m > 0 ? c.major_m : (c.end_m - c.start_m) / 10;
  const n0 = Math.ceil(c.start_m / step - 1e-9), n1 = Math.floor(c.end_m / step + 1e-9);
  if (n1 - n0 > 800) return o;
  const dir = topSide ? -1 : 1;
  for (let n = n0; n <= n1; n++) {
    const m = n * step, x = G.X(m), maj = c.major_m > 0 && Math.abs(m / c.major_m - Math.round(m / c.major_m)) < 1e-6;
    o += `<line x1="${x}" x2="${x}" y1="${y}" y2="${y + dir * (maj ? 7 : 3.5)}" stroke="${PAPER.muted}"/>`;
    if (maj) o += T(x, topSide ? y - 10 : y + 19, chFmt(p, m).replace(/\.0+$/, ""), `text-anchor="middle" font-size="${fs}" font-family="${MONO}"`, `fill:${PAPER.muted}`);
  }
  o += T(G.L - 10, topSide ? y - 10 : y + 19, (c.prefix ? c.prefix + " " : "") + c.unit, `text-anchor="end" font-size="${fs - 1}" font-family="${MONO}"`, `fill:${PAPER.muted}`);
  return o;
}

// ------------------------------------------------------------------ legend
export function legendItems(p) {
  const view = p.view || {};
  const used = new Set(p.activities.filter(a => a.dataset === view.main_dataset).map(a => a.style));
  const styles = p.styles.filter(s => used.has(s.code) && s.legend !== false);
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
  styles.forEach(s => row(cy => s.kind === "block" ? `<rect x="2" y="${cy - 5}" width="24" height="10" fill="${s.colour}" fill-opacity="${s.fill_opacity ?? .35}" stroke="${s.colour}"/>`
    : s.kind === "milestone" ? `<path d="M14 ${cy - 6} l6 6 l-6 6 l-6 -6z" fill="${s.colour}"/>`
    : `<line x1="2" x2="26" y1="${cy + 4}" y2="${cy - 4}" stroke="${s.colour}" stroke-width="${Math.min(5, s.width || 3)}" ${dashOf(s.dash)} ${s.kind === "bar" ? 'stroke-opacity=".55"' : ""}/>`, s.name));
  if (mk.length || ltypes.length) y += 6;
  const MKN = { milestone: "Milestone", band: "Access / interface band", shutdown: "Stand-down / shutdown", possession: "Possession", restriction: "Restriction" };
  mk.forEach(k => row(cy => k === "milestone" ? `<line x1="2" x2="26" y1="${cy}" y2="${cy}" stroke="#C00000" stroke-width="1.4" stroke-dasharray="6 3"/>`
    : `<rect x="2" y="${cy - 5}" width="24" height="10" fill="${k === "shutdown" ? "url(#hatchA)" : "#BF8F00"}" fill-opacity="${k === "shutdown" ? 1 : .3}" stroke="${PAPER.hatch}"/>`, MKN[k] || k));
  ltypes.forEach(t => row(cy => `<rect x="10" y="${cy - 5}" width="8" height="10" fill="${t.colour}" fill-opacity=".8"/>`, t.name));
  return { svg: `<defs><pattern id="hatchA" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${PAPER.hatch}" stroke-width="1.3"/></pattern></defs>` + o, height: y + 8 };
}
