// Time-Chainage Studio front end: menus, chart interaction, side panels, undo and autosave.
import { api } from "./api.js";
import { renderChart, renderLegend, geometry, styleMap } from "./render.js";
import { DAY, tms, tstr, dstr, niceDate, niceFinish, chFmt, chToM, mToCh, esc, $, $$, h, uid, clamp, download, debounce, DOW } from "./util.js";
import * as D from "./dialogs.js";
import { pageView, printPage, exportPng, renderPage } from "./page.js";

const app = {
  p: null, sel: null, mode: "select", view: "chart", xZoom: 1, undoS: [], redoS: [], presets: null, saveState: "",
  commit() { this.pushUndo(JSON.stringify(this.p)); },
  pushUndo(s) { this.undoS.push(s); if (this.undoS.length > 80) this.undoS.shift(); this.redoS = []; },
  changed(rerender = true) { this.saveState = "Unsaved changes"; status(); save(); if (rerender) render(); },
  open(p) { this.p = p; this.rev = p.rev || 0; this.stale = false; this.sel = null; this.undoS = []; this.redoS = []; try { localStorage.setItem("tcs-last", p.id); } catch (e) { /* storage blocked */ } this.saveState = "Saved"; render(); },
  load(p) { this.commit(); this.p = p; this.rev = p.rev || 0; this.sel = null; render(); },
  rev: 0, stale: false, // server revision of the copy this window last read or saved; undo never changes it
  toast,
};
window.tcs = app; // handy for debugging from the console

const save = debounce(async () => {
  if (!app.p || app.stale) return;
  try {
    app.saveState = "Saving…"; status();
    app.p.rev = app.rev;
    const s = await api.save(app.p);
    app.rev = app.p.rev = s.rev;
    app.saveState = "Saved " + new Date().toLocaleTimeString().slice(0, 5); status();
  } catch (e) {
    if (e.status === 409) {
      app.stale = true;
      app.saveState = "Not saved: changed in another window. Reload the page (F5).";
      toast("This project was changed in another window, so this window's changes were not saved. Reload the page (F5) to get the latest version.");
    } else app.saveState = "Not saved: " + e.message;
    status();
  }
}, 700);

function undo() { if (!app.undoS.length) return; app.redoS.push(JSON.stringify(app.p)); app.p = JSON.parse(app.undoS.pop()); validSel(); app.changed(); toast("Undone"); }
function redo() { if (!app.redoS.length) return; app.undoS.push(JSON.stringify(app.p)); app.p = JSON.parse(app.redoS.pop()); validSel(); app.changed(); toast("Redone"); }
function validSel() { if (app.sel && !findSel()) app.sel = null; }
function findSel() {
  const s = app.sel, p = app.p; if (!s || !p) return null;
  const list = { act: p.activities, loc: p.locations, mk: p.time_markers, style: p.styles, ds: p.datasets }[s.kind] || [];
  return list.find(x => (s.kind === "style" ? x.code : x.id) === s.id) || null;
}
let tt; function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 3200); }

// ------------------------------------------------------------------ menus
const MENU = {
  File: [["New project…", "Ctrl+N", () => D.projectSetup(app, "new")], ["Open project…", "Ctrl+O", () => D.openProject(app)], ["Duplicate project", "", () => need() && api.duplicate(app.p.id).then(p => { app.open(p); toast("Copy opened"); })], "-",
    ["Import Excel workbook…", "", () => D.importExcel(app)], ["Import from P6 (XER) with mapping…", "", () => D.p6Dialog(app, "import")], ["Import TurboChart (.tchart)…", "", () => D.importTchart(app)], ["Open project file (.json)…", "", () => D.importJson(app)], "-",
    ["Export P6 XER (main data set)", "", () => need() && exportFile("xer", `?dataset=${app.p.view.main_dataset}`)], ["Export TurboChart (.tchart)", "", () => need() && exportFile("tchart")], ["Export project file (.json)", "", () => need() && exportFile("json")],
    ["Export chart as SVG", "", () => need() && exportChartSvg()], "-",
    ["Page layout…", "Ctrl+L", () => need() && setView("page")], ["Print…", "Ctrl+P", () => need() && printPage(app.p)], ["Export page as PNG", "", () => need() && exportPng(app.p)]],
  Edit: [["Undo", "Ctrl+Z", undo], ["Redo", "Ctrl+Y", redo], "-", ["Duplicate selection", "Ctrl+D", () => dupSel()], ["Delete selection", "Del", () => delSel()]],
  View: [["Chart", "", () => setView("chart")], ["Page layout", "", () => need() && setView("page")], "-",
    ["Zoom time in", "Ctrl+=", () => zoomT(1.25)], ["Zoom time out", "Ctrl+-", () => zoomT(0.8)], ["Fit time to window", "", () => fitTime()],
    ["Zoom chainage in", "", () => { app.xZoom = Math.min(20, app.xZoom * 1.5); render(); }], ["Zoom chainage out", "", () => { app.xZoom = Math.max(1, app.xZoom / 1.5); render(); }], ["Fit chainage", "", () => { app.xZoom = 1; render(); }], "-",
    ["Labels", "", () => toggle("show_labels"), () => app.p?.view.show_labels !== false], ["Footprints", "", () => toggle("show_footprints"), () => app.p?.view.show_footprints !== false],
    ["Time markers", "", () => toggle("show_time_markers"), () => app.p?.view.show_time_markers !== false], ["Location grid", "", () => toggle("show_location_grid"), () => app.p?.view.show_location_grid !== false]],
  Insert: [["Activity", "", () => need() && insertAct()], ["Location marker", "", () => need() && insertLoc()], ["Time marker", "", () => need() && insertMk()], ["Section…", "", () => need() && D.projectSetup(app, "edit")], ["Activity style", "", () => need() && insertStyle()], ["Header image…", "", () => need() && D.headerImage(app)]],
  Data: [["Import from P6 (XER) with mapping…", "", () => D.p6Dialog(app, "import")], ["Sync from P6 (XER)…", "", () => need() && D.p6Dialog(app, "sync")], "-",
    ["Data sets (options)", "", () => need() && tab("ds")], ["Productivity library", "", () => need() && D.productivities(app)]],
  Project: [["Project setup…", "", () => need() && D.projectSetup(app, "edit")], ["Header image…", "", () => need() && D.headerImage(app)], ["Activity styles", "", () => need() && tab("styles")], ["Locations and types", "", () => need() && tab("locs")]],
  Help: [["Keyboard shortcuts", "", () => shortcuts()], ["API documentation", "", () => window.open("/docs", "_blank")]],
};
function need() { if (!app.p) { toast("Open or create a project first."); return false; } return true; }
function exportFile(kind, q = "") { const a = h("a", { href: api.exportUrl(app.p.id, kind, q) }); document.body.append(a); a.click(); a.remove(); }
function toggle(k) { app.p.view[k] = app.p.view[k] === false; app.changed(); }

