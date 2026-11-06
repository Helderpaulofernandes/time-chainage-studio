// Corridor view: crews as "ants" crawling along lanes by chainage, the track line filling in by stage.
// Same horizontal scale as the chart (geometry()), so a crew sits directly above its work front on the chart.
// renderCorridor() draws everything once; corridorDynamic() redraws only what moves, for playback frames.
import { geometry, styleMap, PAPER, chainageAxis, locSymbol, progressAt, progressInfo, isStoodDown, AREA, triPath } from "./render.js";
import { DAY, DOW, esc, chFmt, lenFmt, niceDate, tms } from "./util.js";
import { corridorDefaults } from "./core/model.js";
import { onChart } from "./extras.js";

const FONT = "IBM Plex Sans Condensed, Arial Narrow, Arial, sans-serif";
const MONO = "IBM Plex Mono, Consolas, monospace";
const NOT_STARTED = "#C9D2D2";
export const STAGE_COLOURS = ["#9FB4BE", "#3F8F86", "#3C9A2E"];
const SD_COL = "#B13A3A";
const MK_NAME = { shutdown: "Stand-down", possession: "Possession", band: "Band", restriction: "Restriction" };

export const corridorCfg = p => ({ ...corridorDefaults(), ...((p.view || {}).corridor || {}) });

// Lanes in drawing order: one per used style (style order), or the project's own grouping. Styles the grouping does
// not mention get a lane of their own at the end, so a newly imported style never disappears.
export function corridorLanes(p, { withHidden = false } = {}) {
  const cfg = corridorCfg(p), S = styleMap(p), main = p.view.main_dataset;
  const usedSet = new Set(p.activities.filter(a => a.dataset === main).map(a => a.style));
  const used = [...p.styles.map(s => s.code).filter(c => usedSet.has(c)), ...[...usedSet].filter(c => !S[c])];
  const nameOf = c => (S[c] && S[c].name) || c || "Other";
  const lanes = [], seen = new Set();
  if (Array.isArray(cfg.lanes)) for (const l of cfg.lanes) {
    const st = (l.styles || []).filter(c => usedSet.has(c) && !seen.has(c));
    st.forEach(c => seen.add(c));
    if (st.length) lanes.push({ label: l.label || nameOf(st[0]), styles: st, hidden: !!l.hidden });
  }
  used.filter(c => !seen.has(c)).forEach(c => lanes.push({ label: nameOf(c), styles: [c], hidden: false }));
  lanes.forEach(l => (l.colour = (S[l.styles[0]] || {}).colour || PAPER.muted));
  return withHidden ? lanes : lanes.filter(l => !l.hidden);
}

const T = (x, y, s, attrs = "", style = "") => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${attrs} style="${style}">${esc(s)}</text>`;
const f1 = v => v.toFixed(1);
const diamond = (x, y, r, fill, stroke, sw = 1.4, extra = "") =>
  `<path d="M${f1(x)} ${f1(y - r)} L${f1(x + r)} ${f1(y)} L${f1(x)} ${f1(y + r)} L${f1(x - r)} ${f1(y)}Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${extra}/>`;

