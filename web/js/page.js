// Page layout: paper, margins and placed blocks (title, title block, chart, legend, text). Used for print and export.
import { renderChart, renderLegend, geometry, PAPER, FONT as CHART_FONT } from "./render.js";
import { rowsOf } from "./extras.js";
import { esc, h, $, $$, download, niceDate, tms, clamp, uid, chToM, mToCh, lenFmt, DAY, MON } from "./util.js";
import { readImage } from "./dialogs.js";
import { logoSvg, logoWidth } from "./brand.js";

export const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], Letter: [279, 216], Ledger: [432, 279], "ANSI D": [864, 559] };
const UNITS_PER_MM = 3.5; // drawing units per millimetre inside placed blocks (sets text size on paper)
const FONT = CHART_FONT;

export function paperSize(pg) {
  const [a, b] = PAPERS[pg.paper] || PAPERS.A3;
  return pg.orientation === "portrait" ? [Math.min(a, b), Math.max(a, b)] : [Math.max(a, b), Math.min(a, b)];
}

function fillText(t, p) {
  const m = p.meta || {};
  return String(t || "").replace(/\{(\w+)\}/g, (x, k) => ({ title: m.title || p.name, subtitle: m.subtitle, client: m.client, contract: m.contract, revision: m.revision,
    author: m.author, date: niceDate(Date.now()), project: p.name, company: (p.brand && p.brand.name) || "", dataset: (p.datasets.find(d => d.id === p.view.main_dataset) || {}).name, scale: chartScale(p) }[k] ?? x));
}

