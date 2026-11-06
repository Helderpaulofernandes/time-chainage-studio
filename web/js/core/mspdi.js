// Microsoft Project XML (MSPDI) reader: tasks, dates, WBS, custom fields and links. In MS Project use
// File > Save As > "XML Format (*.xml)". Native .mpp files are a closed binary format that a browser cannot read.
import { makeActivity, makeStyle, fmtT, parseT, DAY } from "./model.js";
import { chainageToM } from "./xer.js";

const PALETTE = ["#002060", "#00B0F0", "#FFC000", "#92D050", "#C00000", "#C65911", "#7030A0", "#548235", "#FF66CC", "#996633", "#404040", "#1F8A86"];
// Custom field ids MS Project writes in ExtendedAttribute/FieldID (Task Text1–30, Number1–20, Outline Code1–10)
const FIELD_NAMES = (() => {
  const m = {};
  const add = (base, n, ids) => ids.forEach((id, i) => (m[id] = base + (i + 1)));
  add("Text", 30, [188743731, 188743734, 188743737, 188743740, 188743743, 188743746, 188743747, 188743748, 188743749, 188743750, 188743997, 188743998, 188743999, 188744000, 188744001,
    188744002, 188744003, 188744004, 188744005, 188744006, 188744007, 188744008, 188744009, 188744010, 188744011, 188744012, 188744013, 188744014, 188744015, 188744016]);
  add("Number", 20, [188743767, 188743768, 188743769, 188743770, 188743771, 188743982, 188743983, 188743984, 188743985, 188743986, 188743987, 188743988, 188743989, 188743990, 188743991,
    188743992, 188743993, 188743994, 188743995, 188743996]);
  add("Outline Code", 10, [188744096, 188744098, 188744100, 188744102, 188744104, 188744106, 188744108, 188744110, 188744112, 188744114]);
  return m;
})();
const LINK = { 0: "FF", 1: "FS", 2: "SF", 3: "SS" };

const kids = (el, tag) => (el ? [...el.children].filter(c => c.localName === tag) : []);
const kid = (el, tag) => kids(el, tag)[0] || null;
const txt = (el, tag) => { const k = kid(el, tag); return k ? k.textContent.trim() : ""; };

export function parse(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("That file is not valid XML.");
  const root = doc.documentElement;
  if (root.localName !== "Project") throw new Error("That XML is not a Microsoft Project file. In MS Project use File > Save As > XML Format.");
  // custom field definitions: FieldID -> alias (or the field name)
  const defs = {};
  for (const ea of kids(kid(root, "ExtendedAttributes"), "ExtendedAttribute")) {
    const id = txt(ea, "FieldID"); defs[id] = { id, name: txt(ea, "FieldName") || FIELD_NAMES[id] || id, alias: txt(ea, "Alias") };
  }
  const tasks = [];
  for (const t of kids(kid(root, "Tasks"), "Task")) {
    const uid = txt(t, "UID"); if (!uid || uid === "0") continue; // UID 0 is the project summary task
    const ext = {};
    for (const ea of kids(t, "ExtendedAttribute")) { const id = txt(ea, "FieldID"); ext[id] = txt(ea, "Value"); if (!defs[id]) defs[id] = { id, name: FIELD_NAMES[id] || "Field " + id, alias: "" }; }
    tasks.push({
      uid, id: txt(t, "ID"), name: txt(t, "Name"), wbs: txt(t, "WBS") || txt(t, "OutlineNumber"), level: +txt(t, "OutlineLevel") || 1,
      start: txt(t, "Start"), finish: txt(t, "Finish"), milestone: txt(t, "Milestone") === "1", summary: txt(t, "Summary") === "1",
      critical: txt(t, "Critical") === "1", ext,
      preds: kids(t, "PredecessorLink").map(l => ({ uid: txt(l, "PredecessorUID"), type: LINK[txt(l, "Type")] || "FS", lag_days: Math.round((+txt(l, "LinkLag") || 0) / 4800 * 10) / 10 })),
    });
  }
  // the outline: a task's level-1 and level-2 summary names, to use as a style or crew
  const stack = [];
  for (const t of tasks) { stack.length = t.level - 1; t.path = stack.slice(); if (t.summary) stack[t.level - 1] = t.name; }
  const used = new Set(tasks.flatMap(t => Object.keys(t.ext)));
  return { name: txt(root, "Title") || txt(root, "Name"), tasks, fields: Object.values(defs).filter(d => used.has(d.id)).map(d => ({ id: d.id, label: d.alias ? `${d.alias} (${d.name})` : d.name })) };
}

