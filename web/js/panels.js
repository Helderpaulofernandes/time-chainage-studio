// Dialogs for the chart layout features: axes and dates, broken chainage, equations, side columns, lines / tracks,
// crews and links; bands; resources; progress lines; rate sheets; Microsoft Project import.
import { h, $, uid, tms, tstr, dstr, chToM, mToCh, chFmt, chName, niceDate, DAY, field } from "./util.js";
import { modal } from "./dialogs.js";
import { BAND_KINDS, PALETTE, rowsOf, weekStart } from "./extras.js";
import { makeActivity, makeStyle, newId } from "./core/model.js";
import * as XER from "./core/xer.js";
import * as MSP from "./core/mspdi.js";

const sel = (opts, v, on) => { const s = h("select", { onchange: e => on && on(e.target.value) }); opts.forEach(([k, t]) => s.append(h("option", { value: k }, t))); s.value = v ?? ""; return s; };
const chk = (v, on, text) => h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!v, onchange: e => on(e.target.checked) }), " " + text);
const clone = o => JSON.parse(JSON.stringify(o ?? null));

// A small editable table. cols: [{ key, label, type: text|num|ch|select|check|color|date, opts, width }]
function rowsTable(p, list, cols, makeRow, addLabel) {
  const box = h("div");
  const draw = () => {
    box.innerHTML = "";
    const tb = h("tbody");
    list.forEach((r, i) => tb.append(h("tr", {}, ...cols.map(c => h("td", {}, cell(p, r, c))),
      h("td", {}, h("button", { type: "button", class: "danger small", onclick: () => { list.splice(i, 1); draw(); } }, "Remove")))));
    box.append(h("table", { class: "grid-tbl" }, h("thead", {}, h("tr", {}, ...cols.map(c => h("th", {}, c.label)), h("th"))), tb),
      h("button", { type: "button", class: "small", onclick: () => { list.push(makeRow()); draw(); } }, addLabel));
  };
  draw();
  return box;
}
function cell(p, r, c) {
  const on = v => (r[c.key] = v);
  if (c.type === "select") return sel(c.opts, r[c.key], on);
  if (c.type === "check") return h("input", { type: "checkbox", checked: r[c.key] !== false, onchange: e => on(e.target.checked) });
  if (c.type === "color") return h("input", { type: "color", value: r[c.key] || "#C00000", oninput: e => on(e.target.value) });
  if (c.type === "ch" || c.type === "chraw") { const raw = c.type === "chraw"; return h("input", { value: mToCh(p, r[c.key], raw), style: "width:8em", onchange: e => on(chToM(p, e.target.value, raw)) }); }
  if (c.type === "num") return h("input", { type: "number", step: "any", value: r[c.key] ?? "", style: "width:6em", onchange: e => on(e.target.value === "" ? null : +e.target.value) });
  if (c.type === "date") return h("input", { type: "date", value: (r[c.key] || "").slice(0, 10), onchange: e => on(e.target.value) });
  return h("input", { value: r[c.key] ?? "", style: c.width ? `width:${c.width}` : "", onchange: e => on(e.target.value) });
}
function fileText(input) { const f = input.files[0]; return f ? f.text() : Promise.resolve(""); }

