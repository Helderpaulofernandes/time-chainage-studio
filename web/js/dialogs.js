// Modal dialogs: project setup, open, imports, P6 field mapping and sync, productivities.
import { api } from "./api.js";
import { h, esc, $, $$, chFmt, chToM, mToCh, uid, tms, niceDate, niceFinish } from "./util.js";

// ------------------------------------------------------------------ modal framework
export function modal({ title, body, buttons = [], wide = false, onClose }) {
  const dlg = h("dialog", { class: "modal" + (wide ? " wide" : "") });
  const msg = h("p", { class: "msg", role: "status" });
  const foot = h("div", { class: "modal-foot" }, msg);
  const close = () => { dlg.close(); dlg.remove(); onClose && onClose(); };
  const setMsg = (t, kind = "") => { msg.textContent = t || ""; msg.className = "msg " + kind; };
  buttons.forEach(b => {
    const btn = h("button", { type: "button", class: b.primary ? "primary" : b.danger ? "danger" : "" }, b.label);
    btn.addEventListener("click", async () => {
      if (!b.onClick) return close();
      btn.disabled = true;
      try { await b.onClick({ close, setMsg, dlg }); } catch (e) { setMsg(e.message || String(e), "err"); }
      finally { btn.disabled = false; }
    });
    foot.append(btn);
  });
  const content = h("div", { class: "modal-body" });
  dlg.append(h("header", {}, h("h2", {}, title), h("button", { type: "button", class: "x", "aria-label": "Close", onclick: close }, "×")), content, foot);
  document.body.append(dlg);
  body(content, { close, setMsg, dlg });
  dlg.addEventListener("cancel", e => { e.preventDefault(); close(); });
  dlg.showModal();
  return { close, setMsg, dlg };
}

export function confirmBox(title, text, okLabel = "OK") {
  return new Promise(res => modal({ title, body: el => el.append(h("p", {}, text)),
    buttons: [{ label: "Cancel", onClick: ({ close }) => { close(); res(false); } }, { label: okLabel, primary: true, onClick: ({ close }) => { close(); res(true); } }] }));
}