// Full page as SVG in millimetres.
export function renderPage(p, { selected = null, forPrint = false } = {}) {
  const pg = p.page, [PWmm, PHmm] = paperSize(pg), mg = pg.margins_mm;
  const AW = PWmm - mg.left - mg.right, AH = PHmm - mg.top - mg.bottom;
  let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PWmm} ${PHmm}" width="${PWmm}mm" height="${PHmm}mm" font-family="${FONT}">`;
  o += `<rect width="${PWmm}" height="${PHmm}" fill="#fff"/>`;
  if (!forPrint) o += `<rect x="${mg.left}" y="${mg.top}" width="${AW}" height="${AH}" fill="none" stroke="#9AA5A8" stroke-width=".2" stroke-dasharray="2 1.5"/>`;
  for (const b of pg.blocks) {
    const x = mg.left + b.x * AW, y = mg.top + b.y * AH, w = b.w * AW, hh = b.h * AH;
    const U = UNITS_PER_MM, iw = w * U, ih = hh * U;
    o += `<g data-block="${b.id}">`;
    if (b.kind === "chart") {
      const { svg } = renderChart(chartProject(p, b), { width: iw - 8, height: ih - 8, compact: iw < 1400 });
      if (b.caption) o += `<text x="${x + 2}" y="${y + 4}" font-size="3" font-weight="700" fill="#18262B">${esc(fillText(b.caption, p))}</text>`;
      o += `<svg x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${hh - 2}" viewBox="0 0 ${iw - 8} ${ih - 8}" preserveAspectRatio="xMidYMid meet">${svg}</svg>`;
    } else if (b.kind === "legend") {
      const lg = renderLegend(p, { width: iw, size: b.font_size || 11 });
      const sc = Math.min(1, (ih - 16) / Math.max(1, lg.height));
      o += `<svg x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${hh - 4}" viewBox="0 0 ${(iw - 16) / sc} ${(ih - 16) / sc}">${lg.svg}</svg>`;
    } else if (b.kind === "image" && b.brand_logo) {
      if (p.brand && p.brand.logo) o += logoSvg(p.brand, x + 1, y + 1, w - 2, hh - 2, "center");
      else if (!forPrint) o += `<text x="${x + w / 2}" y="${y + hh / 2}" font-size="3" text-anchor="middle" fill="#9AA5A8">No brand logo yet: Project → Branding</text>`;
    } else if (b.kind === "image") {
      if (b.data) o += `<image href="${b.data}" x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${hh - 2}" preserveAspectRatio="xMidYMid meet"/>`;
      else if (!forPrint) o += `<text x="${x + w / 2}" y="${y + hh / 2}" font-size="3" text-anchor="middle" fill="#9AA5A8">Choose an image in the panel</text>`;
    } else if (b.kind === "titleblock") {
      const m = p.meta, cells = [["Project", m.title || p.name], ["Client", m.client], ["Contract", m.contract], ["Option", (p.datasets.find(d => d.id === p.view.main_dataset) || {}).name],
        ["Revision", m.revision], ["Prepared by", m.author], ["Date", niceDate(Date.now())], ["Scale", chartScale(p) || `${pg.paper} ${pg.orientation}`]];
      // the brand logo takes a cell on the left of the title block
      const lw = p.brand && p.brand.logo ? Math.min(w * 0.3, logoWidth(p.brand, hh - 3) + 3) : 0;
      if (lw) { o += `<rect x="${x}" y="${y}" width="${lw}" height="${hh}" fill="#fff" stroke="#18262B" stroke-width=".2"/>` + logoSvg(p.brand, x + 1.5, y + 1.5, lw - 3, hh - 3, "center"); }
      const cols = 2, rows = Math.ceil(cells.length / cols), cw = (w - lw) / cols, rh = hh / rows;
      cells.forEach(([k, v], i) => {
        const cx = x + lw + (i % cols) * cw, cy = y + Math.floor(i / cols) * rh;
        o += `<rect x="${cx}" y="${cy}" width="${cw}" height="${rh}" fill="none" stroke="#18262B" stroke-width=".2"/>`;
        o += `<text x="${cx + 1.2}" y="${cy + Math.min(2.6, rh * .35)}" font-size="${Math.min(1.9, rh * .28)}" fill="#5D6B70" letter-spacing=".1">${esc(k.toUpperCase())}</text>`;
        o += `<text x="${cx + 1.2}" y="${cy + rh - Math.min(1.4, rh * .2)}" font-size="${Math.min(3.4, rh * .45)}" fill="#18262B">${esc(clip(v || "", cw / (Math.min(3.4, rh * .45) * .5)))}</text>`;
      });
    } else if (b.kind === "summary") {
      o += summaryBlock(p, b, x, y, w, hh);
    } else if (b.kind === "calendar") {
      o += calendarBlock(p, b, x, y, w, hh);
    } else {
      const L = layoutText(b, p, w, hh);
      let ty = y + PAD;
      if (L.head) {
        ty += L.headSize;
        o += `<text x="${x + PAD}" y="${ty}" font-size="${L.headSize}" font-weight="700" letter-spacing=".15" fill="#18262B">${esc(L.head)}</text>`;
        ty += L.headSize * 0.45;
        o += `<line x1="${x + PAD}" x2="${x + w - PAD}" y1="${ty}" y2="${ty}" stroke="#18262B" stroke-width=".2"/>`;
        ty += L.headSize * 0.35;
      }
      L.lines.forEach(ln => {
        ty += L.fsz * LINE;
        o += `<text x="${x + PAD}" y="${ty}" font-size="${L.fsz}" font-weight="${b.bold ? 700 : 400}" fill="#18262B" xml:space="preserve">${esc(ln)}</text>`;
      });
      if (L.hidden && !forPrint) o += `<text x="${x + w - PAD}" y="${y + hh - 1}" font-size="2.4" text-anchor="end" fill="#B13A3A">+${L.hidden} more lines</text>`;
      overflow[b.id] = L.hidden;
    }
    if (b.border) o += `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="none" stroke="#18262B" stroke-width=".3"/>`;
    if (!forPrint) {
      o += `<rect class="blk" data-block="${b.id}" x="${x}" y="${y}" width="${w}" height="${hh}" fill="transparent" stroke="${selected === b.id ? PAPER.sel : "transparent"}" stroke-width=".8"/>`;
      if (selected === b.id) o += `<rect data-resize="${b.id}" x="${x + w - 3}" y="${y + hh - 3}" width="6" height="6" fill="${PAPER.sel}"/>`;
      o += `<text x="${x + 1}" y="${y - 1}" font-size="2.2" fill="#9AA5A8" pointer-events="none">${esc(blockName(b))}</text>`;
    }
    o += `</g>`;
  }
  return o + "</svg>";
}
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, Math.max(1, Math.floor(n) - 1)) + "…" : String(s));

