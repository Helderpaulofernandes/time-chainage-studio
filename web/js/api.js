// Project storage and file import/export, all in the browser. No server is needed.
//
// Projects live in this browser's IndexedDB. A project can also be linked to a file on your PC
// (Chrome and Edge): every save is then written to that file too, so the file is always current.
import { newProject, normalise, newId, PRESETS, PAPER_MM } from "./core/model.js";
import * as XER from "./core/xer.js";
import { exportTchart, importTchart } from "./core/tchart.js";
import { importWorkbook } from "./core/excel.js";

const DB = "time-chainage-studio", VER = 1;
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" }); if (!d.objectStoreNames.contains("files")) d.createObjectStore("files"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(new Error("This browser blocked local storage, so projects cannot be kept. Try a normal (not private) window."));
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(store, mode), s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); });
}
const idbGet = (store, key) => tx(store, "readonly", s => s.get(key));
const idbPut = (store, val, key) => tx(store, "readwrite", s => (key === undefined ? s.put(val) : s.put(val, key)));
const idbDel = (store, key) => tx(store, "readwrite", s => s.delete(key));
const idbAll = store => tx(store, "readonly", s => s.getAll());

const conflict = msg => { const e = new Error(msg); e.status = 409; return e; };
const clone = o => JSON.parse(JSON.stringify(o));
const slug = s => String(s).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "project";

// ------------------------------------------------------------------ linked files (File System Access API)
export const filesSupported = typeof window !== "undefined" && "showSaveFilePicker" in window;
const JSON_TYPE = [{ description: "Time-Chainage Studio project", accept: { "application/json": [".json"] } }];
async function fileInfo(id) { return idbGet("files", id); } // { handle, name, written }
async function writeFile(id, p) {
  const f = await fileInfo(id); if (!f) return { linked: false };
  if ((await f.handle.queryPermission({ mode: "readwrite" })) !== "granted") return { linked: true, name: f.name, needsPermission: true };
  const disk = await f.handle.getFile();
  if (f.written && disk.lastModified > f.written + 2000) {
    // the file changed since we last wrote it (another PC through OneDrive, or another app)
    const other = JSON.parse(await disk.text());
    if ((other.rev || 0) > (p.rev || 0) - 1) throw conflict(`"${f.name}" was changed somewhere else since this window last saved it. Use File → Reload from file to get that version.`);
  }
  const w = await f.handle.createWritable(); await w.write(JSON.stringify(p, null, 1)); await w.close();
  const after = await f.handle.getFile();
  await idbPut("files", { ...f, written: after.lastModified }, id);
  return { linked: true, name: f.name, saved: true };
}