const field = (label, input, hint) => h("label", { class: "fld" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
const inp = (id, value = "", attrs = {}) => h("input", { id, value: value ?? "", ...attrs });
const sel = (id, opts, value) => { const s = h("select", { id }); opts.forEach(([v, t]) => s.append(h("option", { value: v }, t))); if (value != null) s.value = value; return s; };
const val = (root, id) => $("#" + id, root)?.value ?? "";
const chk = (root, id) => !!$("#" + id, root)?.checked;

// ------------------------------------------------------------------ project setup (new and edit)
export async function projectSetup(app, mode = "new") {
  const presets = app.presets || (app.presets = await api.presets());
  const p = mode === "edit" ? app.p : null;
  const c = p?.chainage || { start_m: 0, end_m: 10000, unit: "km", prefix: "CH", decimals: 3, major_m: 1000, minor_m: 500, reverse: false, snap_m: 10 };
  const t = p?.time || { start: new Date().toISOString().slice(0, 8) + "01", finish: "", px_per_day: 2, orientation: "down", week_labels: "project", shade_weekends: false, work_days_per_week: 7 };
  const k = c.unit === "km" ? 1000 : 1;
  let sections = (p?.sections || []).map(s => ({ ...s }));
  modal({
    title: mode === "new" ? "New project" : "Project setup", wide: true,
    body: el => {
      const disc = sel("ps-disc", Object.entries(presets.disciplines).map(([k2, v]) => [k2, v.label]), p?.discipline || "rail");
      el.append(
        h("div", { class: "cols" },
          h("fieldset", {}, h("legend", {}, "Project"),
            field("Name", inp("ps-name", p?.name || "New time-chainage", { required: true })),
            field("Drawing title", inp("ps-title", p?.meta.title || "")),
            field("Subtitle", inp("ps-sub", p?.meta.subtitle || "")),
            h("div", { class: "row2" }, field("Client", inp("ps-client", p?.meta.client || "")), field("Contract", inp("ps-contract", p?.meta.contract || ""))),
            h("div", { class: "row2" }, field("Revision", inp("ps-rev", p?.meta.revision || "A")), field("Prepared by", inp("ps-author", p?.meta.author || ""))),
            mode === "new" ? field("Asset type", disc, "Sets the location marker types and a starter activity style library. Both can be edited later.") : null),
          h("fieldset", {}, h("legend", {}, "Chainage range"),
            h("div", { class: "row2" }, field("Unit", sel("ps-unit", [["km", "km"], ["m", "m"]], c.unit)), field("Prefix", inp("ps-prefix", c.prefix || ""))),
            h("div", { class: "row2" }, field("Start", inp("ps-c0", c.start_m / k, { type: "number", step: "any" })), field("End", inp("ps-c1", c.end_m / k, { type: "number", step: "any" }))),
            h("div", { class: "row2" }, field("Major tick", inp("ps-maj", c.major_m / k, { type: "number", step: "any" })), field("Minor tick", inp("ps-min", c.minor_m / k, { type: "number", step: "any" }))),
            h("div", { class: "row2" }, field("Decimals", inp("ps-dec", c.decimals, { type: "number", min: 0, max: 4 })), field("Drag snap (m)", inp("ps-snap", c.snap_m, { type: "number", step: "any" }))),
            h("label", { class: "chk" }, h("input", { type: "checkbox", id: "ps-rev2", checked: c.reverse }), " Chainage decreases to the right")),
          h("fieldset", {}, h("legend", {}, "Time range"),
            h("div", { class: "row2" }, field("Start", inp("ps-t0", t.start, { type: "date" })), field("Finish", inp("ps-t1", t.finish, { type: "date" }))),
            h("div", { class: "row2" }, field("Scale (px per day)", inp("ps-ppd", t.px_per_day, { type: "number", step: "0.1", min: "0.1" })),
              field("Time runs", sel("ps-or", [["down", "Down the page"], ["up", "Up the page"]], t.orientation))),
            h("div", { class: "row2" }, field("Week labels", sel("ps-wk", [["project", "Project weeks"], ["iso", "ISO weeks"], ["date", "Week commencing"]], t.week_labels)),
              field("Working days / week", inp("ps-wd", t.work_days_per_week, { type: "number", step: "0.5", min: 1, max: 7 }), "Used when a productivity rate sets a duration.")),
            h("label", { class: "chk" }, h("input", { type: "checkbox", id: "ps-we", checked: t.shade_weekends }), " Shade weekends"))),
        h("fieldset", {}, h("legend", {}, "Sections"),
          h("p", { class: "hint" }, "Section markers are the bands across the top of the chart, e.g. work sections, contract portions or tunnel drives."),
          h("table", { class: "grid-tbl" }, h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "From"), h("th", {}, "To"), h("th", {}))), h("tbody", { id: "ps-secs" })),
          h("button", { type: "button", onclick: () => { const last = sections.length ? Math.max(...sections.map(s => s.to_m)) : chToMx(); sections.push({ id: uid("s_"), name: `S${sections.length + 1}`, from_m: last, to_m: last + (cEnd() - last) / 2 }); drawSecs(); } }, "Add section")));
      const unitK = () => (val(el, "ps-unit") === "km" ? 1000 : 1);
      const chToMx = () => parseFloat(val(el, "ps-c0") || 0) * unitK();
      const cEnd = () => parseFloat(val(el, "ps-c1") || 0) * unitK();
      function drawSecs() {
        const tb = $("#ps-secs", el); tb.innerHTML = "";
        sections.forEach((s, i) => tb.append(h("tr", {},
          h("td", {}, h("input", { value: s.name, oninput: e => (s.name = e.target.value) })),
          h("td", {}, h("input", { type: "number", step: "any", value: +(s.from_m / unitK()).toFixed(4), oninput: e => (s.from_m = parseFloat(e.target.value) * unitK()) })),
          h("td", {}, h("input", { type: "number", step: "any", value: +(s.to_m / unitK()).toFixed(4), oninput: e => (s.to_m = parseFloat(e.target.value) * unitK()) })),
          h("td", {}, h("button", { type: "button", class: "danger small", onclick: () => { sections.splice(i, 1); drawSecs(); } }, "Remove")))));
      }
      drawSecs();
      $("#ps-unit", el).addEventListener("change", drawSecs);
    },
    buttons: [{ label: "Cancel" }, {
      label: mode === "new" ? "Create project" : "Apply", primary: true, onClick: async ({ close, setMsg, dlg }) => {
        const el = dlg;
        const kk = val(el, "ps-unit") === "km" ? 1000 : 1;
        const c0 = parseFloat(val(el, "ps-c0")) * kk, c1 = parseFloat(val(el, "ps-c1")) * kk;
        const t0 = val(el, "ps-t0"), t1 = val(el, "ps-t1");
        if (!val(el, "ps-name").trim()) return setMsg("Give the project a name.", "err");
        if (!(c1 > c0)) return setMsg("The chainage end must be greater than the start.", "err");
        if (!t0 || !t1 || t1 <= t0) return setMsg("The finish date must be after the start date.", "err");
        const chainage = { start_m: c0, end_m: c1, unit: val(el, "ps-unit"), prefix: val(el, "ps-prefix"), decimals: +val(el, "ps-dec") || 0,
          major_m: parseFloat(val(el, "ps-maj")) * kk || 0, minor_m: parseFloat(val(el, "ps-min")) * kk || 0, reverse: chk(el, "ps-rev2"), snap_m: parseFloat(val(el, "ps-snap")) || 0 };
        const time = { start: t0, finish: t1, px_per_day: parseFloat(val(el, "ps-ppd")) || 2, orientation: val(el, "ps-or"), week_labels: val(el, "ps-wk"),
          shade_weekends: chk(el, "ps-we"), work_days_per_week: parseFloat(val(el, "ps-wd")) || 7 };
        const meta = { title: val(el, "ps-title") || val(el, "ps-name"), subtitle: val(el, "ps-sub"), client: val(el, "ps-client"), contract: val(el, "ps-contract"),
          revision: val(el, "ps-rev"), author: val(el, "ps-author") };
        if (mode === "new") {
          const np = await api.create({ name: val(el, "ps-name"), discipline: val(el, "ps-disc"), start_m: c0, end_m: c1, unit: chainage.unit, start: t0, finish: t1, chainage, time, meta, sections });
          close(); app.open(np, true);
        } else {
          app.commit();
          Object.assign(app.p.chainage, chainage); Object.assign(app.p.time, time); Object.assign(app.p.meta, meta);
          app.p.name = val(el, "ps-name"); app.p.sections = sections;
          close(); app.changed();
        }
      } }],
  });
}

