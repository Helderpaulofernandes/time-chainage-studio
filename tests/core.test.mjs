// Automated checks for the browser app's core (no browser needed). Run from the repo root:  node --test tests/
// Uses made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../web/js/core/model.js";
import * as X from "../web/js/core/xer.js";
import * as T from "../web/js/core/tchart.js";
import * as MSP from "../web/js/core/mspdi.js";
import * as R from "../web/js/render.js";
import * as U from "../web/js/util.js";

// a small rail project with linked line activities
function project(n = 40) {
  const p = M.newProject("Test", "rail", 0, 20000, "2027-01-01", "2028-06-30", "km");
  const ds = p.datasets[0].id, codes = p.styles.map(s => s.code);
  for (let i = 0; i < n; i++) {
    const s = Date.UTC(2027, 0, 4) + i * 7 * 864e5, c0 = (i * 450) % 19000;
    const a = M.makeActivity(ds, "A" + (1000 + i * 10), "Activity " + i, M.fmtT(s), M.fmtT(s + (5 + (i % 9)) * 864e5), c0, c0 + 800, codes[i % codes.length]);
    if (i) a.links = [{ code: "A" + (1000 + (i - 1) * 10), type: i % 3 ? "FS" : "SS", lag_days: i % 4 }];
    p.activities.push(a);
  }
  return M.normalise(p);
}

test("a crafted project file cannot inject markup into the chart", () => {
  const p = project(3);
  p.styles[0].colour = '"/><image href="x" onerror="alert(1)';
  p.locations.push({ id: 'x" onclick="alert(2)', name: "<b>Loc</b>", ch_m: 100, type: p.location_types[0].id, label: true, colour: '"><script>alert(3)</script>' });
  p.header_image = { data: 'x" onload="alert(4)', show: true, fit: "full" };
  p.activities[0].id = 'a" onmouseover="alert(5)';
  p.styles[1].fill_pattern = '"><script>';
  M.normalise(p);
  const svg = R.renderChart(p, { width: 1200, interactive: true }).svg;
  for (const bad of ["onerror=", "onclick=", "onload=", "onmouseover=", "<script", "<b>Loc"]) assert.ok(!svg.includes(bad), `found ${bad}`);
  assert.equal(p.styles[0].colour, "#1F6E8C");
  assert.equal(p.header_image, null);
});

test("sanitising keeps good values", () => {
  const p = project(2);
  p.styles[0].colour = "#abc"; p.styles[0].fill_colour = "#112233"; p.notes = [{ id: "n_1", text: "Hi", ch_m: "1200", at: "2027-02-01T00:00", colour: "#00FF00" }];
  M.normalise(p);
  assert.equal(p.styles[0].colour, "#aabbcc"); assert.equal(p.styles[0].fill_colour, "#112233");
  assert.equal(p.notes[0].ch_m, 1200); assert.equal(p.notes[0].colour, "#00FF00");
});

test("chart geometry: X and its inverse agree, with breaks and reversed chainage", () => {
  for (const reverse of [false, true]) {
    const p = project(5); p.chainage.reverse = reverse; p.chainage.breaks = [{ from_m: 5000, to_m: 9000 }, { from_m: 14000, to_m: 15000 }];
    const G = R.geometry(p, { width: 1400 });
    for (const m of [0, 1234, 4999, 9000, 12000, 15000, 19999]) assert.ok(Math.abs(G.Xi(G.X(m)) - m) < 0.01, `m=${m} reverse=${reverse}`);
    assert.ok(Math.abs(G.X(9000) - G.X(5000)) < 25, "a break is squeezed to a narrow gap");
  }
});

test("chainage equations: shown, typed and stored values agree", () => {
  const p = project(1); p.chainage.equations = [{ at_m: 6000, value_m: 6500 }];
  assert.equal(U.chFmt(p, 7000), "7.500");
  assert.equal(U.mToCh(p, 7000), 7.5);
  assert.equal(U.chToM(p, "7.5"), 7000);
  assert.equal(U.chToM(p, "5"), 5000);
  assert.equal(U.chToM(p, "7.5", true), 7500);
});

