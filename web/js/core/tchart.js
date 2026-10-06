// TurboChart .tchart import and export in the browser (field layout taken from TurboChart 2.4 files).
import { makeActivity, makeStyle, newId, newProject, parseT, fmtT, DAY } from "./model.js";

const ZERO = "00000000-0000-0000-0000-000000000000";
const gid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
function col(hex, a = 255) {
  const n = parseInt(String(hex || "#000000").replace("#", "").slice(0, 6).padEnd(6, "0"), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lin = c => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const r9 = v => Math.round(v * 1e9) / 1e9;
  return { A: a, B: b, G: g, R: r, ScA: Math.round((a / 255) * 1e7) / 1e7, ScB: r9(lin(b)), ScG: r9(lin(g)), ScR: r9(lin(r)) };
}
const hex = c => (c ? "#" + [c.R, c.G, c.B].map(v => (v || 0).toString(16).padStart(2, "0")).join("").toUpperCase() : "#000000");

// ---- time zones: TurboChart stores the real instant of local midnight
function offsetMin(tz, utcMs) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
    return (Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute) - Math.floor(utcMs / 60000) * 60000) / 60000;
  } catch (e) { return 600; }
}
function toTc(t, tz) {
  const wall = parseT(t);
  let utc = wall - offsetMin(tz, wall) * 60000;
  utc = wall - offsetMin(tz, utc) * 60000;
  const y = new Date(wall).getUTCFullYear(), std = Math.min(offsetMin(tz, Date.UTC(y, 0, 15)), offsetMin(tz, Date.UTC(y, 6, 15)));
  const sign = std >= 0 ? "+" : "-", a = Math.abs(std);
  return `/Date(${utc}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}${String(a % 60).padStart(2, "0")})/`;
}
function fromTc(s, tz) {
  const m = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(s || ""); if (!m) return null;
  const utc = +m[1];
  return fmtT(utc + offsetMin(tz, utc) * 60000);
}