// ------------------------------------------------------------------ open project
export async function openProject(app) {
  const list = await api.list();
  modal({
    title: "Open project", wide: true,
    body: el => {
      if (!list.length) { el.append(h("p", {}, "No projects yet. Start one with File → New project, or import an Excel workbook, a P6 XER or a TurboChart file.")); return; }
      const tb = h("tbody");
      list.forEach(x => tb.append(h("tr", {},
        h("td", {}, h("button", { type: "button", class: "link", onclick: async () => { app.open(await api.get(x.id)); $("dialog.modal")?.close(); $("dialog.modal")?.remove(); } }, x.name)),
        h("td", {}, x.discipline), h("td", { class: "n" }, x.activities), h("td", { class: "n" }, x.modified ? new Date(x.modified).toLocaleString() : ""), h("td", {}, x.file || "in this browser only"),
        h("td", {}, h("button", { type: "button", class: "small", onclick: async () => { const d = await api.duplicate(x.id); app.open(d); $("dialog.modal")?.close(); $("dialog.modal")?.remove(); } }, "Duplicate"),
          " ", h("button", { type: "button", class: "small danger", onclick: async e => { if (await confirmBox("Delete project", `Delete "${x.name}"? This cannot be undone.`, "Delete")) { await api.remove(x.id); e.target.closest("tr").remove(); } } }, "Delete")))));
      el.append(h("table", { class: "grid-tbl" }, h("thead", {}, h("tr", {}, h("th", {}, "Project"), h("th", {}, "Type"), h("th", {}, "Activities"), h("th", {}, "Modified"), h("th", {}, "Saved to"), h("th", {}))), tb));
    },
    buttons: [{ label: "Close" }],
  });
}

// ------------------------------------------------------------------ example projects
export async function examples(app) {
  let list = [];
  try { list = await (await fetch("templates/index.json", { cache: "no-cache" })).json(); } catch (e) { /* offline */ }
  modal({
    title: "Start from an example", wide: true,
    body: el => {
      el.append(h("p", { class: "hint" }, "Each example loads as a new project of your own, so you can change it freely. All names and figures are made up."));
      if (!list.length) { el.append(h("p", { class: "msg err" }, "The examples could not be loaded. Check the internet connection and try again.")); return; }
      el.append(h("div", { class: "examples" }, list.map(x => h("div", { class: "example" }, h("h3", {}, x.name), h("p", { class: "hint" }, x.text),
        h("button", { type: "button", class: "primary", onclick: async e => {
          e.target.disabled = true;
          try { const tpl = await (await fetch("templates/" + x.file, { cache: "no-cache" })).json(); const p = await api.fromTemplate(tpl);
            $("dialog.modal")?.close(); $("dialog.modal")?.remove(); app.open(p, true); app.toast(`Loaded "${p.meta.title || p.name}".`); }
          catch (err) { e.target.disabled = false; app.toast("Could not load that example: " + err.message); } } }, "Use this example")))));
    },
    buttons: [{ label: "Close" }],
  });
}