// ------------------------------------------------------------------ chart layout and axes
export function chartLayout(app) {
  const p = app.p, c = p.chainage, t = p.time, v = p.view;
  const w = { axis: c.axis || "both", repeat: c.repeat_days || 0, mon: t.month_side || "left", per: t.period_labels || "weeks", perSide: t.period_side || "right",
    origin: (t.period_origin || t.start || "").slice(0, 10), breaks: clone(c.breaks || []), eqs: clone(c.equations || []), cols: clone(p.side_cols || []),
    tracks: clone(p.tracks || []), crews: !!v.show_crews, crewBy: v.crew_by || "crew", route: v.link_route || "straight", lfilter: v.link_filter || "all" };
  const ch = chName(p);
  modal({
    title: "Chart layout and axes", wide: true,
    body: el => {
      const set = k => val => (w[k] = val);
      el.append(
        h("div", { class: "cols" },
          h("fieldset", {}, h("legend", {}, "Axes and dates"),
            h("div", { class: "row2" }, field(`${ch[0].toUpperCase() + ch.slice(1)} scale`, sel([["both", "Top and bottom"], ["top", "Top only"], ["bottom", "Bottom only"], ["none", "None"]], w.axis, set("axis"))),
              field("Repeat the scale every (days)", h("input", { type: "number", min: 0, step: 1, value: w.repeat, onchange: e => (w.repeat = +e.target.value || 0) }), "0 = off. Handy on long charts.")),
            h("div", { class: "row2" }, field("Month column", sel([["left", "Left"], ["right", "Right"], ["both", "Both sides"]], w.mon, set("mon"))),
              field("Period column", sel([["weeks", "Week numbers"], ["months", "Months since the start (M1, M2…)"], ["years", "Project years (Y1, Y2…)"], ["none", "None"]], w.per, set("per")))),
            h("div", { class: "row2" }, field("Period column side", sel([["right", "Right"], ["left", "Left"]], w.perSide, set("perSide"))),
              field("Count months / years from", h("input", { type: "date", value: w.origin, onchange: e => (w.origin = e.target.value) }), "For example the date of award or NTP."))),
          h("fieldset", {}, h("legend", {}, "Crews and logic links"),
            chk(w.crews, set("crews"), "Join each crew's activities into a stepped line (work, move, work)"),
            field("A crew is", sel([["crew", "The activity's Crew field"], ["wbs", "The WBS / group"], ["style", "The style"]], w.crewBy, set("crewBy"))),
            h("div", { class: "row2" }, field("Link lines", sel([["straight", "Straight"], ["elbow", "Square corners"]], w.route, set("route"))),
              field("Show links", sel([["all", "All"], ["driving", "Driving / critical path only"], ["cross", "Only between different styles"]], w.lfilter, set("lfilter")))),
            h("small", { class: "hint" }, "Turn links on with View → Logic links."))),
        h("fieldset", {}, h("legend", {}, "Broken chainage"),
          h("p", { class: "hint" }, `Stretches with no work are squeezed to a narrow gap with a break symbol, so separate sites share one sheet. Enter each gap as ${ch} from and to.`),
          rowsTable(p, w.breaks, [{ key: "from_m", label: "From", type: "ch" }, { key: "to_m", label: "To", type: "ch" }], () => ({ from_m: c.start_m, to_m: c.start_m }), "Add a break")),
        h("fieldset", {}, h("legend", {}, "Chainage equations"),
          h("p", { class: "hint" }, `Where the kilometrage jumps (a realignment). Positions stay a running distance; from "At" onwards the ${ch} shown restarts at "Shown as".`),
          rowsTable(p, w.eqs, [{ key: "at_m", label: "At (running)", type: "chraw" }, { key: "value_m", label: "Shown as", type: "chraw" }], () => ({ at_m: c.start_m, value_m: c.start_m }), "Add an equation")),
        h("fieldset", {}, h("legend", {}, "Side columns for work with no chainage"),
          h("p", { class: "hint" }, "Columns beside the chart for design, approvals, procurement or site-wide work, on the same dates. Put an activity in a column from its panel."),
          rowsTable(p, w.cols, [{ key: "name", label: "Name" }, { key: "side", label: "Side", type: "select", opts: [["left", "Left"], ["right", "Right"]] }, { key: "width", label: "Width (px)", type: "num" }, { key: "show", label: "Show", type: "check" }],
            () => ({ id: uid("col_"), name: "Design", side: "left", width: 90, show: true }), "Add a column")),
        h("fieldset", {}, h("legend", {}, "Lines / tracks"),
          h("p", { class: "hint" }, "On multi-track jobs give each activity a line (Up, Down, Main, Loop). Here you can hide a line, or offset it a few pixels so parallel work on two tracks does not overlap."),
          h("div", { id: "cl-tracks" }),
          h("button", { type: "button", class: "small", onclick: () => { const names = [...new Set(p.activities.map(a => a.track).filter(Boolean))]; names.forEach(n => { if (!w.tracks.some(x => x.name === n)) w.tracks.push({ name: n, offset_px: 0, show: true }); }); drawTracks(); } }, "Add the lines used by activities")));
      const drawTracks = () => { const b = $("#cl-tracks", el); b.innerHTML = ""; b.append(rowsTable(p, w.tracks, [{ key: "name", label: "Line" }, { key: "offset_px", label: "Offset (px)", type: "num" }, { key: "show", label: "Show", type: "check" }], () => ({ name: "Up", offset_px: 0, show: true }), "Add a line")); };
      drawTracks();
    },
    buttons: [{ label: "Cancel" }, { label: "Apply", primary: true, onClick: ({ close }) => {
      app.commit();
      Object.assign(c, { axis: w.axis, repeat_days: w.repeat, breaks: w.breaks.filter(b => b.from_m != null && b.to_m != null && b.from_m !== b.to_m), equations: w.eqs.filter(e => e.at_m != null && e.value_m != null) });
      Object.assign(t, { month_side: w.mon, period_labels: w.per, period_side: w.perSide, period_origin: w.origin || null });
      p.side_cols = w.cols.filter(s => s.name); p.tracks = w.tracks.filter(x => x.name);
      Object.assign(v, { show_crews: w.crews, crew_by: w.crewBy, link_route: w.route, link_filter: w.lfilter });
      close(); app.changed();
    } }],
  });
}