function buildMenus() {
  const bar = $("#menubar"); bar.innerHTML = "";
  Object.entries(MENU).forEach(([name, items]) => {
    const btn = h("button", { type: "button", class: "menu-btn", "aria-haspopup": "true", "aria-expanded": "false" }, name);
    const list = h("div", { class: "menu-list", role: "menu", hidden: true });
    const fill = () => { list.innerHTML = ""; items.forEach(it => {
      if (it === "-") return list.append(h("hr"));
      const [label, key, fn, checked] = it;
      list.append(h("button", { type: "button", role: "menuitem", onclick: () => { closeMenus(); fn(); } }, h("span", { class: "chk-mark" }, checked ? (checked() ? "✓" : "") : ""), h("span", {}, label), h("kbd", {}, key)));
    }); };
    btn.addEventListener("click", e => { e.stopPropagation(); const open = list.hidden; closeMenus(); if (open) { fill(); list.hidden = false; btn.setAttribute("aria-expanded", "true"); } });
    btn.addEventListener("mouseenter", () => { if ($$(".menu-list").some(l => !l.hidden) && list.hidden) { closeMenus(); fill(); list.hidden = false; btn.setAttribute("aria-expanded", "true"); } });
    bar.append(h("div", { class: "menu" }, btn, list));
  });
}
function closeMenus() { $$(".menu-list").forEach(l => (l.hidden = true)); $$(".menu-btn").forEach(b => b.setAttribute("aria-expanded", "false")); }
document.addEventListener("click", e => { if (!e.target.closest(".menu")) closeMenus(); });

function shortcuts() {
  D.modal({ title: "Keyboard shortcuts", body: el => el.append(h("table", { class: "grid-tbl" }, h("tbody", {}, [
    ["V", "Select and drag"], ["D", "Draw activity"], ["Del", "Delete selection"], ["Ctrl+Z / Ctrl+Y", "Undo / redo"], ["Ctrl+D", "Duplicate selection"],
    ["Ctrl + mouse wheel", "Zoom time"], ["Shift + mouse wheel", "Scroll across chainage"], ["Esc", "Clear selection"], ["Ctrl+L", "Page layout"], ["Ctrl+P", "Print"]]
    .map(([k, v]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, v)))))), buttons: [{ label: "Close" }] });
}