// ------------------------------------------------------------------ simple imports
export function importExcel(app) {
  modal({
    title: "Import Excel workbook",
    body: el => el.append(
      h("p", { class: "hint" }, "Each sheet with ID, Start, Finish, CH from and CH to columns becomes one option (data set). An Assets sheet becomes location markers, a Productivities sheet the productivity library, and the drawn chart sheet gives section markers, AO bands and milestones."),
      field("Workbook (.xlsx)", h("input", { type: "file", id: "ix-file", accept: ".xlsx,.xlsm" })),
      field("Asset type", sel("ix-disc", [["rail", "Rail"], ["road", "Road"], ["tunnel", "Tunnel"], ["other", "Other"]], "rail"))),
    buttons: [{ label: "Cancel" }, { label: "Import", primary: true, onClick: async ({ close, setMsg, dlg }) => {
      const f = $("#ix-file", dlg).files[0]; if (!f) return setMsg("Choose a workbook first.", "err");
      setMsg("Reading the workbook…");
      const p = await api.importExcel(f, val(dlg, "ix-disc")); close(); app.open(p, true);
      app.toast(`Imported ${p.activities.length} activities in ${p.datasets.length} option${p.datasets.length > 1 ? "s" : ""}.`);
    } }],
  });
}

export function importTchart(app) {
  modal({
    title: "Import TurboChart file",
    body: el => el.append(field("TurboChart file (.tchart)", h("input", { type: "file", id: "it-file", accept: ".tchart,.json" })),
      field("Positions in the file are", sel("it-unit", [["auto", "Work it out from the suffix"], ["m", "metres"], ["km", "kilometres"]], "auto"))),
    buttons: [{ label: "Cancel" }, { label: "Import", primary: true, onClick: async ({ close, setMsg, dlg }) => {
      const f = $("#it-file", dlg).files[0]; if (!f) return setMsg("Choose a .tchart file first.", "err");
      const p = await api.importTchart(f, val(dlg, "it-unit")); close(); app.open(p, true);
    } }],
  });
}

export function importJson(app) {
  modal({ title: "Open project file", body: el => el.append(field("Project file (.tcs.json)", h("input", { type: "file", id: "ij-file", accept: ".json" }))),
    buttons: [{ label: "Cancel" }, { label: "Open", primary: true, onClick: async ({ close, setMsg, dlg }) => {
      const f = $("#ij-file", dlg).files[0]; if (!f) return setMsg("Choose a file first.", "err");
      const p = await api.importJson(f); close(); app.open(p, true);
    } }] });
}

// ------------------------------------------------------------------ P6 field mapping (import and sync)
const SRC = [["none", "Not used"], ["udf", "UDF"], ["code", "Activity code"], ["wbs", "WBS"], ["field", "Activity field"]];
const TASK_FIELDS = [["task_code", "Activity ID"], ["task_name", "Activity name"]];

function sourcePicker(id, d, cur, allow = ["none", "udf", "code", "wbs", "field"]) {
  const wrap = h("div", { class: "src" });
  const s = sel(id + "-src", SRC.filter(([v]) => allow.includes(v)), cur?.source || "none");
  const item = h("select", { id: id + "-id" });
  const use = sel(id + "-use", [["short", "Code value"], ["name", "Code description"]], cur?.use === "name" ? "name" : "short");
  const fill = () => {
    item.innerHTML = ""; use.hidden = s.value !== "code";
    const list = s.value === "udf" ? d.udfs.map(u => [u.id, `${u.label} (${u.type.replace("FT_", "").toLowerCase()}, ${u.values} values)`])
      : s.value === "code" ? d.codes.map(c => [c.id, `${c.name} (${c.assignments} assigned)`])
      : s.value === "wbs" ? [["short", "WBS code"], ["path", "Full WBS path"]] : s.value === "field" ? TASK_FIELDS : [];
    list.forEach(([v, t]) => item.append(h("option", { value: v }, t)));
    item.hidden = !list.length;
    if (cur && cur.source === s.value) item.value = s.value === "wbs" ? (cur.use === "path" ? "path" : "short") : cur.id;
  };
  s.addEventListener("change", fill); fill();
  wrap.append(s, item, use);
  wrap.read = () => {
    if (s.value === "none") return { source: "none" };
    if (s.value === "wbs") return { source: "wbs", use: item.value };
    const lab = s.value === "udf" ? d.udfs.find(u => u.id === item.value)?.label : s.value === "code" ? d.codes.find(c => c.id === item.value)?.name : item.value;
    return { source: s.value, id: item.value, label: lab, use: s.value === "code" ? use.value : undefined };
  };
  return wrap;
}