// ------------------------------------------------------------------ bands
export function bandsDialog(app) {
  const p = app.p, list = clone(p.bands || []);
  modal({
    title: "Bands above and below the chart", wide: true,
    body: el => {
      const box = h("div");
      el.append(h("p", { class: "hint" }, `Bands run along the ${chName(p)} like the chart: a long section, quantities by section, package extents, a schematic plan or a coloured strip. Paste the data from Excel (copy the cells) or type it; ${chName(p)} values are in the project unit or as stations.`), box,
        h("div", { class: "btns" }, ...Object.entries(BAND_KINDS).map(([k, d]) => h("button", { type: "button", class: "small", onclick: () => { list.push({ id: uid("band_"), kind: k, name: d.name.split(" (")[0], position: k === "profile" || k === "plan" ? "above" : "below", show: true, data: "" }); draw(); } }, "Add " + d.name.split(" (")[0].toLowerCase()))));
      const draw = () => {
        box.innerHTML = "";
        if (!list.length) box.append(h("p", { class: "hint" }, "No bands yet."));
        list.forEach((b, i) => {
          const d = BAND_KINDS[b.kind] || {}, ta = h("textarea", { rows: 5, style: "width:100%;font-family:var(--mono,monospace)", oninput: e => (b.data = e.target.value) }, b.data || "");
          const extra = [];
          if (b.kind === "plan") extra.push(h("div", { class: "chips" }, ...p.location_types.map(t => chk(!b.types || b.types.includes(t.id), on => { const all = b.types || p.location_types.map(x => x.id); b.types = on ? [...new Set([...all, t.id])] : all.filter(x => x !== t.id); }, t.name))));
          if (b.kind === "quantities") extra.push(chk(b.table !== false, on => (b.table = on), "Show the numbers under the bars"));
          if (b.kind === "profile") extra.push(h("div", { class: "row2" }, field("Cut colour", h("input", { type: "color", value: b.cut_colour || "#E07B39", oninput: e => (b.cut_colour = e.target.value) })), field("Fill colour", h("input", { type: "color", value: b.fill_colour || "#1F4E79", oninput: e => (b.fill_colour = e.target.value) }))));
          box.append(h("fieldset", {}, h("legend", {}, d.name || b.kind),
            h("div", { class: "row4" }, field("Name", h("input", { value: b.name || "", onchange: e => (b.name = e.target.value) })),
              field("Where", sel([["above", "Above the chart"], ["below", "Below the chart"]], b.position, val => (b.position = val))),
              field("Height (px)", h("input", { type: "number", min: 16, value: b.height || d.h, onchange: e => (b.height = +e.target.value || null) })),
              h("div", { class: "btns", style: "align-self:end" }, chk(b.show !== false, on => (b.show = on), "Show"),
                h("button", { type: "button", class: "small", disabled: i === 0, onclick: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); draw(); } }, "↑"),
                h("button", { type: "button", class: "small", disabled: i === list.length - 1, onclick: () => { list.splice(i + 1, 0, list.splice(i, 1)[0]); draw(); } }, "↓"),
                h("button", { type: "button", class: "danger small", onclick: () => { list.splice(i, 1); draw(); } }, "Remove"))),
            b.kind === "plan" ? null : h("div", {}, h("small", { class: "hint" }, d.help), ta,
              h("label", { class: "small" }, "or load a CSV file ", h("input", { type: "file", accept: ".csv,.txt,.tsv", onchange: async e => { b.data = await fileText(e.target); ta.value = b.data; } }))),
            ...extra));
        });
      };
      draw();
    },
    buttons: [{ label: "Cancel" }, { label: "Apply", primary: true, onClick: ({ close }) => { app.commit(); p.bands = list; close(); app.changed(); } }],
  });
}