// ------------------------------------------------------------------ export
export function exportTchart(p) {
  const tz = p.time.tz || "Australia/Melbourne", unit = p.chainage.unit, k = unit === "km" ? 1000 : 1, pos = m => Math.round((m / k) * 1e6) / 1e6;
  const black = col("#000000"), white = col("#FFFFFF"), grey = col("#808080"), clear = col("#FFFFFF", 0), ink = col("#18262B"), axis = col("#A9A9A9");
  const lib = [], vals = [];
  p.styles.forEach((s, i) => {
    const id = gid(), c = col(s.colour), block = s.kind === "block";
    const cv = { FontSize: Math.round(s.label.size || 11), Id: id, Legend: s.legend !== false, OrderCanvas: 1, OrderLegend: i + 1, PositionOffset: 0, ShowText: !!s.label.show,
      TextColour: black, TextHorzAlign: 0, TextVertAlign: 0, Transparency: 0, Visible: true };
    lib.push({ ChartValues: cv, Description: s.name, DistanceOffset: 10, EndShape: { FillColour: c, ShapeType: 0, Size: 10 }, FillColour: block ? c : white, FillLineColour: c,
      FillLineSpacing: 10, FillLineThickness: 2, FillType: block ? 1 : 0, FontSize: Math.round(s.label.size || 11), Id: id, Legend: s.legend !== false, LineColour: c,
      LineStyle: (s.dash || "solid") === "solid" ? 0 : 1, LineThickness: s.width || 2, Name: s.code, OrderCanvas: 1, OrderLegend: i + 1, PositionOffset: 0, ShowText: !!s.label.show,
      StartShape: { FillColour: c, ShapeType: 0, Size: 10 }, TextColour: black, TextHorzAlign: 0, TextVertAlign: 0, TimeOffset: 20,
      Transparency: block ? Math.round((1 - (s.fill_opacity ?? 0.35)) * 100) / 100 : 0, Type: block ? 1 : 0, Visible: true });
    vals.push({ Key: id, Value: cv });
  });
  const dsIds = Object.fromEntries(p.datasets.map(d => [d.id, gid()]));
  const tasks = p.activities.filter(a => dsIds[a.dataset]).map(a => ({ CalendarCode: "", Critical: !!(a.p6 || {}).driving, DataSetId: dsIds[a.dataset], Description: a.name,
    EndPosition: pos(a.ch1_m), ExternalId: (a.p6 || {}).task_id || null, FilterCode: a.wbs || "", FinishDate: toTc(a.finish, tz), Id: gid(), LocationCode: "", Name: a.code,
    Order: 0, ShapeCode: a.style, ShowText: null, SourceTask: null, StartDate: toTc(a.start, tz), StartPosition: pos(a.ch0_m) }));
  const loc = (name, text, s, e, row, rot, fg) => ({ Background: clear, BorderLineColour: grey, BorderLineThickness: 1, EndLineColour: grey, EndLineStyle: 0, EndLineThickness: 0,
    EndPosition: e, FontSize: row <= 2 ? 12 : 9, Id: gid(), Name: name, NewVersion: true, Rotate: rot, Row: row, StartLineColour: grey, StartLineStyle: 0, StartLineThickness: 1,
    StartPosition: s, Text: text, TextColour: fg });
  const types = Object.fromEntries(p.location_types.map(t => [t.id, t]));
  const locs = p.sections.map((s, i) => loc(`S${i + 1}`, s.name, pos(Math.min(s.from_m, s.to_m)), pos(Math.max(s.from_m, s.to_m)), 1, false, black));
  const minW = (p.chainage.end_m - p.chainage.start_m) / 2000;
  p.locations.slice().sort((a, b) => a.ch_m - b.ch_m).forEach((l, i) => {
    const t = types[l.type] || { colour: "#5D6B70", row: 4 }, row = 1 + (l.row || t.row || 4);
    const [s, e] = l.to_m != null ? [l.ch_m, l.to_m] : [l.ch_m - minW, l.ch_m + minW];
    locs.push(loc(`L${String(i + 1).padStart(3, "0")}`, l.name, pos(s), pos(e), row, row >= 3, col(t.colour)));
  });
  const hl = (name, text, s, e, d0, d1, hx, op, fill = 0) => ({ EndPosition: e, FillColour: col(hx), FillLineColour: col(hx), FillLineSpacing: 6, FillLineThickness: 1, FillType: fill,
    FinishDate: d1, Id: ZERO, LineColour: col(hx), LineStyle: 0, LineThickness: 1, Name: name, NewVersion: true, Opacity: op, RotateText: d0 == null, ShowTextLeft: true,
    ShowTextRight: false, StartDate: d0, StartPosition: s, Text: text, TextColour: col(hx), TextOffset: 0, TextSize: 12 });
  const hls = [];
  p.locations.forEach((l, i) => { const t = types[l.type] || {}; if (l.grid ?? t.grid) hls.push(hl(`LG${i + 1}`, l.name, pos(l.ch_m), l.to_m != null ? pos(l.to_m) : null, null, null, t.colour || "#5D6B70", 0.15)); });
  p.time_markers.forEach((m, i) => {
    const fin = m.finish || fmtT(parseT(m.start) + DAY);
    hls.push(hl(`TM${i + 1}`, m.label, pos(m.ch0_m ?? p.chainage.start_m), pos(m.ch1_m ?? p.chainage.end_m), toTc(m.start, tz), toTc(fin, tz), m.colour || "#808080",
      m.kind === "milestone" ? 0.6 : 0.25, m.kind === "shutdown" ? 2 : 0));
  });
  const hi = p.header_image || {}, im = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(hi.data || "");
  const full = hi.fit === "full";
  const top = im ? { FitTopImage: full, ImageBase64: im[2], ShowTopImage: hi.show !== false, TopImageStartPosition: full ? 0 : pos(hi.ch_start_m ?? p.chainage.start_m),
    TopImageEndPosition: full ? 0 : pos(hi.ch_end_m ?? p.chainage.end_m), MaxImagePercentage: 30 }
    : { FitTopImage: false, ImageBase64: null, ShowTopImage: false, TopImageStartPosition: 0, TopImageEndPosition: 0, MaxImagePercentage: 20 };
  const t0 = p.time.start + "T00:00", t1 = fmtT(parseT(p.time.finish) + DAY), cLo = pos(p.chainage.start_m), cHi = pos(p.chainage.end_m);
  const chart = (name, ds1, ds2) => ({ AllowDragging: false, AllowTaskCreation: false, Annotations: [], ChartName: name, ChartSpecificShapeValues: vals, CriticalityColour: col("#FF0000"),
    CriticalityOpacity: 0.9, CriticalityThickness: 4, CustomPageHeight: 0, CustomPageWidth: 0, DataSet1Id: ds1, DataSet2Blend: ds2 ? 0.2 : 0, DataSet2Colour: grey, DataSet2Id: ds2 || ZERO,
    DataSet2Offset: 0, DataSet2Transparency: ds2 ? 0.6 : 0.5, DataSet3Blend: 0, DataSet3Colour: col("#008000"), DataSet3Id: ZERO, DataSet3Offset: 0, DataSet3Transparency: 0.5,
    EndFilter: toTc(t1, tz), EndPosition: cHi, FitToScreen: true, HideCalendars: false, HideTasks: false, HighLighters: hls, Id: gid(), ImagePath: null, IsPrintPreview: false,
    LineStyleMonth: 0, LineStylePosition: 0, LineStyleWeek: 0, LineStyleYear: 0, LocationRows: Array(10).fill(true), MonthTimelineAxisLineColour: col("#D9D9D9"),
    MonthTimelineThickness: 1, PositionAxisColour: white, PositionAxisFontSize: 12, PositionAxisLineColour: axis, PositionAxisTextColour: ink, PositionLineThickness: 1,
    PositionScaleUnits: pos(p.chainage.major_m), ReverseDates: p.time.orientation === "up", ReversePosition: !!p.chainage.reverse, RotateChart: false, Show1: true, Show2: !!ds2,
    Show3: false, ShowAnnotations: true, ShowCritcal: false, ShowCritcal2: false, ShowCritcal3: false, ShowDataSetText2: false, ShowDataSetText3: false, ShowHighlighters: true,
    ShowLegend: true, ShowLocationGridBottom: false, ShowLocationGridTop: true, ShowPositionBottom: true, ShowPositionTop: false, ShowTimelineLeft: true, ShowTimelineRight: true,
    ShowWeekNumber: true, StartFilter: toTc(t0, tz), StartPosition: cLo, StartWeek: 0, TimeScaleUnits: 2, TimelineAxisColour: white, TimelineAxisFontSize: 12,
    TimelineAxisTextColour: ink, WeekTimelineAxisLineColour: axis, WeekTimelineThickness: 1, YearTimelineAxisLineColour: col("#404040"), YearTimelineThickness: 2, Zoom: 1, ...top });
  const charts = p.datasets.map(d => chart(d.name, dsIds[d.id]));
  const cmp = p.view.compare_dataset;
  if (cmp && dsIds[cmp]) {
    const nm = id => (p.datasets.find(d => d.id === id) || {}).name || "";
    charts.push(chart(`Compare - ${nm(p.view.main_dataset)} over ${nm(cmp)}`, dsIds[p.view.main_dataset], dsIds[cmp]));
  }
  const box = (ID, o = {}) => ({ BackColour: clear, Bold: false, FillLineColour: black, FillLineSpacing: 10, FillLineThickness: 2, FillType: 0, FontName: "Arial", FontSize: 40,
    Height: "__NaN__", HorizontalAlignment: 2, ID, ImageBase64: null, Italic: false, LineColour: black, LineThickness: 0, Margin: { Bottom: 0, Left: 0, Right: 0, Top: 0 }, Radius: 0,
    Text: "", TextAlignment: 2, TextColour: black, TextVerticalAlignment: 1, Underline: false, VerticalAlignment: 3, Width: "__NaN__", ...o });
  const doc = {
    ActiveChartId: charts[0] ? charts[0].Id : ZERO, Calendars: [], Charts: charts,
    DataSets: p.datasets.map(d => ({ AstaPP: null, Id: dsIds[d.id], MSP: null, Name: d.name, P6OPC: null, P6WS: null, P6WSRest: null, Primavera: null, Safran: null, SourceDataType: 0 })),
    Filters: [], Graphics: [], HighLighters: null, Library: lib, Locations: locs,
    PageLayout: { Chart: box("CHART", { HorizontalAlignment: 3, Margin: { Bottom: 0, Left: 0, Right: 500, Top: 100 } }), CustomPageHeight: 0, CustomPageWidth: 0,
      IsPortrait: p.page.orientation === "portrait", Legend: box("LEGEND", { FontSize: 20, Margin: { Bottom: 300, Left: 0, Right: 0, Top: 100 }, Width: 500 }),
      PageGraphics: [box(gid(), { Bold: true, Height: 100, HorizontalAlignment: 3, Margin: { Bottom: 0, Left: 0, Right: 500, Top: 0 }, Text: p.meta.title || p.name, VerticalAlignment: 0, TextColour: ink })],
      PageMargin: { Bottom: 10, Left: 10, Right: 10, Top: 10 }, PaperSize: { A4: 9, A3: 8, A2: 66, A1: 0, Letter: 1, Ledger: 3 }[p.page.paper] ?? 8 },
    PositionPrefix: p.chainage.prefix || null, PositionSuffix: " " + unit,
    Properties: [{ Key: "ProjectTitle", Value: p.meta.title || p.name }, { Key: "ProjectOwner", Value: p.meta.client || "" }, { Key: "Author", Value: p.meta.author || "" },
      { Key: "DataDate", Value: p.meta.data_date || "Undefined" }, { Key: "Revision", Value: p.meta.revision || "" }],
    Tasks: tasks,
    ViewOptions: { AllowDragging: false, AllowTaskCreation: false, ChartName: "Chart1", CustomPageHeight: 0, CustomPageWidth: 0, DataSet1Id: ZERO, DataSet2Colour: grey, DataSet2Id: ZERO,
      DataSet2Transparency: 0.5, DataSet3Colour: col("#008000"), DataSet3Id: ZERO, DataSet3Transparency: 0.5, EndFilter: toTc(t1, tz), EndPosition: cHi, FitToScreen: true,
      HideChartImage: false, Id: gid(), ImageBase64: null, ImagePath: null, IsPrintPreview: false, PositionScaleUnits: pos(p.chainage.major_m), ReversePosition: !!p.chainage.reverse,
      Show1: true, Show2: false, Show3: false, ShowCritcal: false, ShowLegend: true, ShowPositionBottom: true, ShowPositionTop: false, ShowTimelineLeft: true, ShowTimelineRight: true,
      StartFilter: toTc(t0, tz), StartPosition: cLo, StartWeek: 0, TimeScaleUnits: 2, Zoom: 1 },
  };
  return JSON.stringify(doc).replace(/"__NaN__"/g, "NaN");
}