// ------------------------------------------------------------------ views
function setView(v) {
  app.view = v; $("#chart-view").hidden = v !== "chart"; $("#page-view").hidden = v !== "page";
  $$("#viewtabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.view === v));
  if (v === "page") pv.draw(); else render();
}
const pv = pageView(app);

function render() {
  const p = app.p;
  $("#empty").hidden = !!p; $("#workspace").hidden = !p;
  if (!p) { status(); return; }
  document.title = `${p.name} · Time-Chainage Studio`;
  $("#proj-name").textContent = p.name;
  // dataset pickers
  const ds = $("#ds-main"), cmp = $("#ds-cmp");
  ds.innerHTML = ""; cmp.innerHTML = "";
  cmp.append(h("option", { value: "" }, "None"));
  p.datasets.forEach(d => { ds.append(h("option", { value: d.id }, d.name)); cmp.append(h("option", { value: d.id }, d.name)); });
  ds.value = p.view.main_dataset; cmp.value = p.view.compare_dataset || "";
  $("#ppd").value = p.time.px_per_day;
  if (app.view === "page") pv.draw(); else drawChart();
  panel(); status();
}

let G = null;
function drawChart() {
  const box = $("#chart-scroll"), svg = $("#chart");
  const width = Math.max(700, (box.clientWidth - 2) * app.xZoom);
  const r = renderChart(app.p, { width, selection: app.sel, interactive: true });
  G = r.G;
  svg.setAttribute("viewBox", `0 0 ${G.W} ${G.H}`); svg.setAttribute("width", G.W); svg.setAttribute("height", G.H);
  svg.innerHTML = r.svg;
  svg.classList.toggle("draw", app.mode === "draw");
}

function status() {
  const p = app.p;
  $("#st-save").textContent = p ? app.saveState : "";
  $("#st-count").textContent = p ? `${p.activities.filter(a => a.dataset === p.view.main_dataset).length} activities in view · ${p.activities.length} total` : "";
  $("#b-undo").disabled = !app.undoS.length; $("#b-redo").disabled = !app.redoS.length;
}

function zoomT(f) { if (!need()) return; app.p.time.px_per_day = +clamp(app.p.time.px_per_day * f, 0.05, 40).toFixed(3); app.changed(); }
function fitTime() {
  if (!need()) return; const box = $("#chart-scroll");
  const g = geometry(app.p, { width: box.clientWidth, height: box.clientHeight - 4 });
  app.p.time.px_per_day = +g.ppd.toFixed(3); app.changed();
}

// ------------------------------------------------------------------ chart interaction
const svgEl = $("#chart");
let drag = null;
const pt = e => { const r = svgEl.getBoundingClientRect(); return { x: (e.clientX - r.left) * (G.W / r.width), y: (e.clientY - r.top) * (G.H / r.height) }; };
const inGrid = q => G && q.x >= G.L && q.x <= G.R && q.y >= G.top && q.y <= G.top + G.GH;
const snapM = m => { const s = +app.p.chainage.snap_m || 0; return s > 0 ? Math.round(m / s) * s : m; };
const snapT = ms => Math.round(ms / (DAY / (G.ppd >= 24 ? 24 : G.ppd >= 6 ? 4 : 1))) * (DAY / (G.ppd >= 24 ? 24 : G.ppd >= 6 ? 4 : 1));

svgEl.addEventListener("pointerdown", e => {
  if (e.button !== 0 || !app.p) return;
  const q = pt(e);
  if (app.mode === "draw") { if (!inGrid(q)) return; drag = { type: "draw", q0: q, q1: q }; svgEl.setPointerCapture(e.pointerId); return; }
  const hd = e.target.closest("[data-h]"), ac = e.target.closest("[data-act]"), mk = e.target.closest("[data-mk]"), lc = e.target.closest("[data-loc]");
  if (hd && app.sel?.kind === "act") return startDrag(e, "end", app.sel.id, q, +hd.dataset.h);
  if (ac) { select("act", ac.dataset.act); return startDrag(e, "move", ac.dataset.act, q); }
  if (mk) return select("mk", mk.dataset.mk);
  if (lc) return select("loc", lc.dataset.loc);
  if (e.target.closest("[data-hdr]")) return D.headerImage(app);
  if (app.sel) { app.sel = null; render(); }
});
function startDrag(e, type, id, q, end) {
  const a = app.p.activities.find(x => x.id === id); if (!a) return;
  drag = { type, id, q0: q, end, orig: { ...a }, snap: JSON.stringify(app.p), moved: false };
  svgEl.setPointerCapture(e.pointerId);
}
svgEl.addEventListener("pointermove", e => {
  if (!app.p || !G) return;
  const q = pt(e); readout(q);
  if (!drag) return;
  if (drag.type === "draw") { drag.q1 = q; const rb = $("#rb"); Object.entries({ x1: drag.q0.x, y1: drag.q0.y, x2: q.x, y2: q.y }).forEach(([k, v]) => rb.setAttribute(k, v)); rb.removeAttribute("display"); return; }
  const a = app.p.activities.find(x => x.id === drag.id), o = drag.orig; if (!a) return;
  if (Math.abs(q.x - drag.q0.x) + Math.abs(q.y - drag.q0.y) > 3) drag.moved = true;
  if (!drag.moved) return;
  const dM = snapM(G.Xi(q.x) - G.Xi(drag.q0.x)), dT = a.locked ? 0 : snapT(G.Yi(q.y) - G.Yi(drag.q0.y));
  if (drag.type === "move") { a.ch0_m = o.ch0_m + dM; a.ch1_m = o.ch1_m + dM; a.start = tstr(tms(o.start) + dT); a.finish = tstr(tms(o.finish) + dT); }
  else if (drag.end === 0) { a.ch0_m = o.ch0_m + dM; a.start = tstr(Math.min(tms(o.start) + dT, tms(a.finish))); }
  else { a.ch1_m = o.ch1_m + dM; a.finish = tstr(Math.max(tms(o.finish) + dT, tms(a.start))); }
  drawChart();
});
svgEl.addEventListener("pointerup", () => {
  if (!drag) return; const d = drag; drag = null;
  if (d.type === "draw") {
    $("#rb")?.setAttribute("display", "none");
    let c0 = snapM(G.Xi(d.q0.x)), c1 = snapM(G.Xi(d.q1.x)), t0 = snapT(G.Yi(d.q0.y)), t1 = snapT(G.Yi(d.q1.y));
    const tiny = Math.hypot(d.q1.x - d.q0.x, d.q1.y - d.q0.y) < 6;
    if (tiny) { const half = Math.max(app.p.chainage.snap_m || 0, (app.p.chainage.end_m - app.p.chainage.start_m) / 300); c0 -= half; c1 += half; t1 = t0 + 7 * DAY; }
    if (t1 < t0) { [t0, t1] = [t1, t0]; [c0, c1] = [c1, c0]; }
    if (t1 - t0 < DAY / 24) t1 = t0 + DAY;
    const st = app.p.styles.find(s => s.kind === (tiny ? "block" : "line")) || app.p.styles[0];
    app.commit();
    const a = newAct({ ch0_m: c0, ch1_m: c1, start: tstr(t0), finish: tstr(t1), style: st?.code || "ACT" });
    app.p.activities.push(a); app.sel = { kind: "act", id: a.id }; tab("props"); app.changed();
    setTimeout(() => { const f = $("#pp-name"); f?.focus(); f?.select(); }, 30);
    return;
  }
  if (d.moved) { app.pushUndo(d.snap); app.changed(); }
});
svgEl.addEventListener("pointerleave", () => { $("#xv")?.setAttribute("display", "none"); $("#xh")?.setAttribute("display", "none"); });
$("#chart-scroll").addEventListener("wheel", e => { if (e.ctrlKey && app.p) { e.preventDefault(); zoomT(e.deltaY < 0 ? 1.15 : 0.87); } }, { passive: false });

function readout(q) {
  const xv = $("#xv"), xh = $("#xh"); if (!xv) return;
  if (!inGrid(q)) { xv.setAttribute("display", "none"); xh.setAttribute("display", "none"); $("#st-cursor").textContent = ""; return; }
  ["x1", "x2"].forEach(k => xv.setAttribute(k, q.x)); ["y1", "y2"].forEach(k => xh.setAttribute(k, q.y));
  xv.removeAttribute("display"); xh.removeAttribute("display");
  const t = G.Yi(q.y), d = new Date(t);
  $("#st-cursor").textContent = `${app.p.chainage.prefix || ""}${chFmt(app.p, G.Xi(q.x))} ${app.p.chainage.unit} · ${DOW[d.getUTCDay()]} ${niceDate(t)} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
}

function setMode(m) { app.mode = m; $$("#tools button[data-mode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === m)); svgEl.classList.toggle("draw", m === "draw");
  if (m === "draw") toast("Drag from the start point to the finish point. A single click adds a 7-day block."); }

document.addEventListener("keydown", e => {
  const tag = e.target.tagName; const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === "n") { e.preventDefault(); D.projectSetup(app, "new"); return; }
  if (mod && k === "o") { e.preventDefault(); D.openProject(app); return; }
  if (mod && k === "p" && app.p) { e.preventDefault(); printPage(app.p); return; }
  if (mod && k === "l" && app.p) { e.preventDefault(); setView(app.view === "page" ? "chart" : "page"); return; }
  if (typing || $("dialog[open]")) return;
  if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === "y") { e.preventDefault(); redo(); return; }
  if (mod && k === "d") { e.preventDefault(); dupSel(); return; }
  if (mod && (k === "=" || k === "+")) { e.preventDefault(); zoomT(1.25); return; }
  if (mod && k === "-") { e.preventDefault(); zoomT(0.8); return; }
  if (mod) return;
  if ((k === "delete" || k === "backspace") && app.sel) { e.preventDefault(); delSel(); }
  if (k === "escape") { app.sel = null; setMode("select"); render(); }
  if (k === "v") setMode("select"); if (k === "d") setMode("draw");
});

// ------------------------------------------------------------------ create / delete
function newAct(x) {
  return { id: uid("a_"), dataset: app.p.view.main_dataset, code: nextCode(), name: "New activity", wbs: "", notes: "", qty: null, qty_unit: "", rate: null, rate_unit: "",
    label: null, footprint: null, locked: false, p6: null, ...x };
}
function nextCode() { const n = app.p.activities.filter(a => /^A\d+$/.test(a.code)).map(a => +a.code.slice(1)); return "A" + String((n.length ? Math.max(...n) : 1000) + 10); }
function insertAct() {
  const p = app.p, mid = (p.chainage.start_m + p.chainage.end_m) / 2, span = (p.chainage.end_m - p.chainage.start_m) / 6, t0 = tms(p.time.start) + 7 * DAY;
  app.commit(); const a = newAct({ ch0_m: mid - span / 2, ch1_m: mid + span / 2, start: tstr(t0), finish: tstr(t0 + 28 * DAY), style: p.styles[0]?.code || "ACT" });
  p.activities.push(a); select("act", a.id); app.changed();
}
function insertLoc() { const p = app.p; app.commit(); const l = { id: uid("l_"), name: "New location", ch_m: (p.chainage.start_m + p.chainage.end_m) / 2, to_m: null, type: p.location_types[0]?.id || "other", row: null, label: true, grid: false, notes: "" };
  p.locations.push(l); select("loc", l.id); app.changed(); }
function insertMk() { const p = app.p; app.commit(); const m = { id: uid("t_"), label: "Milestone", kind: "milestone", start: p.time.start + "T00:00", finish: null, ch0_m: null, ch1_m: null, colour: "#C00000" };
  p.time_markers.push(m); select("mk", m.id); app.changed(); }
function insertStyle() { const p = app.p; app.commit(); let code = "STYLE" + (p.styles.length + 1); while (p.styles.some(s => s.code === code)) code += "_";
  p.styles.push({ code, name: "New style", kind: "line", colour: "#1F6E8C", width: 3, dash: "solid", fill_opacity: 0.3, legend: true,
    label: { show: true, text: "{name}", follow_slope: true, position: "mid", side: "above", size: 11 }, footprint: { enabled: false, length_m: 0, lag_days: 0, opacity: 0.18 } });
  select("style", code); app.changed(); }
function delSel() {
  const s = app.sel, it = findSel(); if (!s || !it) return;
  if (s.kind === "style" && app.p.activities.some(a => a.style === s.id)) return toast("That style is still used by activities. Move them to another style first.");
  if (s.kind === "ds") return toast("Delete data sets from the Data sets tab.");
  app.commit();
  const key = { act: "activities", loc: "locations", mk: "time_markers", style: "styles" }[s.kind];
  app.p[key] = app.p[key].filter(x => x !== it); app.sel = null; app.changed(); toast("Deleted");
}
function dupSel() {
  const s = app.sel, it = findSel(); if (!s || !it || !["act", "loc", "mk"].includes(s.kind)) return;
  app.commit(); const c = JSON.parse(JSON.stringify(it)); c.id = uid(s.kind[0] + "_");
  if (s.kind === "act") { c.code = nextCode(); c.locked = false; c.p6 = null; c.start = tstr(tms(c.start) + 7 * DAY); c.finish = tstr(tms(c.finish) + 7 * DAY); app.p.activities.push(c); }
  if (s.kind === "loc") { c.name += " (copy)"; app.p.locations.push(c); }
  if (s.kind === "mk") { c.label += " (copy)"; app.p.time_markers.push(c); }
  app.sel = { kind: s.kind, id: c.id }; app.changed();
}

// ------------------------------------------------------------------ side panel
let curTab = "props";
function tab(t) { curTab = t; $$("#ptabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t)); panel(); }
function select(kind, id) { app.sel = { kind, id }; curTab = kind === "style" ? "styles" : kind === "ds" ? "ds" : "props"; $$("#ptabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === curTab)); render(); }

function panel() {
  const box = $("#panel-body"); if (!box || !app.p) return; box.innerHTML = "";
  ({ props: propsPanel, acts: actsPanel, styles: stylesPanel, locs: locsPanel, mks: mksPanel, ds: dsPanel }[curTab] || propsPanel)(box);
}
const F = (label, input, hint) => h("label", { class: "fld" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
const I = (value, on, attrs = {}) => h("input", { value: value ?? "", ...attrs, onchange: e => on(attrs.type === "checkbox" ? e.target.checked : e.target.value) });
const C = (checked, on, text) => h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!checked, onchange: e => on(e.target.checked) }), " " + text);
const S = (opts, value, on) => { const s = h("select", { onchange: e => on(e.target.value) }); opts.forEach(([v, t]) => s.append(h("option", { value: v }, t))); s.value = value ?? ""; return s; };
const edit = (obj, key, conv = x => x) => v => { app.commit(); obj[key] = conv(v); app.changed(); };
const num = v => (v === "" || v == null || isNaN(+v) ? null : +v);
const toMs = v => tms(v);

function propsPanel(box) {
  const it = findSel(), p = app.p;
  if (!it) { box.append(h("p", { class: "hint" }, "Select an activity, location marker or time marker on the chart to edit it here. Choose Draw activity (D) and drag on the grid to add one.")); summary(box); return; }
  const k = app.sel.kind;
  if (k === "act") return actProps(box, it);
  if (k === "loc") return locProps(box, it);
  if (k === "mk") return mkProps(box, it);
  if (k === "style") return styleProps(box, it);
}
function summary(box) {
  const p = app.p, lg = renderLegend(p, { size: 11, title: "Legend" });
  box.append(h("h3", {}, p.meta.title || p.name), h("p", { class: "hint" }, p.meta.subtitle || ""),
    h("div", { class: "legend-box", html: `<svg viewBox="0 0 240 ${lg.height}" width="100%" height="${lg.height}">${lg.svg}</svg>` }));
}

function actProps(box, a) {
  const p = app.p, sm = styleMap(p), st = sm[a.style] || {};
  const s = tms(a.start), f = tms(a.finish), dur = (f - s) / DAY;
  box.append(h("div", { class: "edithead" }, h("h3", {}, a.code + " · " + a.name), a.locked ? h("span", { class: "tag p6" }, "from P6") : h("span", { class: "tag" }, "manual")));
  if (a.locked) box.append(h("p", { class: "hint" }, `Dates come from P6${a.p6?.task_code ? " (" + a.p6.task_code + ")" : ""}. Change them in P6 and use Data → Sync. Chainage, style, label and footprint can be changed here and exported back to P6 as user-defined fields.`));
  const dt = v => (v || "").slice(0, 16);
  box.append(h("div", { class: "fgrid" },
    F("Activity ID", I(a.code, edit(a, "code"), { disabled: a.locked })), F("Data set", S(p.datasets.map(d => [d.id, d.name]), a.dataset, edit(a, "dataset"))),
    h("div", { class: "full" }, F("Name", I(a.name, edit(a, "name"), { id: "pp-name", disabled: a.locked }))),
    F("Style", S(p.styles.map(x => [x.code, `${x.code} – ${x.name}`]), a.style, edit(a, "style"))), F("WBS / group", I(a.wbs, edit(a, "wbs"))),
    F("Start", I(dt(a.start), edit(a, "start"), { type: "datetime-local", disabled: a.locked })), F("Finish", I(dt(a.finish), v => { if (tms(v) < s) return toast("The finish must be after the start."); edit(a, "finish")(v); }, { type: "datetime-local", disabled: a.locked })),
    F("Duration (days)", I(+dur.toFixed(2), v => { const n = num(v); if (n == null || n < 0) return; edit(a, "finish")(tstr(s + n * DAY)); }, { type: "number", step: "0.5", min: 0, disabled: a.locked })),
    h("span"),
    F(`From chainage (${p.chainage.unit})`, I(mToCh(p, a.ch0_m), v => { const m = chToM(p, v); if (m != null) edit(a, "ch0_m")(m); }, { type: "number", step: "any" })),
    F(`To chainage (${p.chainage.unit})`, I(mToCh(p, a.ch1_m), v => { const m = chToM(p, v); if (m != null) edit(a, "ch1_m")(m); }, { type: "number", step: "any" }))));
  // productivity
  const len = Math.abs(a.ch1_m - a.ch0_m);
  box.append(h("h3", {}, "Productivity"), h("div", { class: "fgrid" },
    F("Quantity", I(a.qty, edit(a, "qty", num), { type: "number", step: "any" })), F("Unit", I(a.qty_unit, edit(a, "qty_unit"), { placeholder: "m, sleepers, t…" })),
    F("Rate per working day", I(a.rate, edit(a, "rate", num), { type: "number", step: "any" })), F("Rate unit", I(a.rate_unit, edit(a, "rate_unit"), { placeholder: "m/day" }))),
    h("p", { class: "hint" }, `Shown: ${Math.round(len).toLocaleString()} m over ${dur.toFixed(1)} days = ${dur > 0 ? Math.round(len / dur).toLocaleString() : "–"} m/day. Working days per week: ${p.time.work_days_per_week}.`),
    h("div", { class: "btns" },
      h("button", { type: "button", disabled: a.locked || !a.qty || !a.rate, onclick: () => { const wd = (a.qty / a.rate) * 7 / (p.time.work_days_per_week || 7); edit(a, "finish")(tstr(s + wd * DAY)); toast(`Finish set from rate: ${wd.toFixed(1)} calendar days.`); } }, "Set finish from rate"),
      h("button", { type: "button", onclick: () => { app.commit(); a.qty = Math.round(len); a.qty_unit = "m"; a.rate = dur > 0 ? +(len / dur * 7 / (p.time.work_days_per_week || 7)).toFixed(1) : null; a.rate_unit = "m/day"; app.changed(); } }, "Rate from the line")));
  // label override
  const lab = { ...(st.label || {}), ...(a.label || {}) };
  const setLab = (k2, v) => { app.commit(); a.label = { ...(a.label || {}), [k2]: v }; app.changed(); };
  box.append(h("h3", {}, "Label"), h("div", { class: "fgrid" },
    h("div", { class: "full" }, F("Text", I(lab.text, v => setLab("text", v)), "Use {name} {code} {rate} {rate_unit} {qty} {dur} {start} {finish} {ch0} {ch1} {wbs}")),
    F("Position", S([["start", "Start"], ["mid", "Middle"], ["end", "End"]], lab.position, v => setLab("position", v))),
    F("Side", S([["above", "Above the line"], ["below", "Below the line"]], lab.side, v => setLab("side", v))),
    F("Size", I(lab.size, v => setLab("size", num(v) || 11), { type: "number", min: 6, max: 30 })), h("span"),
    C(lab.show !== false, v => setLab("show", v), "Show label"), C(lab.follow_slope !== false, v => setLab("follow_slope", v), "Follow the slope of the line")),
    a.label ? h("button", { type: "button", class: "small", onclick: () => { app.commit(); a.label = null; app.changed(); } }, "Use the style's label settings") : null);
  // footprint override
  const fp = { ...(st.footprint || {}), ...(a.footprint || {}) };
  const setFp = (k2, v) => { app.commit(); a.footprint = { ...(a.footprint || {}), [k2]: v }; app.changed(); };
  box.append(h("h3", {}, "Footprint"), h("p", { class: "hint" }, "The area the work occupies as it moves: a length behind the work front, and/or days the site stays occupied after the front passes."),
    h("div", { class: "fgrid" }, C(fp.enabled, v => setFp("enabled", v), "Show footprint"), h("span"),
      F("Length behind front (m)", I(fp.length_m, v => setFp("length_m", num(v) || 0), { type: "number", step: "any", min: 0 })),
      F("Occupied after (days)", I(fp.lag_days, v => setFp("lag_days", num(v) || 0), { type: "number", step: "any", min: 0 })),
      F("Opacity", I(fp.opacity, v => setFp("opacity", clamp(num(v) ?? 0.18, 0, 1)), { type: "number", step: "0.05", min: 0, max: 1 }))),
    a.footprint ? h("button", { type: "button", class: "small", onclick: () => { app.commit(); a.footprint = null; app.changed(); } }, "Use the style's footprint") : null);
  box.append(F("Notes", h("textarea", { rows: 3, onchange: e => edit(a, "notes")(e.target.value) }, a.notes || "")),
    h("div", { class: "btns" }, h("button", { type: "button", onclick: dupSel }, "Duplicate"), h("button", { type: "button", class: "danger", onclick: delSel }, "Delete")));
}

function locProps(box, l) {
  const p = app.p;
  box.append(h("h3", {}, "Location marker"), h("div", { class: "fgrid" },
    h("div", { class: "full" }, F("Name", I(l.name, edit(l, "name")))),
    F(`Chainage (${p.chainage.unit})`, I(mToCh(p, l.ch_m), v => { const m = chToM(p, v); if (m != null) edit(l, "ch_m")(m); }, { type: "number", step: "any" })),
    F(`To (optional)`, I(mToCh(p, l.to_m), v => edit(l, "to_m")(v === "" ? null : chToM(p, v)), { type: "number", step: "any", placeholder: "point" })),
    F("Type", S(p.location_types.map(t => [t.id, t.name]), l.type, edit(l, "type"))),
    F("Row", S([["", "Type default"], ...Array.from({ length: p.location_rows }, (_, i) => [String(i + 1), `Row ${i + 1}`])], l.row ? String(l.row) : "", v => edit(l, "row")(v ? +v : null))),
    C(l.label, edit(l, "label"), "Show label"), C(l.grid ?? (p.location_types.find(t => t.id === l.type) || {}).grid, edit(l, "grid"), "Line down the grid"),
    h("div", { class: "full" }, F("Notes", I(l.notes, edit(l, "notes"))))),
    h("div", { class: "btns" }, h("button", { type: "button", onclick: dupSel }, "Duplicate"), h("button", { type: "button", class: "danger", onclick: delSel }, "Delete")));
}

function mkProps(box, m) {
  const p = app.p;
  box.append(h("h3", {}, "Time marker"), h("div", { class: "fgrid" },
    h("div", { class: "full" }, F("Label", I(m.label, edit(m, "label")))),
    F("Kind", S([["milestone", "Milestone"], ["band", "Band (access, interface)"], ["shutdown", "Stand-down / shutdown"], ["possession", "Possession"], ["restriction", "Restriction"]], m.kind, edit(m, "kind"))),
    F("Colour", I(m.colour || "#808080", edit(m, "colour"), { type: "color" })),
    F("Start", I((m.start || "").slice(0, 16), edit(m, "start"), { type: "datetime-local" })), F("Finish", I((m.finish || "").slice(0, 16), v => edit(m, "finish")(v || null), { type: "datetime-local" })),
    F(`From chainage`, I(mToCh(p, m.ch0_m), v => edit(m, "ch0_m")(v === "" ? null : chToM(p, v)), { type: "number", step: "any", placeholder: "whole line" })),
    F(`To chainage`, I(mToCh(p, m.ch1_m), v => edit(m, "ch1_m")(v === "" ? null : chToM(p, v)), { type: "number", step: "any", placeholder: "whole line" }))),
    h("div", { class: "btns" }, h("button", { type: "button", onclick: dupSel }, "Duplicate"), h("button", { type: "button", class: "danger", onclick: delSel }, "Delete")));
}

function styleProps(box, s) {
  const p = app.p, used = p.activities.filter(a => a.style === s.code).length;
  const rename = v => { v = String(v).trim().toUpperCase().replace(/\s+/g, "_"); if (!v || p.styles.some(x => x !== s && x.code === v)) return toast("Style codes must be unique."); app.commit(); p.activities.forEach(a => { if (a.style === s.code) a.style = v; }); s.code = v; app.sel = { kind: "style", id: v }; app.changed(); };
  const setL = (k2, v) => { app.commit(); s.label[k2] = v; app.changed(); };
  const setF = (k2, v) => { app.commit(); s.footprint[k2] = v; app.changed(); };
  box.append(h("h3", {}, `Style ${s.code}`), h("p", { class: "hint" }, `Used by ${used} activit${used === 1 ? "y" : "ies"}. The code is what P6's "Activity Style" field and TurboChart's shape code hold.`),
    h("div", { class: "fgrid" }, F("Code", I(s.code, rename)), F("Legend name", I(s.name, edit(s, "name"))),
      F("Drawn as", S([["line", "Line (linear progress)"], ["bar", "Wide bar along the line"], ["block", "Block (area / static)"], ["milestone", "Milestone"]], s.kind, edit(s, "kind"))),
      F("Colour", I(s.colour, edit(s, "colour"), { type: "color" })), F("Line width", I(s.width, edit(s, "width", num), { type: "number", step: "0.5", min: 0.5 })),
      F("Line type", S([["solid", "Solid"], ["dash", "Dashed"], ["dot", "Dotted"]], s.dash, edit(s, "dash"))), F("Fill opacity", I(s.fill_opacity, edit(s, "fill_opacity", num), { type: "number", step: "0.05", min: 0, max: 1 })),
      C(s.legend !== false, edit(s, "legend"), "Show in legend")),
    h("h3", {}, "Label"), h("div", { class: "fgrid" }, h("div", { class: "full" }, F("Text", I(s.label.text, v => setL("text", v)), "{name} {code} {rate} {rate_unit} {qty} {dur} {start} {finish} {ch0} {ch1}")),
      F("Position", S([["start", "Start"], ["mid", "Middle"], ["end", "End"]], s.label.position, v => setL("position", v))), F("Side", S([["above", "Above"], ["below", "Below"]], s.label.side, v => setL("side", v))),
      F("Size", I(s.label.size, v => setL("size", num(v) || 11), { type: "number" })), h("span"),
      C(s.label.show, v => setL("show", v), "Show labels"), C(s.label.follow_slope, v => setL("follow_slope", v), "Follow slope")),
    h("h3", {}, "Footprint"), h("div", { class: "fgrid" }, C(s.footprint.enabled, v => setF("enabled", v), "Show footprint"), h("span"),
      F("Length behind front (m)", I(s.footprint.length_m, v => setF("length_m", num(v) || 0), { type: "number", step: "any" })),
      F("Occupied after (days)", I(s.footprint.lag_days, v => setF("lag_days", num(v) || 0), { type: "number", step: "any" })),
      F("Opacity", I(s.footprint.opacity, v => setF("opacity", num(v) ?? .18), { type: "number", step: "0.05" }))),
    h("div", { class: "btns" }, h("button", { type: "button", class: "danger", onclick: delSel }, "Delete style")));
}

// Lists can delete: pass the kind ("act" | "loc" | "mk") to get a tick box and a × on each row, plus "Delete selected".
const picks = { act: new Set(), loc: new Set(), mk: new Set() };
const KEY = { act: "activities", loc: "locations", mk: "time_markers" };
function deleteItems(kind, ids) {
  const set = new Set(ids); if (!set.size) return;
  app.commit();
  app.p[KEY[kind]] = app.p[KEY[kind]].filter(x => !set.has(x.id));
  if (app.sel?.kind === kind && set.has(app.sel.id)) app.sel = null;
  ids.forEach(i => picks[kind].delete(i));
  app.changed(); toast(`Deleted ${set.size} ${set.size === 1 ? "item" : "items"}. Undo (Ctrl+Z) brings ${set.size === 1 ? "it" : "them"} back.`);
}
function listTable(box, head, rows, onClick, kind) {
  if (!kind) {
    box.append(h("div", { class: "list" }, h("table", { class: "grid-tbl" }, h("thead", {}, h("tr", {}, head.map(x => h("th", {}, x)))),
      h("tbody", {}, rows.map(r => h("tr", { class: r.on ? "on" : "", onclick: () => onClick(r) }, r.cells.map((c, i) => h("td", { class: r.num?.includes(i) ? "n" : "" }, c))))))));
    return;
  }
  const pk = picks[kind], shown = rows.map(r => r.id);
  [...pk].forEach(i => { if (!app.p[KEY[kind]].some(x => x.id === i)) pk.delete(i); });
  const nSel = shown.filter(i => pk.has(i)).length;
  const all = h("input", { type: "checkbox", "aria-label": "Select all rows shown", checked: nSel > 0 && nSel === shown.length,
    onclick: e => { e.stopPropagation(); shown.forEach(i => (e.target.checked ? pk.add(i) : pk.delete(i))); panel(); } });
  if (nSel > 0 && nSel < shown.length) all.indeterminate = true;
  box.append(h("div", { class: "btns listbar" },
    h("span", { class: "hint" }, nSel ? `${nSel} selected` : `${rows.length} shown`),
    h("button", { type: "button", class: "danger small", disabled: !nSel, onclick: () => deleteItems(kind, shown.filter(i => pk.has(i))) }, `Delete selected${nSel ? ` (${nSel})` : ""}`),
    nSel ? h("button", { type: "button", class: "small", onclick: () => { shown.forEach(i => pk.delete(i)); panel(); } }, "Clear selection") : null));
  box.append(h("div", { class: "list" }, h("table", { class: "grid-tbl" },
    h("thead", {}, h("tr", {}, h("th", {}, all), head.map(x => h("th", {}, x)), h("th", {}))),
    h("tbody", {}, rows.map(r => h("tr", { class: (r.on ? "on " : "") + (pk.has(r.id) ? "picked" : ""), onclick: () => onClick(r) },
      h("td", {}, h("input", { type: "checkbox", "aria-label": "Select row", checked: pk.has(r.id), onclick: e => { e.stopPropagation(); e.target.checked ? pk.add(r.id) : pk.delete(r.id); panel(); } })),
      r.cells.map((c, i) => h("td", { class: r.num?.includes(i) ? "n" : "" }, c)),
      h("td", {}, h("button", { type: "button", class: "rowdel", title: "Delete", "aria-label": "Delete this row", onclick: e => { e.stopPropagation(); deleteItems(kind, [r.id]); } }, "×"))))))));
}
function actsPanel(box) {
  const p = app.p, q = h("input", { placeholder: "Filter by ID, name or style", value: actsPanel.q || "", oninput: e => { actsPanel.q = e.target.value; panel(); setTimeout(() => { const i = $("#panel-body input"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); } });
  box.append(h("div", { class: "btns" }, q, h("button", { type: "button", onclick: insertAct }, "Add")));
  const f = (actsPanel.q || "").toLowerCase();
  const rows = p.activities.filter(a => a.dataset === p.view.main_dataset && (!f || `${a.code} ${a.name} ${a.style}`.toLowerCase().includes(f))).sort((a, b) => a.start.localeCompare(b.start));
  const sm = styleMap(p);
  listTable(box, ["", "ID", "Activity", "Start", "Finish", "Days"], rows.map(a => ({ id: a.id, on: app.sel?.id === a.id, num: [3, 4, 5],
    cells: [h("i", { class: "sw", style: `background:${sm[a.style]?.colour || "#999"}` }), a.code, a.name, niceDate(tms(a.start)), niceFinish(tms(a.finish)), ((tms(a.finish) - tms(a.start)) / DAY).toFixed(0)] })),
    r => { select("act", r.id); scrollToAct(r.id); }, "act");
}
function scrollToAct(id) { const a = app.p.activities.find(x => x.id === id); if (!a || !G) return; const box = $("#chart-scroll"); box.scrollTop = Math.max(0, Math.min(G.Y(tms(a.start)), G.Y(tms(a.finish))) - box.clientHeight / 3); }
function stylesPanel(box) {
  const p = app.p;
  box.append(h("div", { class: "btns" }, h("button", { type: "button", onclick: insertStyle }, "Add style")));
  listTable(box, ["", "Code", "Name", "Drawn as", "Used"], p.styles.map(s => ({ id: s.code, on: app.sel?.kind === "style" && app.sel.id === s.code, num: [4],
    cells: [h("i", { class: "sw", style: `background:${s.colour}` }), s.code, s.name, s.kind, p.activities.filter(a => a.style === s.code).length] })), r => select("style", r.id));
  if (app.sel?.kind === "style" && findSel()) styleProps(box, findSel());
}
function locsPanel(box) {
  const p = app.p;
  box.append(h("div", { class: "btns" }, h("button", { type: "button", onclick: insertLoc }, "Add location"), h("button", { type: "button", onclick: () => D.projectSetup(app, "edit") }, "Edit sections")));
  // filter by type and text, so a whole type (e.g. all occupation crossings) can be selected and deleted at once
  const usedTypes = [...new Set(p.locations.map(l => l.type))];
  box.append(h("div", { class: "btns" },
    S([["", "All types"], ...usedTypes.map(t => [t, (p.location_types.find(x => x.id === t) || {}).name || t])], locsPanel.type || "", v => { locsPanel.type = v; panel(); }),
    h("input", { placeholder: "Filter by name", value: locsPanel.q || "", oninput: e => { locsPanel.q = e.target.value; panel(); setTimeout(() => { const i = $("#loc-q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, id: "loc-q" })));
  const lq = (locsPanel.q || "").toLowerCase();
  const locs = p.locations.filter(l => (!locsPanel.type || l.type === locsPanel.type) && (!lq || (l.name || "").toLowerCase().includes(lq))).sort((a, b) => a.ch_m - b.ch_m);
  listTable(box, ["Chainage", "Name", "Type"], locs.map(l => ({ id: l.id, on: app.sel?.id === l.id, num: [0],
    cells: [chFmt(p, l.ch_m), l.name, (p.location_types.find(t => t.id === l.type) || {}).name || l.type] })), r => select("loc", r.id), "loc");
  box.append(h("h3", {}, "Location types"), h("p", { class: "hint" }, "Symbol, colour and default row for each type of location marker."));
  p.location_types.forEach(t => box.append(h("div", { class: "typerow" },
    I(t.name, edit(t, "name")), S(["circle", "tick", "box", "trapezoid", "diamond", "bar", "triangle", "band"].map(x => [x, x]), t.symbol, edit(t, "symbol")),
    I(t.colour, edit(t, "colour"), { type: "color" }), S(Array.from({ length: p.location_rows }, (_, i) => [String(i + 1), `Row ${i + 1}`]), String(t.row || 1), v => edit(t, "row")(+v)),
    C(t.grid, edit(t, "grid"), "grid"))));
  box.append(h("div", { class: "btns" }, h("button", { type: "button", onclick: () => { app.commit(); p.location_types.push({ id: uid("lt"), name: "New type", symbol: "diamond", colour: "#5D6B70", row: p.location_rows, grid: false }); app.changed(); } }, "Add type"),
    F("Header rows", I(p.location_rows, edit(p, "location_rows", v => clamp(+v || 1, 1, 8)), { type: "number", min: 1, max: 8 }))));
}
function mksPanel(box) {
  const p = app.p;
  box.append(h("div", { class: "btns" }, h("button", { type: "button", onclick: insertMk }, "Add time marker")));
  listTable(box, ["Start", "Marker", "Kind"], p.time_markers.slice().sort((a, b) => a.start.localeCompare(b.start)).map(m => ({ id: m.id, on: app.sel?.id === m.id, num: [0],
    cells: [niceDate(tms(m.start)), m.label, m.kind] })), r => select("mk", r.id), "mk");
}
function dsPanel(box) {
  const p = app.p;
  box.append(h("p", { class: "hint" }, "A data set is one version of the programme: an option, a P6 import or a baseline. Show one as the main chart and another greyed behind it to compare."));
  p.datasets.forEach(d => {
    const n = p.activities.filter(a => a.dataset === d.id).length;
    box.append(h("div", { class: "dscard" + (d.id === p.view.main_dataset ? " on" : "") },
      F("Name", I(d.name, edit(d, "name"))),
      h("p", { class: "hint" }, `${n} activities · source: ${d.source || "manual"}${d.last_sync ? " · synced " + d.last_sync.replace("T", " ") : ""}`),
      h("div", { class: "btns" },
        h("button", { type: "button", disabled: d.id === p.view.main_dataset, onclick: () => { p.view.main_dataset = d.id; if (p.view.compare_dataset === d.id) p.view.compare_dataset = null; app.changed(); } }, "Show as main"),
        h("button", { type: "button", disabled: d.id === p.view.main_dataset, onclick: () => { p.view.compare_dataset = p.view.compare_dataset === d.id ? null : d.id; app.changed(); } }, p.view.compare_dataset === d.id ? "Stop comparing" : "Compare behind"),
        h("button", { type: "button", onclick: () => exportFile("xer", `?dataset=${d.id}`) }, "Export XER"),
        d.mapping ? h("button", { type: "button", onclick: () => D.p6Dialog(app, "sync") }, "Sync from P6") : null,
        h("button", { type: "button", onclick: () => { app.commit(); const nd = { id: uid("ds_"), name: d.name + " (copy)", source: "copy" }; p.datasets.push(nd);
          p.activities.filter(a => a.dataset === d.id).forEach(a => p.activities.push({ ...JSON.parse(JSON.stringify(a)), id: uid("a_"), dataset: nd.id, locked: false })); app.changed(); toast("Data set copied. Edit the copy freely as a what-if option."); } }, "Copy as option"),
        h("button", { type: "button", class: "danger", disabled: p.datasets.length < 2, onclick: async () => {
          if (!(await D.confirmBox("Delete data set", `Delete "${d.name}" and its ${n} activities?`, "Delete"))) return;
          app.commit(); p.activities = p.activities.filter(a => a.dataset !== d.id); p.datasets = p.datasets.filter(x => x !== d);
          if (p.view.main_dataset === d.id) p.view.main_dataset = p.datasets[0].id; if (p.view.compare_dataset === d.id) p.view.compare_dataset = null; app.changed(); } }, "Delete"))));
  });
  box.append(h("button", { type: "button", onclick: () => { app.commit(); p.datasets.push({ id: uid("ds_"), name: "New option", source: "manual" }); app.changed(); } }, "Add empty data set"));
}

function exportChartSvg() {
  const r = renderChart(app.p, { width: Math.max(1400, $("#chart-scroll").clientWidth) });
  download(`${app.p.name.replace(/[^A-Za-z0-9]+/g, "_")}_chart.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.G.W} ${r.G.H}" width="${r.G.W}" height="${r.G.H}">${r.svg}</svg>`, "image/svg+xml");
}