// ------------------------------------------------------------------ resources
// Weekly quantities per series. From P6 resource assignments (spread evenly over each assignment's dates) or pasted.
export function resourcesDialog(app) {
  const p = app.p, rs = clone(p.resources || { series: [], panel: {} });
  rs.series ||= []; rs.panel ||= {};
  modal({
    title: "Resource histogram", wide: true,
    body: el => {
      const list = h("div");
      const draw = () => { list.innerHTML = ""; list.append(rowsTable(p, rs.series, [{ key: "name", label: "Series" }, { key: "unit", label: "Unit", width: "5em" }, { key: "colour", label: "Colour", type: "color" }, { key: "show", label: "Show", type: "check" }],
        () => ({ id: uid("rs_"), name: "Series", unit: "h", colour: PALETTE[rs.series.length % PALETTE.length], values: {}, show: true }), "Add an empty series"),
        h("p", { class: "hint" }, rs.series.length ? `${rs.series.map(s => `${s.name}: ${Object.keys(s.values || {}).length} dates`).join(" · ")}` : "No data yet.")); };
      el.append(
        h("fieldset", {}, h("legend", {}, "Panel"),
          h("div", { class: "row4" }, chk(rs.panel.show, on => (rs.panel.show = on), "Show beside the chart"), field("Heading", h("input", { value: rs.panel.title || "Resources", onchange: e => (rs.panel.title = e.target.value) })),
            field("Bar width (px)", h("input", { type: "number", min: 60, value: rs.panel.width || 150, onchange: e => (rs.panel.width = +e.target.value || 150) })),
            chk(rs.panel.table, on => (rs.panel.table = on), "Weekly and running totals"))),
        h("fieldset", {}, h("legend", {}, "Series"), list),
        h("div", { class: "cols" },
          h("fieldset", {}, h("legend", {}, "Read from P6 (XER)"),
            h("p", { class: "hint" }, "Uses the resource assignments (budgeted units) of the activities in the main data set, matched by Activity ID, spread evenly over each assignment's dates."),
            field("XER file", h("input", { type: "file", id: "rs-xer", accept: ".xer" })),
            field("One series per", Object.assign(sel([["type", "Resource type (labour, plant, material)"], ["resource", "Resource"]], "type", null), { id: "rs-by" })),
            h("button", { type: "button", id: "rs-go-xer" }, "Read the assignments")),
          h("fieldset", {}, h("legend", {}, "Paste from Excel"),
            h("p", { class: "hint" }, "First row: Week, then one heading per series (Labour h, Plant, Water kL). Then one row per week: the week's date and the numbers."),
            h("textarea", { id: "rs-paste", rows: 6, style: "width:100%" }),
            h("button", { type: "button", id: "rs-go-paste" }, "Add the pasted series"))));
      draw();
      $("#rs-go-paste", el).onclick = () => {
        const rows = rowsOf($("#rs-paste", el).value); if (rows.length < 2) return app.toast("Paste a heading row and at least one week.");
        const head = rows[0];
        head.slice(1).forEach((name, i) => {
          const s = { id: uid("rs_"), name: name || `Series ${i + 1}`, unit: "", colour: PALETTE[(rs.series.length) % PALETTE.length], values: {}, show: true };
          for (const r of rows.slice(1)) { const d = readDate(r[0]); const n = +String(r[i + 1] || "").replace(/,/g, ""); if (d && !isNaN(n)) s.values[d] = (s.values[d] || 0) + n; }
          rs.series.push(s);
        });
        rs.panel.show = true; draw(); app.toast("Series added. Apply to show them.");
      };
      $("#rs-go-xer", el).onclick = async () => {
        const f = $("#rs-xer", el).files[0]; if (!f) return app.toast("Choose an XER file first.");
        const x = XER.parse(new Uint8Array(await f.arrayBuffer())), by = $("#rs-by", el).value;
        const series = resourcesFromXer(p, x, by); if (!series.length) return app.toast("No resource assignments matched the activities in the main data set.");
        rs.series = rs.series.filter(s => !s.from_xer).concat(series); rs.panel.show = true; draw(); app.toast(`${series.length} series read. Apply to show them.`);
      };
    },
    buttons: [{ label: "Cancel" }, { label: "Apply", primary: true, onClick: ({ close }) => { app.commit(); p.resources = rs; close(); app.changed(); } }],
  });
}
function readDate(v) {
  v = String(v || "").trim(); if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (/^\d{5}(\.\d+)?$/.test(v)) return dstr(Date.UTC(1899, 11, 30) + +v * DAY); // Excel day number
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return dstr(Date.UTC(y, +m[2] - 1, +m[1])); }
  const d = Date.parse(v); return isNaN(d) ? null : dstr(d - new Date(d).getTimezoneOffset() * 6e4);
}
export function resourcesFromXer(p, x, by = "type") {
  const rows = n => (x.tables[n] || {}).rows || [];
  const acts = new Map(p.activities.filter(a => a.dataset === p.view.main_dataset).map(a => [a.p6?.task_id || "", a]).filter(([k]) => k));
  const byCode = new Map(p.activities.filter(a => a.dataset === p.view.main_dataset).map(a => [a.code, a]));
  const task = new Map(rows("TASK").map(t => [t.task_id, t]));
  const rsrc = new Map(rows("RSRC").map(r => [r.rsrc_id, r]));
  const TYPE = { RT_Labor: "Labour", RT_Equip: "Plant", RT_Mat: "Material" };
  const out = new Map();
  for (const ra of rows("TASKRSRC")) {
    const tk = task.get(ra.task_id); const a = acts.get(ra.task_id) || (tk && byCode.get(tk.task_code)); if (!a) continue;
    const r = rsrc.get(ra.rsrc_id) || {}, key = by === "resource" ? (r.rsrc_name || r.rsrc_short_name || ra.rsrc_id) : TYPE[r.rsrc_type] || "Other";
    const qty = parseFloat(ra.target_qty) || parseFloat(ra.remain_qty) || 0; if (!qty) continue;
    const s0 = tms(String(ra.target_start_date || "").replace(" ", "T").slice(0, 16)) || tms(a.start), f0 = tms(String(ra.target_end_date || "").replace(" ", "T").slice(0, 16)) || tms(a.finish);
    const s = isNaN(s0) ? tms(a.start) : s0, f = isNaN(f0) ? tms(a.finish) : f0, days = Math.max(1, Math.round((f - s) / DAY));
    if (!out.has(key)) out.set(key, { id: uid("rs_"), name: key, unit: by === "type" && key === "Labour" ? "h" : "", colour: PALETTE[out.size % PALETTE.length], values: {}, show: true, from_xer: true });
    const sv = out.get(key).values;
    for (let i = 0; i < days; i++) { const d = dstr(weekStart(p, s + i * DAY)); sv[d] = Math.round(((sv[d] || 0) + qty / days) * 100) / 100; }
  }
  return [...out.values()];
}