// Layout and prepared activities. width/compact must match the chart's so the chainage scale lines up.
export function corridorGeometry(p, { width = 1200, compact = false, laneHeight = null } = {}) {
  const G = geometry(p, { width, compact }), cfg = corridorCfg(p), S = styleMap(p);
  const lanes = corridorLanes(p);
  const lh = Math.max(10, laneHeight || cfg.lane_height || 30);
  const headH = 28, axisY = headH + 24, secTop = axisY + 6, secH = p.sections.length ? 16 : 0;
  const labY = secTop + secH + 13, trackY = labY + 13, lanesTop = trackY + 14;
  const laneOf = {}; lanes.forEach((l, i) => l.styles.forEach(c => (laneOf[c] = i)));
  const items = [];
  for (const a of p.activities) {
    if (a.dataset !== p.view.main_dataset) continue;
    const li = laneOf[a.style]; if (li == null || !onChart(p, a)) continue;
    const st = S[a.style] || {}, x0 = G.X(a.ch0_m), x1 = G.X(a.ch1_m), kind = st.kind || "line";
    items.push({ a, li, x0, x1, kind, col: st.colour || PAPER.muted, point: Math.abs(x1 - x0) < 1, tag: a.code || st.name || a.style || "" });
  }
  const pat = {}; // one hatch pattern per block colour
  [...new Set(items.filter(i => AREA.has(i.kind)).map(i => i.col))].forEach((col, n) => (pat[col] = `cor-h${n}`));
  const H = lanesTop + lanes.length * lh + 8;
  return { G, W: G.W, H, L: G.L, R: G.R, X: G.X, lanes, lh, headH, axisY, secTop, secH, labY, trackY, lanesTop, items, pat, cfg,
    laneY: i => lanesTop + i * lh + lh / 2, compact };
}