// ------------------------------------------------------------------ text blocks: heading, word wrap, shrink to fit
const PAD = 1.5, LINE = 1.25, PT = 0.3528; // mm padding, line spacing, mm per point
const overflow = {}; // block id -> lines that did not fit at the last draw
const KIND_NAMES = { text: "Text", title: "Title", legend: "Legend", titleblock: "Title block", chart: "Chart", image: "Image", summary: "Summary", calendar: "Calendar" };
export const blockName = b => (b.title || "").trim() || KIND_NAMES[b.kind] || b.kind;
let measureCtx = null;
function textWidthMm(s, sizeMm, bold) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = `${bold ? 700 : 400} 100px "IBM Plex Sans Condensed", "Arial Narrow", Arial, sans-serif`;
  return (measureCtx.measureText(s).width / 100) * sizeMm;
}
function wrap(text, maxMm, sizeMm, bold) {
  const out = [];
  for (const para of String(text).split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? line + " " + word : word;
      if (textWidthMm(tryLine, sizeMm, bold) <= maxMm) { line = tryLine; continue; }
      if (line) out.push(line);
      // a single word wider than the block is broken across lines
      let w = word;
      while (textWidthMm(w, sizeMm, bold) > maxMm && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && textWidthMm(w.slice(0, n) + "-", sizeMm, bold) > maxMm) n--;
        out.push(w.slice(0, n) + "-"); w = w.slice(n);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}
export function layoutText(b, p, w, hh) {
  const showHead = b.kind === "text" && b.show_title !== false && (b.title || "").trim();
  const base = (b.font_size || 12) * PT;
  const maxW = Math.max(1, w - 2 * PAD);
  let fsz = base, lines, avail, headSize = 0;
  for (let i = 0; i < 40; i++) {
    headSize = showHead ? fsz * 1.1 : 0;
    avail = hh - 2 * PAD - (showHead ? headSize * 1.8 : 0);
    lines = wrap(fillText(b.text, p), maxW, fsz, b.bold);
    if (!b.shrink || lines.length * fsz * LINE <= avail || fsz <= 1.4) break;
    fsz *= 0.94;
  }
  const fit = Math.max(0, Math.floor(avail / (fsz * LINE)));
  return { head: showHead ? b.title.trim().toUpperCase() : "", headSize, fsz, lines: lines.slice(0, fit), hidden: Math.max(0, lines.length - fit),
    shrunkPt: Math.round((fsz / PT) * 10) / 10 };
}

// ------------------------------------------------------------------ page layout view controller
export function pageView(app) {
  const root = $("#page-view");
  let sel = null, drag = null, zoom = 1; // zoom 1 = whole sheet fits the window
  // size the sheet on screen; keep the point under the cursor (or the centre) still when zooming
  function size(anchor) {
    const [W, H] = paperSize(app.p.page), area = $("#page-canvas"), svg = area.querySelector("svg"); if (!svg) return;
    const r0 = svg.getBoundingClientRect(), a = area.getBoundingClientRect();
    const cx = anchor ? anchor.clientX : a.left + a.width / 2, cy = anchor ? anchor.clientY : a.top + a.height / 2;
    const fx = r0.width ? (cx - r0.left) / r0.width : .5, fy = r0.height ? (cy - r0.top) / r0.height : .5;
    const fit = Math.max(0.05, Math.min((area.clientWidth - 40) / W, (area.clientHeight - 40) / H)) * zoom;
    svg.setAttribute("width", (W * fit).toFixed(0)); svg.setAttribute("height", (H * fit).toFixed(0));
    if (anchor !== undefined) { const r1 = svg.getBoundingClientRect(); area.scrollLeft += r1.left + fx * r1.width - cx; area.scrollTop += r1.top + fy * r1.height - cy; }
    const st = $("#st-cursor"); if (st && app.view === "page") st.textContent = `Page zoom ${Math.round(zoom * 100)}%`;
  }
  function draw() {
    const area = $("#page-canvas"), sl = area.scrollLeft, stp = area.scrollTop;
    area.innerHTML = renderPage(app.p, { selected: sel });
    size(); area.scrollLeft = sl; area.scrollTop = stp;
    side();
  }
  function zoomBy(f, e) { const z = clamp(zoom * f, 0.25, 10); if (z === zoom) return; zoom = z; size(e || null); }
  function fit() { zoom = 1; size(); }
  function side() {
    const pg = app.p.page, panel = $("#page-side"); panel.innerHTML = "";
    const set = (k, v) => { app.commit(); pg[k] = v; app.changed(false); draw(); };
    panel.append(h("h3", {}, "Page setup"),
      lbl("Paper", selEl(Object.keys(PAPERS), pg.paper, v => set("paper", v))),
      lbl("Orientation", selEl(["landscape", "portrait"], pg.orientation, v => set("orientation", v))),
      h("div", { class: "row2" }, ...["top", "right", "bottom", "left"].map(k => lbl(`Margin ${k} (mm)`, numEl(pg.margins_mm[k], v => { app.commit(); pg.margins_mm[k] = v; app.changed(false); draw(); })))));
    const b = pg.blocks.find(x => x.id === sel);
    panel.append(h("h3", {}, b ? `Block: ${blockName(b)}` : "Blocks"));
    if (!b) panel.append(h("p", { class: "hint" }, "Click a block on the page to move it, resize it from its corner, or edit it here. Text blocks accept {title}, {subtitle}, {client}, {contract}, {revision}, {author}, {date}, {dataset}."));
    if (b) {
      const upd = (k, v) => { app.commit(); b[k] = v; app.changed(false); draw(); };
      panel.append(h("div", { class: "row2" },
        lbl("Left (%)", numEl(+(b.x * 100).toFixed(1), v => upd("x", clamp(v / 100, 0, 1)))), lbl("Top (%)", numEl(+(b.y * 100).toFixed(1), v => upd("y", clamp(v / 100, 0, 1)))),
        lbl("Width (%)", numEl(+(b.w * 100).toFixed(1), v => upd("w", clamp(v / 100, 0.02, 1)))), lbl("Height (%)", numEl(+(b.h * 100).toFixed(1), v => upd("h", clamp(v / 100, 0.02, 1))))),
        h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!b.border, onchange: e => upd("border", e.target.checked) }), " Border"));
      panel.append(lbl("Name", h("input", { value: b.title || "", placeholder: KIND_NAMES[b.kind] || b.kind, onchange: e => upd("title", e.target.value) })));
      if (b.kind === "text") panel.append(h("label", { class: "chk" }, h("input", { type: "checkbox", checked: b.show_title !== false, onchange: e => upd("show_title", e.target.checked) }), " Show the name as a heading in the block"));
      if (b.kind === "text" || b.kind === "title") {
        panel.append(lbl("Text", h("textarea", { rows: 8, onchange: e => upd("text", e.target.value) }, b.text || "")),
          h("div", { class: "row2" }, lbl("Font size (pt)", numEl(b.font_size || 12, v => upd("font_size", v))), h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!b.bold, onchange: e => upd("bold", e.target.checked) }), " Bold")),
          h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!b.shrink, onchange: e => upd("shrink", e.target.checked) }), " Shrink text to fit the block"));
        const pg2 = app.p.page, [W2, H2] = paperSize(pg2), mg = pg2.margins_mm;
        const L = layoutText(b, app.p, b.w * (W2 - mg.left - mg.right), b.h * (H2 - mg.top - mg.bottom));
        panel.append(h("p", { class: L.hidden ? "msg err" : "hint" }, L.hidden
          ? `${L.hidden} line${L.hidden > 1 ? "s don't" : " doesn't"} fit. Make the block taller, the text smaller, or tick Shrink text to fit.`
          : b.shrink && L.shrunkPt < (b.font_size || 12) ? `Text shrunk to ${L.shrunkPt} pt to fit.` : "Text wraps to the block width. Start a new line with Enter."));
      }
      if (b.kind === "legend") panel.append(lbl("Text size", numEl(b.font_size || 11, v => upd("font_size", v))));
      if (b.kind === "chart") {
        const p = app.p;
        panel.append(h("p", { class: "hint" }, "Each chart block can show its own stretch and option, so one sheet can hold the whole scope and regional close-ups."),
          h("div", { class: "row2" }, lbl("From (blank = project start)", h("input", { value: b.ch_from == null ? "" : mToCh(p, b.ch_from), onchange: e => upd("ch_from", e.target.value === "" ? null : chToM(p, e.target.value)) })),
            lbl("To (blank = project end)", h("input", { value: b.ch_to == null ? "" : mToCh(p, b.ch_to), onchange: e => upd("ch_to", e.target.value === "" ? null : chToM(p, e.target.value)) }))),
          lbl("Saved view", selKV([["", "None (use the settings here)"], ...(p.views || []).map(v => [v.id, v.name])], b.view_id || "", v => upd("view_id", v || null))),
          lbl("Option shown", selKV([["", "The one on screen"], ...p.datasets.map(d => [d.id, d.name])], b.dataset || "", v => upd("dataset", v || null))),
          lbl("Caption", h("input", { value: b.caption || "", placeholder: "e.g. Northern region", onchange: e => upd("caption", e.target.value) })),
          h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!b.no_bands, onchange: e => upd("no_bands", e.target.checked) }), " Leave out the bands"),
          h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!b.no_side, onchange: e => upd("no_side", e.target.checked) }), " Leave out side columns and the resource panel"));
      }
      if (b.kind === "summary") {
        const on = new Set(b.metrics || SUMMARY_DEFAULT);
        panel.append(h("p", { class: "hint" }, "Totals worked out from the project. Tick what to show."),
          ...Object.entries(SUMMARY).map(([k, d]) => h("label", { class: "chk" }, h("input", { type: "checkbox", checked: on.has(k), onchange: e => { e.target.checked ? on.add(k) : on.delete(k); upd("metrics", [...on]); } }), " " + d.name)),
          lbl("Text size (pt)", numEl(b.font_size || 9, v => upd("font_size", v))));
      }
      if (b.kind === "calendar") {
        panel.append(h("p", { class: "hint" }, "Months of the programme with non-working days (from the working days per week) and stand-downs shaded."),
          h("div", { class: "row2" }, lbl("First month", h("input", { type: "month", value: (b.from || app.p.time.start || "").slice(0, 7), onchange: e => upd("from", e.target.value) })),
            lbl("Months", numEl(b.months || 12, v => upd("months", clamp(Math.round(v), 1, 48))))));
      }
      if (b.kind === "image") panel.append(h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!b.brand_logo, onchange: e => upd("brand_logo", e.target.checked) }), " Use the project's brand logo (changes with the branding)"));
      if (b.kind === "image" && !b.brand_logo) panel.append(lbl("Image (logo, key plan…)", h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml",
        onchange: async e => { try { const im = await readImage(e.target.files[0]); upd("data", im.data); } catch (err) { app.toast(err.message); } } })));
      panel.append(h("div", { class: "btns" }, h("button", { type: "button", class: "danger", onclick: () => { app.commit(); pg.blocks = pg.blocks.filter(x => x !== b); sel = null; app.changed(false); draw(); } }, "Delete block")));
    }
    panel.append(h("div", { class: "btns" },
      ...["text", "image", "legend", "titleblock", "chart", "summary", "calendar"].map(k => h("button", { type: "button", onclick: () => { app.commit(); const nb = { id: uid("b"), kind: k, x: .3, y: .3, w: .25, h: .15, text: k === "text" ? "Text" : "", font_size: 11, border: true }; pg.blocks.push(nb); sel = nb.id; app.changed(false); draw(); } }, `Add ${k}`))));
    panel.append(h("h3", {}, "Output"), h("div", { class: "btns" },
      h("button", { type: "button", class: "primary", onclick: () => printPage(app.p) }, "Print…"),
      h("button", { type: "button", onclick: () => download(`${slug(app.p.name)}.svg`, renderPage(app.p, { forPrint: true }), "image/svg+xml") }, "Export SVG"),
      h("button", { type: "button", onclick: () => exportPng(app.p) }, "Export PNG")),
      h("p", { class: "hint" }, "To make a PDF, choose Print and pick “Save as PDF” as the printer. The page size is set from this setup."));
  }
  function pt(e) { const svg = $("#page-canvas svg"), r = svg.getBoundingClientRect(), [W, H] = paperSize(app.p.page); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; }
  root.addEventListener("pointerdown", e => {
    const rs = e.target.closest("[data-resize]"), bl = e.target.closest("[data-block]");
    if (!rs && !bl) { if (e.target.closest("#page-canvas")) { sel = null; draw(); } return; }
    const id = (rs || bl).dataset.resize || (rs || bl).dataset.block, b = app.p.page.blocks.find(x => x.id === id);
    sel = id; drag = { b, mode: rs ? "size" : "move", p0: pt(e), orig: { ...b }, snap: JSON.stringify(app.p) };
    e.target.setPointerCapture?.(e.pointerId); draw();
  });
  root.addEventListener("pointermove", e => {
    if (!drag) return;
    const pg = app.p.page, [W, H] = paperSize(pg), AW = W - pg.margins_mm.left - pg.margins_mm.right, AH = H - pg.margins_mm.top - pg.margins_mm.bottom;
    const q = pt(e), dx = (q.x - drag.p0.x) / AW, dy = (q.y - drag.p0.y) / AH, b = drag.b, o = drag.orig, snap = v => Math.round(v * 200) / 200;
    if (drag.mode === "move") { b.x = snap(clamp(o.x + dx, 0, 1 - b.w)); b.y = snap(clamp(o.y + dy, 0, 1 - b.h)); }
    else { b.w = snap(clamp(o.w + dx, .03, 1 - b.x)); b.h = snap(clamp(o.h + dy, .03, 1 - b.y)); }
    const area = $("#page-canvas"), sl = area.scrollLeft, stp = area.scrollTop;
    area.innerHTML = renderPage(app.p, { selected: sel }); size(); area.scrollLeft = sl; area.scrollTop = stp;
  });
  root.addEventListener("pointerup", () => { if (drag) { app.pushUndo(drag.snap); drag = null; app.changed(false); draw(); } });
  return { draw, zoomBy, fit };
}