// ------------------------------------------------------------------ progress lines (as built / forecast fronts)
export function progressDialog(app) {
  const p = app.p, list = clone(p.progress_lines || []);
  modal({
    title: "Progress lines", wide: true,
    body: el => {
      const box = h("div");
      el.append(h("p", { class: "hint" }, `Draw where a front actually was (or is forecast to be) by date: one row per reading, date then ${chName(p)}. Stepped lines hold the ${chName(p)} until the next reading, as daily progress does.`), box,
        h("button", { type: "button", class: "small", onclick: () => { list.push({ id: uid("pl_"), name: "As built", colour: "#C00000", stepped: true, show: true, points: [] }); draw(); } }, "Add a progress line"));
      const draw = () => {
        box.innerHTML = "";
        list.forEach((pl, i) => {
          const ta = h("textarea", { rows: 5, style: "width:100%", onchange: e => (pl.points = rowsOf(e.target.value).map(r => [readDate(r[0]), chToM(p, r[1])]).filter(r => r[0] && r[1] != null).map(([d, m]) => [d + "T00:00", m])) },
            (pl.points || []).map(([d, m]) => `${d.slice(0, 10)}, ${mToCh(p, m)}`).join("\n"));
          box.append(h("fieldset", {}, h("legend", {}, pl.name || "Progress line"),
            h("div", { class: "row4" }, field("Name", h("input", { value: pl.name, onchange: e => (pl.name = e.target.value) })), field("Colour", h("input", { type: "color", value: pl.colour || "#C00000", oninput: e => (pl.colour = e.target.value) })),
              chk(pl.stepped !== false, on => (pl.stepped = on), "Stepped"), h("div", { class: "btns" }, chk(pl.show !== false, on => (pl.show = on), "Show"), h("button", { type: "button", class: "danger small", onclick: () => { list.splice(i, 1); draw(); } }, "Remove"))),
            ta, h("label", { class: "small" }, "or load a CSV file ", h("input", { type: "file", accept: ".csv,.txt", onchange: async e => { ta.value = await fileText(e.target); ta.dispatchEvent(new Event("change")); } }))));
        });
      };
      draw();
    },
    buttons: [{ label: "Cancel" }, { label: "Apply", primary: true, onClick: ({ close }) => { app.commit(); p.progress_lines = list; close(); app.changed(); } }],
  });
}