// Full corridor SVG (inner markup) plus its size. opts: width, compact, playTime, laneHeight, hideDate, phase (0..1 pulse).
export function renderCorridor(p, opts = {}) {
  const C = corridorGeometry(p, opts);
  const { W, H, L, R, X, lanes, lh, trackY, lanesTop } = C, c = p.chainage, fs = C.compact ? 9 : 10;
  const types = Object.fromEntries(p.location_types.map(t => [t.id, t]));
  let o = `<defs><clipPath id="cor-clip"><rect x="${L}" y="0" width="${R - L}" height="${H}"/></clipPath>
    <pattern id="cor-sd" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="${SD_COL}" stroke-width="1.2" stroke-opacity=".35"/></pattern>`;
  Object.entries(C.pat).forEach(([col, id]) => {
    o += `<pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${col}" fill-opacity=".16"/><line x1="0" y1="0" x2="0" y2="7" stroke="${col}" stroke-width="1.6" stroke-opacity=".75"/></pattern>`;
  });
  o += `</defs><rect width="${W}" height="${H}" fill="${PAPER.sheet}"/>`;
  o += `<g id="cor-head"></g>`;
  // chainage axis, same ticks and labels as the chart
  o += chainageAxis(p, C.G, C.axisY, true);
  // sections band
  p.sections.forEach((s, i) => {
    const a = Math.min(X(s.from_m), X(s.to_m)), b = Math.max(X(s.from_m), X(s.to_m)), w = b - a;
    o += `<rect x="${f1(a)}" y="${C.secTop}" width="${f1(w)}" height="${C.secH - 2}" fill="${i % 2 ? PAPER.band2 : PAPER.band}" stroke="${PAPER.rule}" stroke-width=".6"/>`;
    const nm = s.name.length * (fs * 0.55) < w - 6 ? s.name : w > 26 ? `S${i + 1}` : "";
    if (nm) o += T((a + b) / 2, C.secTop + 10.5, nm, `text-anchor="middle" font-size="${fs - 1}" font-weight="600" font-family="${FONT}"`, `fill:${PAPER.ink}`);
  });
  // gutter captions
  o += T(6, trackY + 3.5, "TRACK", `font-size="${fs - 1.5}" font-weight="600" letter-spacing=".6" font-family="${MONO}"`, `fill:${PAPER.muted}`);
  if (C.secH) o += T(6, C.secTop + 10.5, "SECTION", `font-size="${fs - 1.5}" font-weight="600" letter-spacing=".6" font-family="${MONO}"`, `fill:${PAPER.muted}`);
  // track line: not started, then the stages paint over it (dynamic)
  o += `<line x1="${L}" x2="${R}" y1="${trackY}" y2="${trackY}" stroke="${NOT_STARTED}" stroke-width="7"/>`;
  o += `<g id="cor-track" clip-path="url(#cor-clip)"></g>`;
  // locations: symbols on the track line; the main ones (those with grid lines on the chart) are named
  const placed = [];
  const locs = p.locations.filter(l => l.ch_m >= c.start_m - 1 && l.ch_m <= c.end_m + 1).sort((a, b) => a.ch_m - b.ch_m);
  for (const l of locs) {
    const t = types[l.type] || { colour: PAPER.muted, symbol: "diamond" };
    const x = X(l.ch_m), x2 = l.to_m != null ? X(l.to_m) : x, col = l.colour || t.colour, a = Math.min(x, x2), b = Math.max(x, x2);
    o += `<g><title>${esc(l.name)} · ${chFmt(p, l.ch_m)}</title>${locSymbol(t.symbol, x, a, b, trackY, col)}</g>`;
  }
  for (const l of locs) {
    const t = types[l.type] || {}; if (!(l.grid ?? t.grid) || !l.name) continue;
    const x = X(l.ch_m), w = l.name.length * fs * 0.52 + 6;
    if (placed.some(q => Math.abs(q - x) < w)) continue;
    placed.push(x);
    o += T(x, C.labY, l.name, `text-anchor="middle" font-size="${fs}" font-weight="600" font-family="${FONT}"`, `fill:${PAPER.ink}`);
  }
  // lanes: background, centre rail, section lines, label column
  lanes.forEach((ln, i) => {
    const y0 = lanesTop + i * lh, yc = y0 + lh / 2;
    if (i % 2) o += `<rect x="0" y="${y0}" width="${W}" height="${lh}" fill="${PAPER.faint}" fill-opacity=".55"/>`;
    o += `<line x1="0" x2="${W}" y1="${y0}" y2="${y0}" stroke="${PAPER.rule}" stroke-width=".6"/>`;
    o += `<line x1="${L}" x2="${R}" y1="${yc}" y2="${yc}" stroke="${PAPER.rule}" stroke-width=".8" stroke-dasharray="2 3"/>`;
    const maxCh = Math.max(4, Math.floor((L - 14) / (fs * 0.53)));
    const name = ln.label.length > maxCh ? ln.label.slice(0, maxCh - 1) + "…" : ln.label;
    o += `<rect x="3" y="${y0 + 3}" width="3" height="${lh - 6}" fill="${ln.colour}"/>`;
    o += `<text x="10" y="${f1(lh >= 22 ? yc - 1.5 : yc + 3.5)}" font-size="${fs + 0.5}" font-weight="600" font-family="${FONT}" fill="${PAPER.ink}"><title>${esc(ln.label)}</title>${esc(name)}</text>`;
  });
  o += `<line x1="0" x2="${W}" y1="${lanesTop + lanes.length * lh}" y2="${lanesTop + lanes.length * lh}" stroke="${PAPER.rule}" stroke-width=".6"/>`;
  p.sections.forEach(s => [s.from_m, s.to_m].forEach(v => { o += `<line x1="${f1(X(v))}" x2="${f1(X(v))}" y1="${lanesTop}" y2="${lanesTop + lanes.length * lh}" stroke="${PAPER.muted}" stroke-opacity=".3"/>`; }));
  o += `<line x1="${L}" x2="${L}" y1="${lanesTop}" y2="${lanesTop + lanes.length * lh}" stroke="${PAPER.muted}" stroke-opacity=".5"/>`;
  o += `<g id="cor-dyn"></g>`;
  if (!lanes.length) o += T((L + R) / 2, lanesTop + 18, "No activities in this option yet.", `text-anchor="middle" font-size="${fs + 1}" font-family="${FONT}"`, `fill:${PAPER.muted}`);
  if (opts.playTime != null) {
    const d = corridorDynamic(p, C, opts.playTime, opts);
    o = o.replace(`<g id="cor-head"></g>`, `<g id="cor-head">${d.head}</g>`).replace(`<g id="cor-track" clip-path="url(#cor-clip)"></g>`, `<g id="cor-track" clip-path="url(#cor-clip)">${d.track}</g>`)
      .replace(`<g id="cor-dyn"></g>`, `<g id="cor-dyn">${d.acts}</g>`);
  }
  return { svg: o, width: W, height: H, C };
}