const lbl = (t, input) => h("label", { class: "fld" }, h("span", {}, t), input);
const selKV = (opts, v, on) => { const s = h("select", { onchange: e => on(e.target.value) }); opts.forEach(([k, t]) => s.append(h("option", { value: k }, t))); s.value = v; return s; };
const selEl = (opts, v, on) => { const s = h("select", { onchange: e => on(e.target.value) }); opts.forEach(o => s.append(h("option", { value: o }, o))); s.value = v; return s; };
const numEl = (v, on) => h("input", { type: "number", step: "any", value: v, onchange: e => { const n = parseFloat(e.target.value); if (!isNaN(n)) on(n); } });
const slug = s => String(s).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "time_chainage";

export function printPage(p) {
  const [W, H] = paperSize(p.page);
  let st = $("#print-page-size");
  if (!st) { st = h("style", { id: "print-page-size" }); document.head.append(st); }
  st.textContent = `@page { size: ${W}mm ${H}mm; margin: 0; }`;
  const pr = $("#print-root");
  pr.innerHTML = renderPage(p, { forPrint: true });
  window.print();
}

export async function exportPng(p, dpi = 200) {
  const [W, H] = paperSize(p.page), svg = renderPage(p, { forPrint: true });
  const pxW = Math.round(W / 25.4 * dpi), pxH = Math.round(H / 25.4 * dpi);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg.replace(`width="${W}mm" height="${H}mm"`, `width="${pxW}" height="${pxH}"`)], { type: "image/svg+xml" }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const cv = h("canvas", { width: pxW, height: pxH }); const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, pxW, pxH); ctx.drawImage(img, 0, 0, pxW, pxH);
  URL.revokeObjectURL(url);
  cv.toBlob(b => download(`${slug(p.name)}.png`, b, "image/png"), "image/png");
}