test("XER: export and re-import keeps activities, chainage and logic links", () => {
  const p = project(), bytes = X.write(p, p.datasets[0].id), x = X.parse(bytes);
  const q = M.newProject("Back"), m = { ...X.suggestMapping(X.describe(x)), skip_without_chainage: false };
  const r = X.applyMapping(x, m, q, q.datasets[0].id);
  assert.equal(r.activities.length, p.activities.length);
  const links = a => a.reduce((n, b) => n + (b.links || []).length, 0);
  assert.equal(links(r.activities), links(p.activities));
  const a0 = p.activities[5], b0 = r.activities.find(a => a.code === a0.code);
  assert.ok(Math.abs(b0.ch0_m - a0.ch0_m) < 0.02 && Math.abs(b0.ch1_m - a0.ch1_m) < 0.02);
  assert.equal(b0.start, a0.start);
});

test("P6 sync keeps what was set in the app (crew, line, side column, tapered finish)", () => {
  const p = project(), ds = p.datasets[0].id, x = X.parse(X.write(p, ds));
  const m = { ...X.suggestMapping(X.describe(x)), skip_without_chainage: false };
  const q = M.newProject("Synced"); q.datasets[0].id = ds; q.view.main_dataset = ds;
  q.activities = X.applyMapping(x, m, q, ds).activities;
  const a = q.activities[3]; Object.assign(a, { crew: "Crew B", track: "Up", col: "col_1", fin_ch0_m: 1, fin_ch1_m: 2 });
  X.sync(q, x, m, ds);
  const b = q.activities.find(z => z.code === a.code);
  assert.deepEqual([b.crew, b.track, b.col, b.fin_ch0_m, b.fin_ch1_m], ["Crew B", "Up", "col_1", 1, 2]);
});

test("TurboChart: export and re-import keeps the view, fill colours and saved views, quickly", () => {
  const p = project(2000);
  p.styles[0].kind = "block"; p.styles[0].fill_colour = "#EDF3F8";
  p.views = [{ id: "v_1", name: "Close-up", ch_from: 2000, ch_to: 6000, t_from: "2027-03-01", t_to: "2027-09-01", hidden_styles: [p.styles[2].code], orientation: "down" }];
  const t0 = performance.now(), txt = T.exportTchart(p), ms = performance.now() - t0;
  assert.ok(ms < 1500, `export took ${Math.round(ms)} ms`);
  const q = M.normalise(T.importTchart(txt));
  assert.equal(q.activities.length, 2000);
  assert.equal(q.styles.find(s => s.code === p.styles[0].code).fill_colour, "#EDF3F8");
  const v = q.views.find(x => x.name === "Close-up");
  assert.ok(v && v.ch_from === 2000 && v.ch_to === 6000 && v.hidden_styles.includes(p.styles[2].code));
});

test("MS Project: styles from task names, cut and fill kinds, links with lag", () => {
  const d = { name: "t", fields: [], tasks: [
    { uid: "1", id: "1", name: "Zone 1 - Excavate cut to fill", level: 2, path: ["Zone 1"], start: "2026-03-02T08:00:00", finish: "2026-04-10T17:00:00", milestone: false, summary: false, ext: { s: "0", e: "4000" }, preds: [] },
    { uid: "2", id: "2", name: "Zone 1 - Haul fill", level: 2, path: ["Zone 1"], start: "2026-04-13T08:00:00", finish: "2026-05-22T17:00:00", milestone: false, summary: false, ext: { s: "4000", e: "9000" }, preds: [{ uid: "1", type: "FS", lag_days: 1 }] }] };
  const p = M.newProject("m", "road", 0, 13000, null, null, "ft");
  const r = MSP.toActivities(d, { ch_start: "s", ch_end: "e", ch_unit: "ft", style: "rules", rules: "excavate cut = CUT\nhaul fill = FILL" }, p, "ds");
  assert.deepEqual(r.new_styles.map(s => s.code + ":" + s.kind), ["CUT:cut", "FILL:fill"]);
  assert.deepEqual(r.activities[1].links, [{ code: "1", type: "FS", lag_days: 1 }]);
  assert.equal(r.activities[0].finish, "2026-04-11T00:00");
});