// ------------------------------------------------------------------ rate sheet to a sketch data set
// Works out each finish from length / rate, the same sum as "Set finish from rate". For comparison only: nothing is
// written back to P6 and no logic is added.
export function rateSheetDialog(app) {
  const p = app.p;
  modal({
    title: "Rate sheet to a sketch data set", wide: true,
    body: el => el.append(
      h("p", { class: "hint" }, `Paste a rate sheet from Excel. Columns (first row = headings, any order): Name, Style, From, To, Start, Rate (${p.chainage.unit === "ft" || p.chainage.unit === "mi" ? "ft" : "m"} per working day), and optionally Days per week, Crew, Line. Each row becomes an activity in a new data set, with its finish worked out from the rate. It is a sketch to compare against the programme, not programme logic.`),
      h("textarea", { id: "rt-paste", rows: 10, style: "width:100%" }),
      field("Data set name", h("input", { id: "rt-name", value: "Rate sketch" }))),
    buttons: [{ label: "Cancel" }, { label: "Make the data set", primary: true, onClick: ({ close, setMsg, dlg }) => {
      const rows = rowsOf($("#rt-paste", dlg).value); if (rows.length < 2) return setMsg("Paste a heading row and at least one row of rates.", "err");
      const H = rows[0].map(x => x.toLowerCase()), col = (...k) => H.findIndex(x => k.some(kk => x.startsWith(kk)));
      const ci = { name: col("name", "activity", "description"), style: col("style", "code", "type"), from: col("from", "start ch", "ch from"), to: col("to", "end ch", "ch to"), start: col("start date", "start"), rate: col("rate", "m/day", "ft/day", "productivity"), dpw: col("days", "work days"), crew: col("crew"), track: col("line", "track") };
      if (ci.from < 0 || ci.to < 0 || ci.start < 0 || ci.rate < 0) return setMsg("The headings need at least From, To, Start and Rate.", "err");
      const ds = { id: newId("ds_"), name: $("#rt-name", dlg).value || "Rate sketch", source: "rate-sheet" };
      const lenU = p.chainage.unit === "ft" || p.chainage.unit === "mi" ? 0.3048 : 1, acts = [];
      rows.slice(1).forEach((r, i) => {
        const c0 = chToM(p, r[ci.from]), c1 = chToM(p, r[ci.to]), d = readDate(r[ci.start]), rate = +String(r[ci.rate] || "").replace(/,/g, "");
        if (c0 == null || c1 == null || !d || !(rate > 0)) return;
        const dpw = ci.dpw >= 0 ? +r[ci.dpw] || p.time.work_days_per_week || 7 : p.time.work_days_per_week || 7;
        const work = Math.abs(c1 - c0) / lenU / rate, cal = work * 7 / dpw, s = tms(d + "T00:00");
        let code = String((ci.style >= 0 && r[ci.style]) || "RATE").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 24) || "RATE";
        if (!p.styles.some(st => st.code === code)) p.styles.push(makeStyle(code, code.replace(/_/g, " "), "line", PALETTE[p.styles.length % PALETTE.length]));
        acts.push(makeActivity(ds.id, `R${String(i + 1).padStart(3, "0")}`, (ci.name >= 0 && r[ci.name]) || `Row ${i + 1}`, tstr(s), tstr(s + Math.max(cal, 1 / 24) * DAY), c0, c1, code,
          { qty: Math.round(Math.abs(c1 - c0) / lenU), qty_unit: lenU === 1 ? "m" : "ft", rate, rate_unit: lenU === 1 ? "m/day" : "ft/day", crew: ci.crew >= 0 ? r[ci.crew] || "" : "", track: ci.track >= 0 ? r[ci.track] || "" : "", notes: "From a rate sheet" }));
      });
      if (!acts.length) return setMsg("No rows could be read. Check the From, To, Start and Rate columns.", "err");
      app.commit(); p.datasets.push(ds); p.activities.push(...acts); p.view.compare_dataset = p.view.main_dataset === ds.id ? null : p.view.compare_dataset;
      close(); app.changed(); app.toast(`${acts.length} activities in "${ds.name}". Choose it in Show or Compare with.`);
    } }],
  });
}

// A project that had nothing in it takes its chainage and date range from what was imported
export function fitToData(p, acts) {
  const ch = acts.flatMap(a => [a.ch0_m, a.ch1_m]), ts = acts.flatMap(a => [tms(a.start), tms(a.finish)]);
  const lo = Math.min(...ch), hi = Math.max(...ch), pad = Math.max(1, (hi - lo) * 0.02);
  p.chainage.start_m = Math.floor(lo - pad); p.chainage.end_m = Math.ceil(hi + pad);
  const span = p.chainage.end_m - p.chainage.start_m, raw = span / 20, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map(k => k * mag).find(v => v >= raw);
  p.chainage.minor_m = step; p.chainage.major_m = step * 2;
  const t0 = new Date(Math.min(...ts)), t1 = new Date(Math.max(...ts));
  p.time.start = dstr(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), 1)); p.time.finish = dstr(Date.UTC(t1.getUTCFullYear(), t1.getUTCMonth() + 1, 1));
}