// Name rules, one per line: "keyword = STYLE" (case-insensitive; the first rule that matches wins)
export function parseRules(text) {
  return String(text || "").split(/\r?\n/).map(l => l.split("=")).filter(x => x.length === 2 && x[0].trim() && x[1].trim()).map(([k, v]) => [k.trim().toLowerCase(), v.trim().toUpperCase().replace(/\s+/g, "_")]);
}

// m: { ch_start, ch_end (field ids), ch_unit, style: "field:<id>" | "outline1" | "outline2" | "rules", rules, crew, track, include_milestones, skip_without_chainage }
export function toActivities(d, m, project, datasetId) {
  const styles = Object.fromEntries(project.styles.map(s => [s.code, s])), newStyles = [], acts = [];
  const rules = parseRules(m.rules), skipped = { no_chainage: 0, summary: 0, milestones: 0, no_dates: 0 };
  const val = (t, src) => (!src ? null : src === "outline1" ? t.path[0] || null : src === "outline2" ? t.path[1] || t.path[0] || null : src === "wbs" ? t.wbs : src === "name" ? t.name : t.ext[src] ?? null);
  for (const t of d.tasks) {
    if (t.summary) { skipped.summary++; continue; }
    if (t.milestone && m.include_milestones === false) { skipped.milestones++; continue; }
    let c0 = chainageToM(val(t, m.ch_start), m.ch_unit), c1 = chainageToM(val(t, m.ch_end), m.ch_unit);
    if (c0 == null && c1 == null) { if (m.skip_without_chainage !== false) { skipped.no_chainage++; continue; } c0 = c1 = project.chainage.start_m; }
    if (c0 == null) c0 = c1; if (c1 == null) c1 = c0;
    if (!t.start || !t.finish) { skipped.no_dates++; continue; }
    let s = parseT(t.start.slice(0, 16)), f = parseT(t.finish.slice(0, 16));
    // MS Project finishes at the end of the working day (17:00); show the day as finished at midnight
    if (new Date(f).getUTCHours() >= 12) f = Math.ceil(f / DAY) * DAY;
    if (t.milestone) f = s;
    let raw = m.style === "rules" ? (rules.find(([k]) => t.name.toLowerCase().includes(k)) || [])[1] : val(t, m.style);
    const code = String(raw || (t.milestone ? "MILESTONE" : m.default_style || "MSP")).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "MSP";
    if (!styles[code]) {
      const kind = t.milestone ? "milestone" : /(^|_)CUT(_|$)/.test(code) ? "cut" : /(^|_)FILL(_|$)/.test(code) ? "fill" : Math.abs(c1 - c0) < 1e-6 ? "block" : "line";
      const st = makeStyle(code, String(raw || code).replace(/_/g, " "), kind, PALETTE[Object.keys(styles).length % PALETTE.length]);
      styles[code] = st; newStyles.push(st);
    }
    acts.push(makeActivity(datasetId, t.id || t.uid, t.name, fmtT(s), fmtT(f), c0, c1, code, {
      wbs: t.wbs, locked: true, crew: m.crew ? val(t, m.crew) || "" : "", track: m.track ? val(t, m.track) || "" : "",
      ms: { uid: t.uid, critical: t.critical } }));
    acts[acts.length - 1]._preds = t.preds;
  }
  const byUid = new Map(acts.map(a => [a.ms.uid, a]));
  for (const a of acts) { for (const l of a._preds || []) { const b = byUid.get(l.uid); if (b) (a.links ||= []).push({ code: b.code, type: l.type, lag_days: l.lag_days }); } delete a._preds; }
  return { activities: acts, new_styles: newStyles, skipped };
}
