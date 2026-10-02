// Page layout: paper, margins and placed blocks (title, title block, chart, legend, text). Used for print and export.
import { renderChart, renderLegend, PAPER } from "./render.js";
import { esc, h, $, $$, download, niceDate, tms, clamp, uid } from "./util.js";
import { readImage } from "./dialogs.js";

export const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], Letter: [279, 216], Ledger: [432, 279], "ANSI D": [864, 559] };
const UNITS_PER_MM = 3.5; // drawing units per millimetre inside placed blocks (sets text size on paper)
const FONT = "IBM Plex Sans Condensed, Arial Narrow, Arial, sans-serif";

export function paperSize(pg) {
  const [a, b] = PAPERS[pg.paper] || PAPERS.A3;
  return pg.orientation === "portrait" ? [Math.min(a, b), Math.max(a, b)] : [Math.max(a, b), Math.min(a, b)];
}

function fillText(t, p) {
  const m = p.meta || {};
  return String(t || "").replace(/\{(\w+)\}/g, (x, k) => ({ title: m.title || p.name, subtitle: m.subtitle, client: m.client, contract: m.contract, revision: m.revision,
    author: m.author, date: niceDate(Date.now()), project: p.name, dataset: (p.datasets.find(d => d.id === p.view.main_dataset) || {}).name }[k] ?? x));
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
      const { svg } = renderChart(p, { width: iw - 8, height: ih - 8, compact: iw < 1400 });
      o += `<svg x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${hh - 2}" viewBox="0 0 ${iw - 8} ${ih - 8}" preserveAspectRatio="xMidYMid meet">${svg}</svg>`;
    } else if (b.kind === "legend") {
      const lg = renderLegend(p, { width: iw, size: b.font_size || 11 });
      const sc = Math.min(1, (ih - 16) / Math.max(1, lg.height));
      o += `<svg x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${hh - 4}" viewBox="0 0 ${(iw - 16) / sc} ${(ih - 16) / sc}">${lg.svg}</svg>`;
    } else if (b.kind === "image") {
      if (b.data) o += `<image href="${b.data}" x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${hh - 2}" preserveAspectRatio="xMidYMid meet"/>`;
      else if (!forPrint) o += `<text x="${x + w / 2}" y="${y + hh / 2}" font-size="3" text-anchor="middle" fill="#9AA5A8">Choose an image in the panel</text>`;
    } else if (b.kind === "titleblock") {
      const m = p.meta, cells = [["Project", m.title || p.name], ["Client", m.client], ["Contract", m.contract], ["Option", (p.datasets.find(d => d.id === p.view.main_dataset) || {}).name],
        ["Revision", m.revision], ["Prepared by", m.author], ["Date", niceDate(Date.now())], ["Sheet", `${pg.paper} ${pg.orientation}`]];
      const cols = 2, rows = Math.ceil(cells.length / cols), cw = w / cols, rh = hh / rows;
      cells.forEach(([k, v], i) => {
        const cx = x + (i % cols) * cw, cy = y + Math.floor(i / cols) * rh;
        o += `<rect x="${cx}" y="${cy}" width="${cw}" height="${rh}" fill="none" stroke="#18262B" stroke-width=".2"/>`;
        o += `<text x="${cx + 1.2}" y="${cy + Math.min(2.6, rh * .35)}" font-size="${Math.min(1.9, rh * .28)}" fill="#5D6B70" letter-spacing=".1">${esc(k.toUpperCase())}</text>`;
        o += `<text x="${cx + 1.2}" y="${cy + rh - Math.min(1.4, rh * .2)}" font-size="${Math.min(3.4, rh * .45)}" fill="#18262B">${esc(clip(v || "", cw / (Math.min(3.4, rh * .45) * .5)))}</text>`;
      });
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
const KIND_NAMES = { text: "Text", title: "Title", legend: "Legend", titleblock: "Title block", chart: "Chart", image: "Image" };
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
  let sel = null, drag = null;
  function draw() {
    const pg = app.p.page, [W, H] = paperSize(pg);
    const area = $("#page-canvas");
    area.innerHTML = renderPage(app.p, { selected: sel });
    const svg = area.querySelector("svg");
    const fit = Math.min((area.clientWidth - 40) / W, (area.clientHeight - 40) / H);
    svg.setAttribute("width", (W * fit).toFixed(0)); svg.setAttribute("height", (H * fit).toFixed(0));
    side();
  }
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
      if (b.kind === "image") panel.append(lbl("Image (logo, key plan…)", h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml",
        onchange: async e => { try { const im = await readImage(e.target.files[0]); upd("data", im.data); } catch (err) { app.toast(err.message); } } })));
      panel.append(h("div", { class: "btns" }, h("button", { type: "button", class: "danger", onclick: () => { app.commit(); pg.blocks = pg.blocks.filter(x => x !== b); sel = null; app.changed(false); draw(); } }, "Delete block")));
    }
    panel.append(h("div", { class: "btns" },
      ...["text", "image", "legend", "titleblock", "chart"].map(k => h("button", { type: "button", onclick: () => { app.commit(); const nb = { id: uid("b"), kind: k, x: .3, y: .3, w: .25, h: .15, text: k === "text" ? "Text" : "", font_size: 11, border: true }; pg.blocks.push(nb); sel = nb.id; app.changed(false); draw(); } }, `Add ${k}`))));
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
    $("#page-canvas").innerHTML = renderPage(app.p, { selected: sel });
    const svg = $("#page-canvas svg"), area = $("#page-canvas"), fit = Math.min((area.clientWidth - 40) / W, (area.clientHeight - 40) / H);
    svg.setAttribute("width", (W * fit).toFixed(0)); svg.setAttribute("height", (H * fit).toFixed(0));
  });
  root.addEventListener("pointerup", () => { if (drag) { app.pushUndo(drag.snap); drag = null; app.changed(false); draw(); } });
  return { draw };
}

const lbl = (t, input) => h("label", { class: "fld" }, h("span", {}, t), input);
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