// ------------------------------------------------------------------ Microsoft Project XML import
export function msProjectDialog(app) {
  const p = app.p;
  let d = null;
  // the form's state, by name (an MS Project data set remembers the settings it was imported with)
  const prev = p.datasets.filter(x => x.source === "msproject");
  const m = { into: "", ch_start: "", ch_end: "", ch_unit: p.chainage.unit, style: "rules", crew: "", track: "", skip_without_chainage: true, include_milestones: true, name: "",
    rules: "excavate cut = CUT\nhaul fill = FILL\nfill roadway = FILL\nsubballast = SUBBALLAST\nballast = BALLAST\nbridge = BRIDGE" };
  modal({
    title: "Import from Microsoft Project (XML)", wide: true,
    body: el => {
      const map = h("div");
      el.append(h("p", { class: "hint" }, "In Microsoft Project use File → Save As → XML Format (*.xml), then choose that file here. (A .mpp file cannot be read by a browser.) Summary tasks are left out; links come across. Choose an existing MS Project data set to update it: tasks are matched by their unique ID, and what you set here (labels, crews, lines, columns) is kept."),
        field("MS Project XML file", h("input", { type: "file", accept: ".xml", onchange: async e => { try { d = MSP.parse(await e.target.files[0].text()); m.name = d.name || "MS Project"; drawMap(); } catch (err) { app.toast(err.message); } } })), map);
      const drawMap = () => {
        map.innerHTML = "";
        const fl = [["", "Not used"], ...d.fields.map(f => [f.id, f.label]), ["wbs", "WBS"], ["name", "Task name"]];
        const guess = re => (d.fields.find(f => re.test(f.label)) || {}).id || "";
        if (!m.ch_start) m.ch_start = guess(/start.*(ch|sta|mp|km)|^(ch|sta|mp).*start|from/i);
        if (!m.ch_end) m.ch_end = guess(/end.*(ch|sta|mp|km)|^(ch|sta|mp).*end|to\b/i);
        const set = k => v => (m[k] = v);
        const pick = id => { m.into = id; const ds = p.datasets.find(x => x.id === id); if (ds && ds.msp) Object.assign(m, ds.msp); drawMap(); };
        map.append(h("p", { class: "hint" }, `${d.tasks.length} tasks in "${d.name || "the file"}", ${d.tasks.filter(t => t.summary).length} of them summaries; ${d.fields.length} custom fields in use.`),
          field("Import into", sel([["", "A new data set"], ...prev.map(x => [x.id, `Update "${x.name}"`])], m.into, pick)),
          h("div", { class: "cols" },
            h("fieldset", {}, h("legend", {}, chName(p)[0].toUpperCase() + chName(p).slice(1)),
              field("Start from", sel(fl, m.ch_start, set("ch_start"))), field("End from", sel(fl, m.ch_end, set("ch_end"))),
              field("Values are in", sel([["m", "metres"], ["km", "kilometres"], ["ft", "feet (or 12+34.56 stations)"], ["mi", "miles"]], m.ch_unit, set("ch_unit"))),
              chk(m.skip_without_chainage, set("skip_without_chainage"), "Leave out tasks with no chainage")),
            h("fieldset", {}, h("legend", {}, "Styles and groups"),
              field("Style from", sel([["rules", "Words in the task name (rules below)"], ["outline1", "Level-1 summary name"], ["outline2", "Level-2 summary name"], ...d.fields.map(f => [f.id, f.label])], m.style, set("style"))),
              field("Rules: word = style, one per line", h("textarea", { rows: 4, oninput: e => (m.rules = e.target.value) }, m.rules)),
              h("div", { class: "row2" }, field("Crew from", sel([["", "Not used"], ["outline1", "Level-1 summary"], ["outline2", "Level-2 summary"], ...d.fields.map(f => [f.id, f.label])], m.crew, set("crew"))),
                field("Line / track from", sel([["", "Not used"], ...d.fields.map(f => [f.id, f.label])], m.track, set("track")))),
              chk(m.include_milestones, set("include_milestones"), "Include milestones"),
              m.into ? null : field("Data set name", h("input", { value: m.name, oninput: e => (m.name = e.target.value) })))));
      };
    },
    buttons: [{ label: "Cancel" }, { label: "Import", primary: true, onClick: ({ close, setMsg }) => {
      if (!d) return setMsg("Choose the XML file first.", "err");
      if (!m.ch_start && !m.ch_end && m.skip_without_chainage) return setMsg("Choose the fields that hold the start and end chainage, or untick 'Leave out tasks with no chainage'.", "err");
      const { into, name, ...mapping } = m;
      if (into) {
        const ds = p.datasets.find(x => x.id === into);
        app.commit(); const rp = MSP.sync(p, d, mapping, into); ds.msp = mapping;
        close(); app.changed();
        app.toast(`Updated "${ds.name}": ${rp.added.length} added, ${rp.changed.length} changed, ${rp.removed.length} removed, ${rp.unchanged} unchanged.`);
        return;
      }
      const ds = { id: newId("ds_"), name: name || "MS Project", source: "msproject", msp: mapping };
      const r = MSP.toActivities(d, mapping, p, ds.id);
      if (!r.activities.length) return setMsg(`No tasks came across (${r.skipped.no_chainage} had no chainage). Check the chainage fields.`, "err");
      app.commit(); const empty = !p.activities.length;
      p.datasets.push(ds); p.styles.push(...r.new_styles); p.activities.push(...r.activities); p.view.main_dataset = ds.id;
      if (empty) fitToData(p, r.activities);
      close(); app.changed();
      app.toast(`${r.activities.length} activities imported${r.skipped.no_chainage ? `, ${r.skipped.no_chainage} without chainage left out` : ""}. Links: ${r.activities.reduce((n, a) => n + (a.links || []).length, 0)}.`);
    } }],
  });
}