// Saved mappings refer to UDF and code ids; a newer XER may number them differently, so re-find them by name.
function remap(m, d) {
  const fix = src => {
    if (!src || !src.label) return src;
    if (src.source === "udf") { const u = d.udfs.find(x => x.label === src.label); return u ? { ...src, id: u.id } : src; }
    if (src.source === "code") { const c = d.codes.find(x => x.name === src.label); return c ? { ...src, id: c.id } : src; }
    return src;
  };
  return { ...m, ch_start: fix(m.ch_start), ch_end: fix(m.ch_end), style: fix(m.style), filter: { ...fix(m.filter), values: m.filter?.values || [] },
    projects: d.projects.map(p => p.id) };
}

export function p6Dialog(app, mode = "import") {
  let insp = null, dsSel = null;
  const p6sets = (app.p?.datasets || []).filter(d => d.mapping);
  modal({
    title: mode === "sync" ? "Sync from P6 (XER)" : "Import from P6 (XER) with field mapping", wide: true,
    body: el => {
      el.append(...[
        h("p", { class: "hint" }, mode === "sync"
          ? "Pick the data set to update, then choose the newer XER exported from P6. The saved field mapping is reused; activities are matched by Activity ID, and your label and footprint settings are kept."
          : "P6 stays the master: dates come from P6, and chainage and style come from the fields you map below. Nothing is scheduled here."),
        mode === "sync" ? field("Data set to update", dsSel = sel("p6-ds", p6sets.map(d => [d.id, `${d.name} (last sync ${d.last_sync || "never"})`]))) : null,
        field("P6 export (.xer)", h("input", { type: "file", id: "p6-file", accept: ".xer" })),
        h("div", { id: "p6-map" }), h("div", { id: "p6-prev" })].filter(Boolean));
      if (mode === "sync" && !p6sets.length) $("#p6-map", el).append(h("p", { class: "msg err" }, "This project has no data set imported from P6 yet. Use Data → Import from P6 first."));
      $("#p6-file", el).addEventListener("change", async e => {
        const f = e.target.files[0]; if (!f) return;
        $("#p6-map", el).innerHTML = "<p class='hint'>Reading the XER…</p>";
        try { insp = await api.p6Inspect(f); } catch (err) { $("#p6-map", el).innerHTML = ""; $("#p6-map", el).append(h("p", { class: "msg err" }, err.message)); return; }
        let start = insp.suggested;
        if (mode === "sync" && dsSel) { const ds = p6sets.find(d => d.id === dsSel.value); if (ds) start = remap(ds.mapping, insp.describe); }
        drawMapping(el, insp, start, mode);
      });
    },
    buttons: [{ label: "Cancel" },
      { label: mode === "sync" ? "Preview changes" : "Preview", onClick: async ({ setMsg, dlg }) => {
        if (!insp) return setMsg("Choose an XER file first.", "err");
        const m = readMapping(dlg, insp);
        if (mode === "sync") {
          const r = await api.p6Sync(app.p.id, { token: insp.token, dataset_id: dsSel.value, mapping: m, apply: false, file: insp.file });
          showReport($("#p6-prev", dlg), r.report); setMsg("Nothing has changed yet. Choose Apply sync to update the chart.");
        } else {
          const r = await api.p6Preview({ token: insp.token, mapping: m });
          showPreview($("#p6-prev", dlg), r, app); setMsg(`${r.count} activities will come in.`, r.count ? "ok" : "err");
        }
      } },
      { label: mode === "sync" ? "Apply sync" : "Import", primary: true, onClick: async ({ close, setMsg, dlg }) => {
        if (!insp) return setMsg("Choose an XER file first.", "err");
        const m = readMapping(dlg, insp);
        if (mode === "sync") {
          const r = await api.p6Sync(app.p.id, { token: insp.token, dataset_id: dsSel.value, mapping: m, apply: true, file: insp.file });
          close(); app.load(r.project);
          const rp = r.report; app.toast(`Synced: ${rp.changed.length} changed, ${rp.added.length} added, ${rp.removed.length} removed, ${rp.unchanged} unchanged.`);
        } else {
          const target = val(dlg, "p6-target");
          const body = { token: insp.token, mapping: m, file: insp.file };
          if (target === "current" && app.p) body.project_id = app.p.id;
          else body.setup = { name: val(dlg, "p6-pname") || insp.file, discipline: val(dlg, "p6-disc"), unit: val(dlg, "p6-unit2") };
          const r = await api.p6Import(body);
          close(); app.open(r.project, !body.project_id); app.toast(`Imported ${r.count} activities from P6.`);
        }
      } }],
  });
}