// ------------------------------------------------------------------ wiring
function wire() {
  buildMenus();
  $$("#tools button[data-mode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("#b-undo").onclick = undo; $("#b-redo").onclick = redo;
  $("#b-zin").onclick = () => zoomT(1.25); $("#b-zout").onclick = () => zoomT(0.8); $("#b-fit").onclick = fitTime;
  $("#ppd").onchange = e => { const v = parseFloat(e.target.value); if (v > 0) { app.p.time.px_per_day = v; app.changed(); } };
  $("#ds-main").onchange = e => { app.p.view.main_dataset = e.target.value; if (app.p.view.compare_dataset === e.target.value) app.p.view.compare_dataset = null; app.changed(); };
  $("#ds-cmp").onchange = e => { app.p.view.compare_dataset = e.target.value || null; app.changed(); };
  $$("#ptabs button").forEach(b => b.addEventListener("click", () => tab(b.dataset.tab)));
  $$("#viewtabs button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
  $("#e-new").onclick = () => D.projectSetup(app, "new"); $("#e-open").onclick = () => D.openProject(app);
  $("#e-excel").onclick = () => D.importExcel(app); $("#e-p6").onclick = () => D.p6Dialog(app, "import"); $("#e-tc").onclick = () => D.importTchart(app);
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => app.p && (app.view === "page" ? pv.draw() : drawChart()), 150); });
}

(async function start() {
  wire();
  try { app.presets = await api.presets(); } catch (e) { toast("The server is not answering. Start it with run.bat."); }
  let last = null; try { last = localStorage.getItem("tcs-last"); } catch (e) { /* storage blocked */ }
  if (last) { try { app.open(await api.get(last)); return; } catch (e) { /* project gone */ } }
  render();
})();