// ------------------------------------------------------------------ saved views
// A view is a named stretch of chainage and dates, with some styles hidden (TurboChart calls these charts).
export function currentView(p, name) {
  return { id: uid("v_"), name, ch_from: p.chainage.start_m, ch_to: p.chainage.end_m, t_from: p.time.start, t_to: p.time.finish,
    hidden_styles: [...(p.view.hidden_styles || [])], orientation: p.time.orientation, dataset: p.view.main_dataset };
}
export function applyView(p, v) {
  if (v.ch_from != null && v.ch_to != null && v.ch_to > v.ch_from) Object.assign(p.chainage, { start_m: v.ch_from, end_m: v.ch_to });
  if (v.t_from && v.t_to && v.t_to > v.t_from) Object.assign(p.time, { start: v.t_from.slice(0, 10), finish: v.t_to.slice(0, 10) });
  if (v.orientation) p.time.orientation = v.orientation;
  p.view.hidden_styles = [...(v.hidden_styles || [])];
  if (v.dataset && p.datasets.some(d => d.id === v.dataset)) p.view.main_dataset = v.dataset;
  p.view.current_view = v.id;
}
export function viewsDialog(app) {
  const p = app.p;
  modal({
    title: "Saved views", wide: true,
    body: el => {
      const box = h("div");
      const draw = () => {
        box.innerHTML = "";
        const views = p.views || [];
        if (!views.length) box.append(h("p", { class: "hint" }, "No saved views yet."));
        else box.append(h("table", { class: "grid-tbl" }, h("thead", {}, h("tr", {}, ...["Name", chName(p), "Dates", "Hidden styles", ""].map(x => h("th", {}, x)))),
          h("tbody", {}, ...views.map((v, i) => h("tr", {},
            h("td", {}, h("input", { value: v.name, onchange: e => { app.commit(); v.name = e.target.value; app.changed(false); } })),
            h("td", {}, `${chFmt(p, v.ch_from)} – ${chFmt(p, v.ch_to)}`),
            h("td", {}, `${niceDate(tms(v.t_from))} – ${niceDate(tms(v.t_to))}`),
            h("td", {}, String((v.hidden_styles || []).length)),
            h("td", {}, h("div", { class: "btns" },
              h("button", { type: "button", class: "small primary", onclick: () => { app.commit(); applyView(p, v); app.changed(); draw(); app.toast(`Showing "${v.name}"`); } }, p.view.current_view === v.id ? "Showing" : "Show"),
              h("button", { type: "button", class: "small", onclick: () => { app.commit(); Object.assign(v, { ...currentView(p, v.name), id: v.id }); app.changed(false); draw(); } }, "Update to what's on screen"),
              h("button", { type: "button", class: "danger small", onclick: () => { app.commit(); views.splice(i, 1); app.changed(false); draw(); } }, "Delete"))))))));
      };
      el.append(h("p", { class: "hint" }, "A view keeps a stretch of chainage, a date range and which styles are hidden, so you can switch between the whole job and close-ups. Page layout chart blocks can each show a saved view. TurboChart charts come in as views."), box,
        h("div", { class: "row2" }, field("Name for the view on screen", h("input", { id: "sv-name", value: "View " + ((p.views || []).length + 1) })),
          h("div", { class: "btns", style: "align-self:end" }, h("button", { type: "button", onclick: () => { app.commit(); (p.views ||= []).push(currentView(p, $("#sv-name", el).value || "View")); app.changed(false); draw(); } }, "Save the current view"))));
      draw();
    },
    buttons: [{ label: "Close" }],
  });
}