function drawMapping(el, insp, m, mode) {
  const d = insp.describe, box = $("#p6-map", el); box.innerHTML = "";
  const df = Object.entries(d.date_fields);
  const projs = h("div", { class: "checks" }, d.projects.map(p => h("label", { class: "chk" }, h("input", { type: "checkbox", class: "p6-proj", value: p.id, checked: !m.projects?.length || m.projects.includes(p.id) }), ` ${p.short_name} (${p.tasks} activities)`)));
  const types = Object.entries(d.task_types).map(([k, v]) => `${k.replace("TT_", "")} ${v}`).join(" · ");
  box.append(
    h("p", { class: "hint" }, `P6 ${d.version} · ${d.tasks} activities (${types}) · ${d.udfs.length} activity UDFs · ${d.codes.length} activity code types`),
    h("div", { class: "cols" },
      h("fieldset", {}, h("legend", {}, "Projects and dates"), projs,
        field("Start date", sel("p6-start", df, m.start)), field("Finish date", sel("p6-finish", df, m.finish))),
      h("fieldset", {}, h("legend", {}, "Chainage"),
        field("Start chainage", sourcePicker("p6-cs", d, m.ch_start, ["none", "udf", "code", "field"])),
        field("End chainage", sourcePicker("p6-ce", d, m.ch_end, ["none", "udf", "code", "field"])),
        field("Values are in", sel("p6-unit", [["m", "metres"], ["km", "kilometres"]], m.ch_unit), "Text like CH232.135 or 12+345 is read too."),
        h("label", { class: "chk" }, h("input", { type: "checkbox", id: "p6-skip", checked: m.skip_without_chainage !== false }), " Leave out activities with no chainage")),
      h("fieldset", {}, h("legend", {}, "Style and filter"),
        field("Activity style (shape code)", sourcePicker("p6-st", d, m.style, ["none", "udf", "code", "wbs"])),
        field("Filter on", sourcePicker("p6-fl", d, m.filter, ["none", "udf", "code", "wbs"])),
        field("Keep only these values", inp("p6-flv", (m.filter?.values || []).join(", "), { placeholder: "comma separated; blank keeps all" })),
        h("label", { class: "chk" }, h("input", { type: "checkbox", id: "p6-mile", checked: m.include_milestones !== false }), " Include milestones"),
        h("label", { class: "chk" }, h("input", { type: "checkbox", id: "p6-sum", checked: !!m.include_summary }), " Include WBS summary activities"))),
    mode === "import" ? h("fieldset", {}, h("legend", {}, "Where it goes"),
      h("div", { class: "row3" }, field("Add to", sel("p6-target", [["new", "A new project"], ["current", "The open project, as a new data set"]], "new")),
        field("Data set name", inp("p6-dsname", m.dataset_name || insp.file.replace(/\.xer$/i, ""))),
        field("New project name", inp("p6-pname", insp.file.replace(/\.xer$/i, "")))),
      h("div", { class: "row3" }, field("Asset type", sel("p6-disc", [["rail", "Rail"], ["road", "Road"], ["tunnel", "Tunnel"], ["other", "Other"]], "rail")),
        field("Display chainage in", sel("p6-unit2", [["km", "km"], ["m", "m"]], "km")))) : null);
  box._pickers = { cs: $("#p6-cs-src", box).parentElement, ce: $("#p6-ce-src", box).parentElement, st: $("#p6-st-src", box).parentElement, fl: $("#p6-fl-src", box).parentElement };
}