// ------------------------------------------------------------------ chart blocks, scale, summary and calendar
// A chart block can show its own stretch of chainage and its own option (data set).
export function chartProject(p, b) {
  if (b.ch_from == null && b.ch_to == null && !b.dataset && !b.no_bands && !b.no_side && !b.view_id) return p;
  const v = b.view_id ? (p.views || []).find(x => x.id === b.view_id) : null;
  if (v) p = { ...p, time: { ...p.time, start: (v.t_from || p.time.start).slice(0, 10), finish: (v.t_to || p.time.finish).slice(0, 10), orientation: v.orientation || p.time.orientation },
    view: { ...p.view, hidden_styles: v.hidden_styles || [] } };
  let c = { ...p.chainage, start_m: b.ch_from ?? v?.ch_from ?? p.chainage.start_m, end_m: b.ch_to ?? v?.ch_to ?? p.chainage.end_m };
  if (!(c.end_m > c.start_m)) c = p.chainage;
  return { ...p, chainage: c, bands: b.no_bands ? [] : p.bands, side_cols: b.no_side ? (p.side_cols || []).map(c => ({ ...c, show: false })) : p.side_cols,
    resources: b.no_side && p.resources ? { ...p.resources, panel: { ...(p.resources.panel || {}), show: false } } : p.resources,
    view: { ...p.view, main_dataset: b.dataset || p.view.main_dataset, compare_dataset: b.dataset ? null : p.view.compare_dataset } };
}
// "Approx. scale at A3: 10 mm = 200 m", from the first chart block on the page
export function chartScale(p) {
  const pg = p.page, b = (pg.blocks || []).find(x => x.kind === "chart"); if (!b) return "";
  const [PWmm] = paperSize(pg), mg = pg.margins_mm, wmm = b.w * (PWmm - mg.left - mg.right) - 2, iw = b.w * (PWmm - mg.left - mg.right) * UNITS_PER_MM;
  const q = chartProject(p, b), G = geometry(q, { width: iw - 8, height: 1000, compact: iw < 1400 });
  const live = Math.abs(q.chainage.end_m - q.chainage.start_m) - G.breaks.reduce((n, [a, c]) => n + (c - a), 0);
  const gridMm = (G.PW - G.breaks.length * (G.compact ? 12 : 18)) / (iw - 8) * wmm; if (!(gridMm > 0) || !(live > 0)) return "";
  const per10 = live / gridMm * 10, mag = 10 ** Math.floor(Math.log10(per10)), nice = [1, 2, 2.5, 5, 10].map(k => k * mag).reduce((a, c) => (Math.abs(c - per10) < Math.abs(a - per10) ? c : a));
  return `Approx. ${pg.paper}: 10 mm = ${lenFmt(p, nice)}`;
}