// Union of [a, b] intervals: merged list and total length.
function union(ivs) {
  const s = ivs.map(v => [...v]).sort((x, y) => x[0] - y[0]), out = [];
  for (const v of s) { const l = out[out.length - 1]; if (l && v[0] <= l[1]) l[1] = Math.max(l[1], v[1]); else out.push(v); }
  return { list: out, len: out.reduce((n, [a, b]) => n + (b - a), 0) };
}

// Ranged time markers in force at t (stand-downs, possessions, bands, restrictions), for the header readout.
function markersAt(p, t) {
  return (p.time_markers || []).filter(m => m.finish && m.kind !== "milestone" && tms(m.start) <= t && t < tms(m.finish));
}

// The moving parts at time t: header readout, track stage paint, and every lane's marks.
export function corridorDynamic(p, C, t, opts = {}) {
  const { X, L, R, lanes, lh, trackY, cfg } = C, fs = C.compact ? 9 : 10, look = (cfg.lookahead_days ?? 21) * DAY;
  const phase = opts.phase ?? ((typeof performance !== "undefined" ? performance.now() : 0) / 1000) % 1;
  const showTags = cfg.show_tags !== false;
  let acts = "", heads = "", tagList = [];
  const lane = lanes.map(() => ({ active: 0, paused: 0 }));
  // stand-down bands over the lanes, limited to their chainage
  const mks = markersAt(p, t);
  const lanesBot = C.lanesTop + lanes.length * lh;
  for (const m of mks) if (m.kind === "shutdown" || m.kind === "possession") {
    const a = m.ch0_m != null ? X(m.ch0_m) : L, b = m.ch1_m != null ? X(m.ch1_m) : R;
    acts += `<rect x="${f1(Math.max(L, Math.min(a, b)))}" y="${C.lanesTop}" width="${f1(Math.min(R, Math.max(a, b)) - Math.max(L, Math.min(a, b)))}" height="${lanesBot - C.lanesTop}" fill="url(#cor-sd)"/>`;
  }
  acts += `<g clip-path="url(#cor-clip)">`;
  for (const it of C.items) {
    const { a, li, x0, x1, kind, col } = it, yc = C.laneY(li);
    const { s, f } = progressInfo(p, a);
    if (kind === "milestone") {
      const until = Math.max(s + DAY, f);
      if (t >= s && t < until) {
        acts += `<circle cx="${f1(x0)}" cy="${f1(yc)}" r="${f1(6 + phase * 10)}" fill="none" stroke="${col}" stroke-width="2" stroke-opacity="${(0.7 * (1 - phase)).toFixed(2)}"/>`;
        acts += diamond(x0, yc, 7, col, PAPER.sheet, 1.2);
        tagList.push({ li, x: x0, text: it.tag, col });
      }
      continue;
    }
    const future = t < s, done = t >= f, active = !future && !done;
    if (future && s - t > look) continue;
    const paused = active && isStoodDown(p, a, t);
    if (active) paused ? lane[li].paused++ : lane[li].active++;
    if (AREA.has(kind)) {
      const xa = Math.min(x0, x1), w = Math.max(3, Math.abs(x1 - x0)), y = yc - lh * 0.3, hh = lh * 0.6;
      const shp = kind === "block" || kind === "taper" ? `<rect x="${f1(xa)}" y="${f1(y)}" width="${f1(w)}" height="${f1(hh)}"` : `<path d="${triPath(kind, xa, y, Math.max(6, w), hh)}" stroke-linejoin="round"`;
      if (future) acts += `${shp} fill="none" stroke="${col}" stroke-opacity="${(0.25 + 0.45 * (1 - (s - t) / look)).toFixed(2)}" stroke-dasharray="3 3"/>`;
      else if (done) acts += `${shp} fill="${col}" fill-opacity=".12"/>`;
      else { acts += `${shp} fill="url(#${C.pat[col]})" stroke="${col}" stroke-width="1"/>`; tagList.push({ li, x: xa + w / 2, text: it.tag, col }); }
      continue;
    }
    if (it.point) {
      if (future) acts += diamond(x0, yc, 3.8, PAPER.sheet, col, 1.3, `stroke-opacity="${(0.4 + 0.5 * (1 - (s - t) / look)).toFixed(2)}"`);
      else if (done) acts += diamond(x0, yc, 3.8, col, col, 1, 'fill-opacity=".5" stroke-opacity=".5"');
      else {
        if (!paused) acts += `<circle cx="${f1(x0)}" cy="${f1(yc)}" r="${f1(5 + phase * 11)}" fill="none" stroke="${col}" stroke-width="2" stroke-opacity="${(0.7 * (1 - phase)).toFixed(2)}"/>`;
        heads += diamond(x0, yc, 5.5, paused ? PAPER.sheet : col, paused ? col : PAPER.sheet, paused ? 1.8 : 1.2);
        tagList.push({ li, x: x0, text: it.tag, col });
      }
      continue;
    }
    // line / bar: a crew moving from ch0 to ch1 (right to left when ch0 > ch1)
    if (future) { acts += `<line x1="${f1(x0)}" x2="${f1(x1)}" y1="${f1(yc)}" y2="${f1(yc)}" stroke="${col}" stroke-width="2" stroke-dasharray="5 4" stroke-opacity="${(0.18 + 0.4 * (1 - (s - t) / look)).toFixed(2)}"/>`; continue; }
    if (done) { acts += `<line x1="${f1(x0)}" x2="${f1(x1)}" y1="${f1(yc)}" y2="${f1(yc)}" stroke="${col}" stroke-width="2.5" stroke-opacity=".45"/>`; continue; }
    const xp = X(a.ch0_m + (a.ch1_m - a.ch0_m) * progressAt(p, a, t));
    acts += `<line x1="${f1(xp)}" x2="${f1(x1)}" y1="${f1(yc)}" y2="${f1(yc)}" stroke="${col}" stroke-width="1.5" stroke-dasharray="3 4" stroke-opacity=".35"/>`;
    acts += `<line x1="${f1(x0)}" x2="${f1(xp)}" y1="${f1(yc)}" y2="${f1(yc)}" stroke="${col}" stroke-width="4" stroke-linecap="round"/>`;
    const tip = `<title>${esc(a.code)} ${esc(a.name)} · ${chFmt(p, a.ch0_m + (a.ch1_m - a.ch0_m) * progressAt(p, a, t))}${paused ? " · stood down" : ""}</title>`;
    heads += paused
      ? `<circle cx="${f1(xp)}" cy="${f1(yc)}" r="5" fill="${PAPER.sheet}" stroke="${col}" stroke-width="2">${tip}</circle>`
      : `<circle cx="${f1(xp)}" cy="${f1(yc)}" r="9.5" fill="${col}" fill-opacity=".2"/><circle cx="${f1(xp)}" cy="${f1(yc)}" r="5" fill="${col}">${tip}</circle><circle cx="${f1(xp)}" cy="${f1(yc)}" r="1.9" fill="${PAPER.sheet}"/>`;
    tagList.push({ li, x: xp, text: it.tag, col });
  }
  acts += heads;
  // crew tags above the heads, skipping any that would overlap the previous one in the lane
  if (showTags && lh >= 18) {
    const last = {};
    tagList.sort((a, b) => a.li - b.li || a.x - b.x);
    for (const g of tagList) {
      if (!g.text) continue;
      const w = g.text.length * (fs - 0.5) * 0.56 + 6, x = Math.min(Math.max(g.x - w / 2, L + 2), R - w - 1);
      if (last[g.li] != null && x < last[g.li] + 3) continue;
      last[g.li] = x + w;
      const y0 = C.laneY(g.li) - lh / 2 + 1;
      acts += `<rect x="${f1(x)}" y="${f1(y0)}" width="${f1(w)}" height="11" rx="2" fill="${PAPER.sheet}" fill-opacity=".88"/>` +
        T(x + 3, y0 + 8.8, g.text, `font-size="${fs - 0.5}" font-weight="600" font-family="${FONT}"`, `fill:${g.col}`);
    }
  }
  acts += `</g>`;
  // lane status lines in the label column
  if (lh >= 22) lanes.forEach((ln, i) => {
    const { active, paused } = lane[i];
    const txt = active ? `${active} active${paused ? ` · ${paused} stood down` : ""}` : paused ? "stood down" : "—";
    acts += T(10, C.laneY(i) + 9.5, txt, `font-size="${fs - 2}" font-family="${MONO}"`, `fill:${paused && !active ? SD_COL : PAPER.muted}`);
  });
  // track state: union of completed chainage per stage, painted in stage order
  let track = "", counters = [];
  (cfg.stages || []).slice(0, 3).forEach((sg, k) => {
    if (!sg || !sg.style) return;
    const col = sg.colour || STAGE_COLOURS[k];
    const ivs = [];
    for (const it of C.items) {
      if (it.a.style !== sg.style) continue;
      const pr = progressAt(p, it.a, t); if (pr <= 0) continue;
      const a0 = it.a.ch0_m, a1 = it.a.ch1_m;
      if (it.kind === "line" || it.kind === "bar") { const cur = a0 + (a1 - a0) * pr; ivs.push([Math.min(a0, cur), Math.max(a0, cur)]); }
      else if (pr >= 1) ivs.push([Math.min(a0, a1), Math.max(a0, a1)]);
    }
    const u = union(ivs);
    for (const [a, b] of u.list) { const xa = Math.min(X(a), X(b)), xb = Math.max(X(a), X(b)); track += `<rect x="${f1(xa)}" y="${trackY - 3.5}" width="${f1(Math.max(1, xb - xa))}" height="7" fill="${col}"/>`; }
    counters.push({ col, label: sg.label || sg.style, len: u.len });
  });
  // header: date, number under way, markers in force; stage counters on the right
  const n = lane.reduce((m, l) => m + l.active + l.paused, 0), d = new Date(t);
  const mkTxt = mks.slice(0, 2).map(m => `${m.kind === "shutdown" && !/stand|shut/i.test(m.label || "") ? "Stand-down · " : ""}${m.label || MK_NAME[m.kind] || m.kind} · ${niceDate(tms(m.start), false)}–${niceDate(tms(m.finish) - 60000, false)}`)
    .concat(mks.length > 2 ? [`+${mks.length - 2} more`] : []);
  let head = `<text x="6" y="19" font-family="${FONT}" font-size="${fs + 1}">`;
  let first = true;
  const sep = () => { const r = first ? "" : ' dx="14"'; first = false; return r; };
  if (!opts.hideDate) head += `<tspan${sep()} font-size="${fs + 4}" font-weight="700" fill="${PAPER.ink}">${esc(DOW[d.getUTCDay()] + " " + niceDate(t))}</tspan><tspan${sep()} fill="${PAPER.muted}">${n ? `${n} under way` : "nothing under way"}</tspan>`;
  mkTxt.forEach(s => { head += `<tspan${sep()} fill="${SD_COL}" font-weight="600">${esc(s)}</tspan>`; });
  head += `</text>`;
  if (counters.length) {
    head += `<text x="${R}" y="19" text-anchor="end" font-family="${FONT}" font-size="${fs + 1}" fill="${PAPER.ink}"><tspan fill="${NOT_STARTED}" font-size="${fs + 4}">■</tspan><tspan dx="3" fill="${PAPER.muted}">Not started</tspan>`;
    counters.forEach(cn => { head += `<tspan dx="14" fill="${cn.col}" font-size="${fs + 4}">■</tspan><tspan dx="3">${esc(cn.label)}</tspan><tspan dx="4" font-family="${MONO}" font-weight="600">${esc(lenFmt(p, cn.len))}</tspan>`; });
    head += `</text>`;
  }
  return { head, track, acts };
}