function readMapping(dlg, insp) {
  const box = $("#p6-map", dlg), P = box._pickers;
  return {
    projects: $$(".p6-proj", box).filter(x => x.checked).map(x => x.value),
    start: val(dlg, "p6-start"), finish: val(dlg, "p6-finish"),
    ch_start: P.cs.read(), ch_end: P.ce.read(), ch_unit: val(dlg, "p6-unit"), style: P.st.read(),
    filter: { ...P.fl.read(), values: val(dlg, "p6-flv").split(",").map(s => s.trim()).filter(Boolean) },
    skip_without_chainage: chk(dlg, "p6-skip"), include_milestones: chk(dlg, "p6-mile"), include_summary: chk(dlg, "p6-sum"),
    dataset_name: val(dlg, "p6-dsname") || insp.file.replace(/\.xer$/i, ""),
  };
}

function showPreview(box, r, app) {
  box.innerHTML = "";
  const sk = r.skipped, skipTxt = Object.entries(sk).filter(([, v]) => v).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ");
  box.append(h("h3", {}, `Preview: ${r.count} activities` + (skipTxt ? ` · left out: ${skipTxt}` : "")),
    r.styles.length ? h("p", { class: "hint" }, `New styles will be created for: ${r.styles.join(", ")}`) : null,
    h("div", { class: "scroll" }, h("table", { class: "grid-tbl" }, h("thead", {}, h("tr", {}, ["ID", "Name", "Start", "Finish", "From (m)", "To (m)", "Style", "WBS"].map(x => h("th", {}, x)))),
      h("tbody", {}, r.rows.map(a => h("tr", {}, h("td", {}, a.code), h("td", {}, a.name), h("td", { class: "n" }, niceDate(tms(a.start))), h("td", { class: "n" }, niceFinish(tms(a.finish))),
        h("td", { class: "n" }, Math.round(a.ch0_m).toLocaleString()), h("td", { class: "n" }, Math.round(a.ch1_m).toLocaleString()), h("td", {}, a.style), h("td", {}, a.wbs)))))));
}

function showReport(box, rp) {
  box.innerHTML = "";
  box.append(h("h3", {}, `Changes: ${rp.changed.length} changed · ${rp.added.length} added · ${rp.removed.length} removed · ${rp.unchanged} unchanged`),
    h("div", { class: "scroll" }, h("table", { class: "grid-tbl" }, h("thead", {}, h("tr", {}, h("th", {}, "Activity ID"), h("th", {}, "What changed"))),
      h("tbody", {}, rp.changed.slice(0, 200).map(c => h("tr", {}, h("td", {}, c.code), h("td", {}, c.fields.join(", ")))),
        rp.added.slice(0, 100).map(c => h("tr", {}, h("td", {}, c), h("td", { class: "ok" }, "added"))),
        rp.removed.slice(0, 100).map(c => h("tr", {}, h("td", {}, c), h("td", { class: "err" }, "no longer in P6 – will be removed")))))));
}

// ------------------------------------------------------------------ productivities
export function productivities(app) {
  const rows = app.p.productivities || [];
  modal({ title: "Productivity library", wide: true,
    body: el => el.append(
      rows.length ? h("div", { class: "scroll" }, h("table", { class: "grid-tbl" },
        h("thead", {}, h("tr", {}, ["Activity", "Resources", "Productivity", "Rate", "Quantity", "Qty", "Crew", "Shifts"].map(x => h("th", {}, x)))),
        h("tbody", {}, rows.map(r => h("tr", {}, h("td", {}, r.activity), h("td", {}, r.resources), h("td", {}, r.rate_text), h("td", { class: "n" }, r.rate == null ? "" : +(+r.rate).toFixed(3)),
          h("td", {}, r.qty_text), h("td", { class: "n" }, r.qty ?? ""), h("td", {}, r.crew), h("td", { class: "n" }, r.shifts == null ? "" : (+r.shifts).toFixed(1)))))))
        : h("p", {}, "No productivity library yet. Import an Excel workbook with a Productivities sheet, or set a quantity and rate on each activity."),
      h("p", { class: "hint" }, "An activity's own quantity and rate (in its properties) set its duration when it is not driven by P6.")),
    buttons: [{ label: "Close" }] });
}