const SUMMARY = {
  span: { name: "Programme start and finish" }, count: { name: "Number of activities" }, length: { name: "Length of work by style" },
  qty: { name: "Quantities by unit" }, locations: { name: "Locations by type" }, bands: { name: "Totals from quantity bands" },
};
const SUMMARY_DEFAULT = ["span", "count", "qty", "bands"];
export function summaryRows(p, metrics = SUMMARY_DEFAULT) {
  const acts = p.activities.filter(a => a.dataset === p.view.main_dataset), rows = [];
  const S = Object.fromEntries(p.styles.map(s => [s.code, s]));
  for (const k of metrics) {
    if (k === "span" && acts.length) { rows.push(["Start", niceDate(Math.min(...acts.map(a => tms(a.start))))], ["Finish", niceDate(Math.max(...acts.map(a => tms(a.finish))) - 6e4)]); }
    if (k === "count") rows.push(["Activities", acts.length.toLocaleString()]);
    if (k === "length") { const m = new Map(); acts.forEach(a => { const st = S[a.style]; if (!st || st.kind === "milestone") return; m.set(st.name, (m.get(st.name) || 0) + Math.abs(a.ch1_m - a.ch0_m)); }); [...m].sort((a, b) => b[1] - a[1]).forEach(([n, v]) => v > 0 && rows.push([n, lenFmt(p, v)])); }
    if (k === "qty") { const m = new Map(); acts.forEach(a => { if (a.qty && a.qty_unit) m.set(a.qty_unit, (m.get(a.qty_unit) || 0) + +a.qty); }); m.forEach((v, u) => rows.push([`Total ${u}`, Math.round(v).toLocaleString()])); }
    if (k === "locations") { const m = new Map(); p.locations.forEach(l => { const t = p.location_types.find(x => x.id === l.type); const n = t ? t.name : l.type; m.set(n, (m.get(n) || 0) + 1); }); m.forEach((v, n) => rows.push([n, String(v)])); }
    if (k === "bands") for (const b of p.bands || []) { if (b.kind !== "quantities") continue; const r = rowsOf(b.data), head = r[0] && isNaN(+r[0][0]) ? r[0] : null;
      const body = head ? r.slice(1) : r, n = Math.max(0, ...body.map(x => x.length)) - 2;
      for (let i = 0; i < n; i++) { const tot = body.reduce((s2, x) => s2 + (+String(x[i + 2] || "").replace(/,/g, "") || 0), 0); if (tot) rows.push([`Total ${head ? head[i + 2] : "qty " + (i + 1)}`, Math.round(tot).toLocaleString()]); } }
  }
  return rows;
}
function summaryBlock(p, b, x, y, w, hh) {
  const rows = summaryRows(p, b.metrics || SUMMARY_DEFAULT), fs = (b.font_size || 9) * PT, title = (b.title || "Summary").toUpperCase();
  let o = `<text x="${x + PAD}" y="${y + PAD + fs * 1.1}" font-size="${fs * 1.1}" font-weight="700" letter-spacing=".15" fill="#18262B">${esc(title)}</text>`;
  let ty = y + PAD + fs * 1.1 + fs * 0.8;
  o += `<line x1="${x + PAD}" x2="${x + w - PAD}" y1="${ty - fs * 0.4}" y2="${ty - fs * 0.4}" stroke="#18262B" stroke-width=".2"/>`;
  for (const [k, v] of rows) { ty += fs * LINE; if (ty > y + hh - PAD) break;
    o += `<text x="${x + PAD}" y="${ty}" font-size="${fs}" fill="#5D6B70">${esc(k)}</text><text x="${x + w - PAD}" y="${ty}" font-size="${fs}" font-weight="600" text-anchor="end" fill="#18262B">${esc(v)}</text>`; }
  return o;
}
function calendarBlock(p, b, x, y, w, hh) {
  const from = (b.from || p.time.start || "").slice(0, 7) || new Date().toISOString().slice(0, 7), n = b.months || 12;
  const [fy, fm] = from.split("-").map(Number), wd = p.time.work_days_per_week || 7, ws = p.time.week_start ?? 1;
  const off = d => { const k = new Date(d).getUTCDay(); return (wd <= 5.5 && (k === 0 || k === 6)) || (wd < 7 && wd > 5.5 && k === 0); };
  const sd = (p.time_markers || []).filter(m => m.kind === "shutdown" && m.finish && m.ch0_m == null).map(m => [tms(m.start), tms(m.finish)]);
  const cols = Math.max(1, Math.round(Math.sqrt(n * (w / hh) * 0.9))), rows = Math.ceil(n / cols), cw = (w - 2) / cols, ch = (hh - 2) / rows;
  const cell = Math.min(cw / 7.6, ch / 8.4), fs = cell * 0.55;
  let o = "";
  for (let i = 0; i < n; i++) {
    const mx = x + 1 + (i % cols) * cw + (cw - cell * 7) / 2, my = y + 1 + Math.floor(i / cols) * ch + cell * 0.2, m0 = Date.UTC(fy, fm - 1 + i, 1), dt = new Date(m0);
    o += `<text x="${mx + cell * 3.5}" y="${my + cell * 0.8}" font-size="${fs * 1.15}" font-weight="700" text-anchor="middle" fill="#18262B">${MON[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</text>`;
    const lead = (dt.getUTCDay() - ws + 7) % 7, days = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    for (let d = 0; d < days; d++) {
      const k = lead + d, cx = mx + (k % 7) * cell, cy = my + cell * 1.2 + Math.floor(k / 7) * cell, t = m0 + d * DAY;
      const stood = sd.some(([a, c]) => t >= a && t < c), fill = stood ? "#E06666" : off(t) ? "#F4CCCC" : "#FFFFFF";
      o += `<rect x="${cx}" y="${cy}" width="${cell * 0.94}" height="${cell * 0.94}" fill="${fill}" stroke="#C9D2D2" stroke-width=".1"/><text x="${cx + cell * 0.47}" y="${cy + cell * 0.66}" font-size="${fs * 0.85}" text-anchor="middle" fill="#18262B">${d + 1}</text>`;
    }
  }
  return o;
}