// ------------------------------------------------------------------ projects
export const api = {
  filesSupported,
  async presets() { return { disciplines: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, location_types: v.location_types, styles: v.styles }])), papers: PAPER_MM, date_fields: XER.DATE_FIELDS }; },
  async list() {
    const all = await idbAll("projects");
    const files = await Promise.all(all.map(p => fileInfo(p.id)));
    return all.map((p, i) => ({ id: p.id, name: p.name, discipline: p.discipline, activities: p.activities.length, modified: p.saved_at || 0, file: files[i] ? files[i].name : null }))
      .sort((a, b) => b.modified - a.modified);
  },
  async get(id) { const p = await idbGet("projects", id); if (!p) throw Object.assign(new Error("Project not found in this browser."), { status: 404 }); return normalise(p); },
  async put(p) { p = normalise(clone(p)); p.rev = (p.rev || 0) + 1; p.saved_at = Date.now(); await idbPut("projects", p); return p; },
  async create(body) {
    const p = newProject(body.name || "Untitled", body.discipline || "rail", +body.start_m || 0, +(body.end_m ?? 10000), body.start, body.finish, body.unit || "km");
    for (const k of ["meta", "chainage", "time"]) if (body[k]) Object.assign(p[k], body[k]);
    if (body.sections) p.sections = body.sections.map(s => ({ ...s, id: s.id || newId("s_") }));
    return api.put(p);
  },
  // Save refuses an out-of-date copy (another tab saved in between), then writes the linked file if there is one.
  async save(p) {
    const cur = await idbGet("projects", p.id);
    if (cur && (cur.rev || 0) !== (p.rev || 0)) throw conflict("This project was changed in another tab or window since you opened it. Reload the page to see the latest version.");
    const saved = await api.put(p);
    let file = { linked: false };
    try { file = await writeFile(saved.id, saved); } catch (e) { if (e.status === 409) { saved.file_conflict = e.message; } else file = { linked: true, error: e.message }; }
    return { ...saved, _file: file };
  },
  async remove(id) { await idbDel("projects", id); await idbDel("files", id); },
  async duplicate(id) { const p = await api.get(id); p.id = newId("prj_"); p.name += " (copy)"; p.rev = 0; return api.put(p); },

  // ---- linked file
  async fileStatus(id) { const f = await fileInfo(id); if (!f) return null; return { name: f.name, permission: await f.handle.queryPermission({ mode: "readwrite" }) }; },
  async linkNewFile(p) {
    const handle = await window.showSaveFilePicker({ suggestedName: `${slug(p.name)}.tcs.json`, types: JSON_TYPE });
    await idbPut("files", { handle, name: handle.name, written: 0 }, p.id);
    const r = await writeFile(p.id, p);
    return { name: handle.name, ...r };
  },
  async reconnect(id) { const f = await fileInfo(id); if (!f) return false; return (await f.handle.requestPermission({ mode: "readwrite" })) === "granted"; },
  async unlink(id) { await idbDel("files", id); },
  // Open a project file from disk and keep it linked, so later changes save back into it.
  async openFile() {
    const [handle] = await window.showOpenFilePicker({ types: JSON_TYPE, multiple: false });
    const file = await handle.getFile();
    const p = normalise(JSON.parse(await file.text()));
    if (!p.id || !p.activities) throw new Error("That file is not a Time-Chainage Studio project.");
    const local = await idbGet("projects", p.id);
    p.rev = Math.max(p.rev || 0, local ? local.rev || 0 : 0);
    const saved = await api.put(p);
    await idbPut("files", { handle, name: handle.name, written: file.lastModified }, saved.id);
    return saved;
  },
  async reloadFromFile(id) {
    const f = await fileInfo(id); if (!f) throw new Error("This project is not linked to a file.");
    if ((await f.handle.queryPermission({ mode: "read" })) !== "granted" && (await f.handle.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("Permission to read the file was not given.");
    const file = await f.handle.getFile(), p = normalise(JSON.parse(await file.text()));
    p.id = id; const local = await idbGet("projects", id); p.rev = (local ? local.rev || 0 : 0);
    const saved = await api.put(p);
    await idbPut("files", { ...f, written: file.lastModified }, id);
    return saved;
  },

  // ---- imports
  async importExcel(file, discipline) { if (typeof XLSX === "undefined") throw new Error("The Excel reader did not load. Check the internet connection and reload the page.");
    const p = await importWorkbook(await file.arrayBuffer(), discipline); p.name = file.name.replace(/\.[^.]+$/, ""); return api.put(p); },
  async importTchart(file, unit) { let p; try { p = importTchart(await file.text(), unit); } catch (e) { throw new Error("Could not read that TurboChart file: " + e.message); } p.name = file.name.replace(/\.[^.]+$/, ""); return api.put(p); },
  // A ready-made example: always saved as a new project of your own.
  async fromTemplate(obj) { const p = normalise(JSON.parse(JSON.stringify(obj))); p.id = newId("prj_"); p.rev = 0; return api.put(p); },
  async importJson(file) { const p = normalise(JSON.parse(await file.text())); if (!p.activities) throw new Error("That file is not a Time-Chainage Studio project."); p.id = newId("prj_"); p.rev = 0; return api.put(p); },

  // ---- P6
  _xer: new Map(),
  async p6Inspect(file) {
    const x = XER.parse(new Uint8Array(await file.arrayBuffer())), token = newId("u"); api._xer.set(token, x);
    const d = XER.describe(x); return { token, file: file.name, describe: d, suggested: XER.suggestMapping(d) };
  },
  async p6Codes(token, type) { const x = api._xer.get(token); return ((x.tables.ACTVCODE || {}).rows || []).filter(r => r.actv_code_type_id === type).map(v => ({ id: v.actv_code_id, short_name: v.short_name, name: v.actv_code_name })); },
  async p6Preview({ token, mapping }) {
    const res = XER.applyMapping(api._xer.get(token), mapping, newProject("preview"), "preview");
    return { count: res.activities.length, skipped: res.skipped, styles: res.new_styles.map(s => s.code),
      rows: res.activities.slice(0, 40).map(a => ({ code: a.code, name: a.name, start: a.start, finish: a.finish, ch0_m: a.ch0_m, ch1_m: a.ch1_m, style: a.style, wbs: a.wbs })) };
  },
  async p6Import(body) {
    const x = api._xer.get(body.token), m = body.mapping;
    let p;
    if (body.project_id) p = await api.get(body.project_id);
    else { const s = body.setup || {}; p = newProject(s.name || body.file || "P6 import", s.discipline || "rail", 0, 10000, null, null, s.unit || "km"); p.styles = []; p.datasets = []; }
    const ds = { id: newId("ds_"), name: m.dataset_name || body.file || "P6", source: "p6", mapping: m, last_sync: new Date().toISOString().slice(0, 19), source_file: body.file };
    p.datasets.push(ds);
    const res = XER.applyMapping(x, m, p, ds.id);
    p.styles.push(...res.new_styles); p.activities.push(...res.activities); p.p6 = { mapping: m };
    if (!body.project_id && res.activities.length) {
      const lo = Math.min(...res.activities.map(a => Math.min(a.ch0_m, a.ch1_m))), hi = Math.max(...res.activities.map(a => Math.max(a.ch0_m, a.ch1_m))), pad = Math.max((hi - lo) * 0.02, 10);
      p.chainage.start_m = lo - pad; p.chainage.end_m = hi + pad;
      p.time.start = res.activities.map(a => a.start).sort()[0].slice(0, 10); p.time.finish = res.activities.map(a => a.finish).sort().at(-1).slice(0, 10);
    }
    p.view.main_dataset = ds.id;
    const saved = body.project_id ? await api.save(p) : await api.put(p);
    return { project: saved, skipped: res.skipped, count: res.activities.length };
  },
  async p6Sync(id, body) {
    const p = await api.get(id), ds = p.datasets.find(d => d.id === body.dataset_id);
    if (!ds || !ds.mapping) throw new Error("That data set has no saved P6 mapping. Import it from P6 first.");
    const m = body.mapping || ds.mapping, report = XER.sync(p, api._xer.get(body.token), m, ds.id);
    if (body.apply === false) return { report, project: p };
    Object.assign(ds, { mapping: m, last_sync: new Date().toISOString().slice(0, 19), source_file: body.file || ds.source_file });
    return { report, project: await api.save(p) };
  },

  // ---- exports: { name, blob }
  async exportFile(p, kind, datasetId) {
    const dsn = (p.datasets.find(d => d.id === (datasetId || p.view.main_dataset)) || {}).name || "";
    if (kind === "xer") return { name: `${slug(p.name + "_" + dsn)}.xer`, blob: new Blob([XER.write(p, datasetId)], { type: "application/octet-stream" }) };
    if (kind === "tchart") return { name: `${slug(p.name)}.tchart`, blob: new Blob([exportTchart(p)], { type: "application/json" }) };
    return { name: `${slug(p.name)}.tcs.json`, blob: new Blob([JSON.stringify(p, null, 1)], { type: "application/json" }) };
  },
};