// ------------------------------------------------------------------ images
export function readImage(file) {
  return new Promise((res, rej) => {
    if (!file) return rej(new Error("Choose an image file first."));
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) return rej(new Error("Choose a PNG, JPG, GIF, WebP or SVG image."));
    const fr = new FileReader();
    fr.onerror = () => rej(new Error("Could not read that file."));
    fr.onload = () => { const img = new Image(); img.onload = () => res({ data: fr.result, nat_w: img.naturalWidth || 1000, nat_h: img.naturalHeight || 200, name: file.name });
      img.onerror = () => rej(new Error("That file is not an image this browser can show.")); img.src = fr.result; };
    fr.readAsDataURL(file);
  });
}

export function headerImage(app) {
  const p = app.p, c = p.chainage, cur = p.header_image || {};
  let picked = cur.data ? { data: cur.data, nat_w: cur.nat_w, nat_h: cur.nat_h, name: cur.name } : null;
  modal({
    title: "Header image", wide: true,
    body: el => {
      const prev = h("div", { class: "img-prev" }, picked ? h("img", { src: picked.data, alt: "Current header image" }) : h("p", { class: "hint" }, "No image yet."));
      el.append(
        h("p", { class: "hint" }, "The image sits above the section bands and is stretched between the two chainages you give, so a straight-line or network diagram lines up with the chart. It prints, and goes into TurboChart exports as the top image."),
        field("Image file", h("input", { type: "file", id: "hi-file", accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml",
          onchange: async e => { try { picked = await readImage(e.target.files[0]); prev.innerHTML = ""; prev.append(h("img", { src: picked.data, alt: "Chosen header image" }), h("p", { class: "hint" }, `${picked.nat_w} × ${picked.nat_h} px`)); } catch (err) { prev.innerHTML = ""; prev.append(h("p", { class: "msg err" }, err.message)); } } })),
        prev,
        h("div", { class: "cols" },
          h("fieldset", {}, h("legend", {}, "Placement"),
            field("Stretch across", sel("hi-fit", [["chainage", "Between these chainages"], ["full", "The full chart width"]], cur.fit || "chainage")),
            h("div", { class: "row2" },
              field(`Left edge chainage (${c.unit})`, inp("hi-c0", mToCh(p, cur.ch_start_m ?? c.start_m), { type: "number", step: "any" })),
              field(`Right edge chainage (${c.unit})`, inp("hi-c1", mToCh(p, cur.ch_end_m ?? c.end_m), { type: "number", step: "any" }))),
            h("small", { class: "hint" }, "Use the chainages that the image's own left and right edges represent.")),
          h("fieldset", {}, h("legend", {}, "Size and look"),
            field("Height (px on screen)", inp("hi-h", cur.height_px || "", { type: "number", min: 10, placeholder: "automatic, keeps proportions" })),
            field("Opacity", inp("hi-op", cur.opacity ?? 1, { type: "number", step: "0.05", min: 0.05, max: 1 })),
            h("label", { class: "chk" }, h("input", { type: "checkbox", id: "hi-ratio", checked: !!cur.keep_ratio }), " Never distort the image (fit inside the box)"),
            h("label", { class: "chk" }, h("input", { type: "checkbox", id: "hi-show", checked: cur.show !== false }), " Show the image"))));
    },
    buttons: [
      { label: "Remove image", danger: true, onClick: ({ close }) => { app.commit(); p.header_image = null; close(); app.changed(); } },
      { label: "Cancel" },
      { label: "Apply", primary: true, onClick: ({ close, setMsg, dlg }) => {
        if (!picked) return setMsg("Choose an image file first.", "err");
        const c0 = chToM(p, val(dlg, "hi-c0")), c1 = chToM(p, val(dlg, "hi-c1"));
        if (val(dlg, "hi-fit") === "chainage" && (c0 == null || c1 == null || c0 === c1)) return setMsg("Give two different chainages for the image edges.", "err");
        app.commit();
        p.header_image = { ...picked, fit: val(dlg, "hi-fit"), ch_start_m: c0, ch_end_m: c1, height_px: parseFloat(val(dlg, "hi-h")) || null,
          opacity: Math.min(1, Math.max(0.05, parseFloat(val(dlg, "hi-op")) || 1)), keep_ratio: chk(dlg, "hi-ratio"), show: chk(dlg, "hi-show") };
        close(); app.changed();
      } }],
  });
}