test("the chart draws every layer without broken numbers", () => {
  const p = project(60), acts = p.activities;
  p.styles[0].kind = "taper"; p.styles[1].kind = "cut"; p.styles[1].fill_pattern = "crosshatch"; p.styles[2].marks = "arrow";
  p.chainage.breaks = [{ from_m: 8000, to_m: 9000 }]; p.chainage.equations = [{ at_m: 12000, value_m: 12500 }]; p.chainage.repeat_days = 90;
  p.time.month_side = "both"; p.time.period_labels = "years";
  p.side_cols = [{ id: "c1", name: "Design", side: "left", width: 80 }]; acts[0].col = "c1";
  p.notes = [{ id: "n1", text: "Note", ch_m: 3000, at: acts[4].start, angle: 10 }];
  p.hauls = [{ id: "h1", from0_m: 1000, from1_m: 2000, to0_m: 5000, to1_m: 6000, at: acts[6].start, label: "Haul" }];
  p.progress_lines = [{ id: "pl", name: "As built", points: [[acts[0].start, 0], [acts[3].start, 900]] }];
  p.bands = [{ id: "b1", kind: "profile", position: "above", data: "0,10,11\n5,14,12\n10,9,10" }, { id: "b2", kind: "extents", position: "below", data: "P1,0,8\nP2,9,20" },
    { id: "b3", kind: "quantities", position: "below", data: "from,to,Cut\n0,5,1000\n5,10,2000" }, { id: "b4", kind: "plan", position: "above" }, { id: "b5", kind: "strip", position: "below", data: "0,10,Plain" }];
  p.resources = { panel: { show: true, table: true }, series: [{ id: "r", name: "Labour", colour: "#ED7D31", values: { "2027-01-04": 300, "2027-01-11": 200 } }] };
  p.view.show_links = true; p.view.show_crews = true; acts.forEach(a => (a.crew = "A"));
  M.normalise(p);
  const svg = R.renderChart(p, { width: 1500, interactive: true }).svg;
  assert.ok(!/NaN|undefined|Infinity/.test(svg), "no NaN / undefined / Infinity in the drawing");
  assert.ok(svg.includes("Design") && svg.includes("Haul") && svg.includes("As built"));
});

test("MS Project update matches tasks by unique ID and keeps what was set in the app", () => {
  const task = (uid, id, name, s, f) => ({ uid, id, name, level: 1, path: [], start: s, finish: f, milestone: false, summary: false, ext: { s: "0", e: "1000" }, preds: [] });
  const m = { ch_start: "s", ch_end: "e", ch_unit: "m", style: "rules", rules: "dig = CUT" };
  const p = M.newProject("m"), ds = p.datasets[0].id;
  p.activities = MSP.toActivities({ tasks: [task("7", "1", "Dig", "2026-03-02T08:00", "2026-03-10T17:00"), task("8", "2", "Lay", "2026-03-11T08:00", "2026-03-20T17:00")] }, m, p, ds).activities;
  p.activities[0].crew = "Crew 1"; p.activities[0].label = { show: false };
  // a task inserted at the top renumbers the IDs; the second task is gone; the first moved a day
  const r = MSP.sync(p, { tasks: [task("9", "1", "New", "2026-03-01T08:00", "2026-03-02T17:00"), task("7", "2", "Dig", "2026-03-03T08:00", "2026-03-10T17:00")] }, m, ds);
  assert.deepEqual([r.added.length, r.changed.length, r.removed.length], [1, 1, 1]);
  const dig = p.activities.find(a => a.ms.uid === "7");
  assert.deepEqual([dig.code, dig.start, dig.crew, dig.label.show], ["2", "2026-03-03T08:00", "Crew 1", false]);
});