// ------------------------------------------------------------------ import
function imgInfo(b64) {
  const bin = atob(b64.slice(0, 160000).replace(/[^A-Za-z0-9+/]/g, "").slice(0, Math.floor(Math.min(b64.length, 160000) / 4) * 4));
  const b = i => bin.charCodeAt(i), be = (i, n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + b(i + k); return v; };
  if (bin.startsWith("\x89PNG")) return ["png", be(16, 4), be(20, 4)];
  if (b(0) === 0xff && b(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bin.length && b(i) === 0xff) { const mk = b(i + 1), seg = be(i + 2, 2); if (mk >= 0xc0 && mk <= 0xc2) return ["jpeg", be(i + 7, 2), be(i + 5, 2)]; i += 2 + seg; }
    return ["jpeg", 1000, 200];
  }
  return ["png", 1000, 200];
}

export function importTchart(text, unitHint = "auto", tz = "Australia/Melbourne") {
  const doc = JSON.parse(String(text).replace(/^﻿/, "").replace(/\bNaN\b/g, "null"));
  const suffix = String(doc.PositionSuffix || "").trim().toLowerCase();
  const unit = unitHint === "m" || unitHint === "km" ? unitHint : suffix === "km" ? "km" : "m", k = unit === "km" ? 1000 : 1;
  const title = ((doc.Properties || []).find(x => x.Key === "ProjectTitle") || {}).Value || "TurboChart import";
  const c0 = (doc.Charts || [{}])[0] || {};
  const p = newProject(title, "other", (c0.StartPosition || 0) * k, (c0.EndPosition || 1000) * k, null, null, unit);
  p.meta.title = title;
  p.datasets = (doc.DataSets || []).map(d => ({ id: newId("ds_"), name: d.Name || "Data set", source: "tchart", tc_id: d.Id }));
  if (!p.datasets.length) p.datasets = [{ id: newId("ds_"), name: "Main", source: "tchart", tc_id: "" }];
  const byTc = Object.fromEntries(p.datasets.map(d => [d.tc_id, d.id]));
  p.view.main_dataset = byTc[c0.DataSet1Id] || p.datasets[0].id;
  if (c0.Show2 && byTc[c0.DataSet2Id]) p.view.compare_dataset = byTc[c0.DataSet2Id];
  p.styles = (doc.Library || []).map(l => { const s = makeStyle(l.Name || "S", l.Description || l.Name || "", l.Type === 1 ? "block" : "line", hex(l.LineColour));
    s.width = l.LineThickness || s.width; s.dash = l.LineStyle ? "dash" : "solid"; s.label.show = !!l.ShowText; return s; });
  const known = new Set(p.styles.map(s => s.code)), times = [];
  for (const t of doc.Tasks || []) {
    const s = fromTc(t.StartDate, tz), f = fromTc(t.FinishDate, tz); if (!s || !f) continue;
    const code = t.ShapeCode || "TC";
    if (!known.has(code)) { p.styles.push(makeStyle(code, code, "line", "#1F6E8C")); known.add(code); }
    p.activities.push(makeActivity(byTc[t.DataSetId] || p.datasets[0].id, t.Name || "", t.Description || "", s, f, (t.StartPosition || 0) * k, (t.EndPosition || 0) * k, code, { wbs: t.FilterCode || "" }));
    times.push(s, f);
  }
  if (times.length) { times.sort(); p.time.start = times[0].slice(0, 10); p.time.finish = times.at(-1).slice(0, 10); }
  p.location_types.push({ id: "tc", name: "TurboChart location", symbol: "band", colour: "#5D6B70", row: 2, grid: false });
  for (const l of doc.Locations || []) {
    const a = (l.StartPosition || 0) * k, b = (l.EndPosition ?? l.StartPosition ?? 0) * k;
    if (l.Row === 1) p.sections.push({ id: newId("s_"), name: l.Text || l.Name || "", from_m: a, to_m: b });
    else p.locations.push({ id: newId("l_"), name: l.Text || l.Name || "", ch_m: a, to_m: Math.abs(b - a) > 1e-9 ? b : null, type: "tc", row: Math.max(1, (l.Row || 2) - 1), label: true, grid: false, notes: l.Name || "" });
  }
  for (const h of c0.HighLighters || []) if (h.StartDate) p.time_markers.push({ id: newId("t_"), label: h.Text || h.Name || "", kind: "band", start: fromTc(h.StartDate, tz),
    finish: fromTc(h.FinishDate, tz), ch0_m: h.StartPosition != null ? h.StartPosition * k : null, ch1_m: h.EndPosition != null ? h.EndPosition * k : null, colour: hex(h.FillColour) });
  const ic = (doc.Charts || []).find(c => c.ImageBase64);
  if (ic) {
    const [kind, w, hh] = imgInfo(ic.ImageBase64);
    const full = !!ic.FitTopImage || !((ic.TopImageEndPosition || 0) > (ic.TopImageStartPosition || 0));
    p.header_image = { data: `data:image/${kind};base64,${ic.ImageBase64}`, nat_w: w, nat_h: hh, name: "TurboChart top image", fit: full ? "full" : "chainage",
      ch_start_m: full ? null : ic.TopImageStartPosition * k, ch_end_m: full ? null : ic.TopImageEndPosition * k, height_px: null, opacity: 1, keep_ratio: false, show: ic.ShowTopImage !== false };
  }
  return p;
}
