// Thin client for the Time-Chainage Studio API.
async function req(method, url, body, isForm) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    if (isForm) opt.body = body;
    else { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
  }
  const r = await fetch(url, opt);
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const j = await r.json(); msg = j.detail ? (typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail)) : msg; } catch (e) { /* not JSON */ }
    throw new Error(msg);
  }
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : r.blob();
}
const form = (file, extra = {}) => { const f = new FormData(); f.append("file", file); for (const [k, v] of Object.entries(extra)) f.append(k, v); return f; };

export const api = {
  presets: () => req("GET", "/api/presets"),
  list: () => req("GET", "/api/projects"),
  get: id => req("GET", `/api/projects/${id}`),
  create: body => req("POST", "/api/projects", body),
  save: p => req("PUT", `/api/projects/${p.id}`, p),
  remove: id => req("DELETE", `/api/projects/${id}`),
  duplicate: id => req("POST", `/api/projects/${id}/duplicate`),
  importExcel: (file, discipline) => req("POST", "/api/import/excel", form(file, { discipline }), true),
  importTchart: (file, unit) => req("POST", "/api/import/tchart", form(file, { unit }), true),
  importJson: file => req("POST", "/api/import/json", form(file), true),
  p6Inspect: file => req("POST", "/api/p6/inspect", form(file), true),
  p6Codes: (token, type) => req("POST", `/api/p6/codes/${token}/${type}`),
  p6Preview: body => req("POST", "/api/p6/preview", body),
  p6Import: body => req("POST", "/api/p6/import", body),
  p6Sync: (id, body) => req("POST", `/api/projects/${id}/p6/sync`, body),
  exportUrl: (id, kind, q = "") => `/api/projects/${id}/export/${kind}${q}`,
};
