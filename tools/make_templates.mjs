// Builds the example projects in web/templates/. Run: node tools/make_templates.mjs
// All names and figures are made up; nothing comes from a real tender.
import { writeFileSync, mkdirSync } from "node:fs";
import { newProject, makeStyle, makeActivity, newId } from "../web/js/core/model.js";

const OUT = new URL("../web/templates/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const km = v => Math.round(v * 1000 * 1000) / 1000; // km -> m
const d = s => s + "T00:00";
const next = s => { const t = new Date(s + "T00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10) + "T00:00"; }; // finish is exclusive
const loc = (name, ch, type, extra = {}) => ({ id: newId("l_"), name, ch_m: km(ch), to_m: extra.to != null ? km(extra.to) : null, type, row: null,
  label: extra.label ?? true, grid: extra.grid ?? undefined, notes: extra.notes || "" });
const sec = (name, a, b) => ({ id: newId("s_"), name, from_m: km(a), to_m: km(b) });
const mk = (label, kind, start, finish, colour, c0, c1) => ({ id: newId("t_"), label, kind, start: d(start), finish: finish ? next(finish) : null,
  ch0_m: c0 != null ? km(c0) : null, ch1_m: c1 != null ? km(c1) : null, colour });
function act(p, ds, code, name, style, c0, c1, s, f, extra = {}) {
  const a = makeActivity(ds, code, name, d(s), next(f), km(c0), km(c1), style, extra);
  const days = (Date.parse(f) - Date.parse(s)) / 864e5 + 1, len = Math.abs(km(c1) - km(c0));
  if (len > 1 && !extra.qty) { a.qty = Math.round(len); a.qty_unit = "m"; a.rate = Math.round((len / days) * 10) / 10; a.rate_unit = "m/day"; }
  p.activities.push(a);
  return a;
}
const save = (name, p) => { p.rev = 0; writeFileSync(new URL(name, OUT), JSON.stringify(p, null, 1)); console.log("wrote", name, p.activities.length, "activities"); };

// ------------------------------------------------------------------ rail: re-sleepering with two staging options
{
  const p = newProject("Example rail re-sleepering", "rail", km(98), km(162), "2027-02-01", "2027-12-24", "km");
  Object.assign(p.meta, { title: "Example Line – re-sleepering", subtitle: "Example project · made-up data · two staging options to compare", client: "Example Rail Co", contract: "EX-001", revision: "A" });
  Object.assign(p.chainage, { major_m: 10000, minor_m: 2000, prefix: "CH" });
  p.time.px_per_day = 2.4;
  p.sections = [sec("Ashford – Bell Creek", 100, 118.2), sec("Bell Creek – Cooper Jn", 118.2, 137.1), sec("Cooper Jn – Dale", 137.1, 160)];
  p.locations = [
    loc("Ashford", 100.0, "limit"), loc("Ashford station", 100.4, "station"), loc("Bell Creek loop", 117.8, "loop", { to: 118.6 }),
    loc("Cooper Junction loop", 136.6, "loop", { to: 137.6 }), loc("Dale station", 159.6, "station"), loc("Dale", 160.0, "limit"),
    ...[[103.42, "Mill Rd"], [109.87, "Highway 1"], [114.05, "Quarry Ln"], [122.6, "Station St"], [128.31, "Creek Rd"], [133.92, "Ridge Rd"], [142.15, "Farm access"], [149.7, "Old Coach Rd"], [155.38, "Dale Rd"]]
      .map(([c, n]) => loc(n, c, "lx", { label: false })),
    ...[[106.1, 106.18], [125.4, 125.52], [146.8, 146.95]].map(([a, b], i) => loc(`Bridge ${i + 1}`, a, "bridge", { to: b, label: false })),
    loc("Box culvert", 131.25, "culvert", { label: false }), loc("Yard / laydown", 118.0, "zone", { to: 118.4, label: false }),
  ];
  p.styles = [
    makeStyle("SITE", "Site establishment", "block", "#548235"),
    makeStyle("SURVEY", "Survey & dilapidation", "line", "#7F7F7F", { dash: "dash" }),
    makeStyle("DRAIN", "Drainage – Crew A", "line", "#00B0F0"),
    makeStyle("RESLEEPER", "Re-sleepering", "line", "#002060", { width: 4, footprint: { enabled: true, length_m: 1500, lag_days: 2, opacity: 0.16 },
      label: { show: true, text: "{name} · {rate} m/day", follow_slope: true, position: "mid", side: "above", size: 11 } }),
    makeStyle("BALLAST", "Ballast, lift & tamp", "line", "#FFC000"),
    makeStyle("TAMP", "Final tamp & regulate", "line", "#92D050"),
    makeStyle("LXR", "Level crossing renewal", "block", "#C00000"),
    makeStyle("HANDOVER", "Certification & handover", "line", "#404040", { dash: "dot" }),
  ];
  const A = p.datasets[0]; A.name = "Option A – one front, Ashford to Dale";
  const B = { id: newId("ds_"), name: "Option B – two fronts from Cooper Jn", source: "manual" }; p.datasets.push(B);
  p.view.main_dataset = A.id; p.view.compare_dataset = B.id;
  for (const ds of [A.id, B.id]) {
    act(p, ds, "S10", "Survey & dilapidation", "SURVEY", 100, 160, "2027-02-08", "2027-03-14");
    act(p, ds, "M10", "Bell Creek yard establishment", "SITE", 117.9, 118.4, "2027-03-15", "2027-04-04");
    act(p, ds, "M20", "Cooper Jn yard establishment", "SITE", 136.9, 137.4, "2027-03-15", "2027-04-04");
    act(p, ds, "H10", "Final geometry run & certification", "HANDOVER", 100, 160, "2027-11-15", "2027-12-10");
  }
  // Option A: everything from Ashford to Dale, crews one behind the other
  act(p, A.id, "C10", "Drainage", "DRAIN", 100.2, 159.8, "2027-04-05", "2027-07-25");
  act(p, A.id, "C20", "Re-sleepering", "RESLEEPER", 100.2, 159.8, "2027-04-26", "2027-09-26");
  act(p, A.id, "C30", "Ballast, lift & tamp", "BALLAST", 100.2, 159.8, "2027-05-17", "2027-10-17");
  act(p, A.id, "C40", "Final tamp & regulate", "TAMP", 100.2, 159.8, "2027-06-07", "2027-11-07");
  // Option B: start at Cooper Jn, west leg first, then east leg
  act(p, B.id, "C10", "Drainage – west leg", "DRAIN", 137.0, 100.2, "2027-04-05", "2027-06-06");
  act(p, B.id, "C11", "Drainage – east leg", "DRAIN", 137.0, 159.8, "2027-06-14", "2027-07-25");
  act(p, B.id, "C20", "Re-sleepering – west leg", "RESLEEPER", 137.0, 100.2, "2027-04-26", "2027-07-11");
  act(p, B.id, "C21", "Re-sleepering – east leg", "RESLEEPER", 137.0, 159.8, "2027-07-19", "2027-09-19");
  act(p, B.id, "C30", "Ballast, lift & tamp – west leg", "BALLAST", 137.0, 100.2, "2027-05-17", "2027-08-01");
  act(p, B.id, "C31", "Ballast, lift & tamp – east leg", "BALLAST", 137.0, 159.8, "2027-08-09", "2027-10-10");
  act(p, B.id, "C40", "Final tamp – west leg", "TAMP", 137.0, 100.2, "2027-06-07", "2027-08-22");
  act(p, B.id, "C41", "Final tamp – east leg", "TAMP", 137.0, 159.8, "2027-08-30", "2027-10-31");
  [[103.42, "2027-05-03"], [109.87, "2027-05-24"], [122.6, "2027-06-21"], [133.92, "2027-07-19"], [149.7, "2027-08-30"]].forEach(([c, s], i) => {
    for (const ds of [A.id, B.id]) { const e = new Date(s + "T00:00Z"); e.setUTCDate(e.getUTCDate() + 3);
      act(p, ds, `X${10 + i * 10}`, `LX renewal ${i + 1}`, "LXR", c - 0.25, c + 0.25, s, e.toISOString().slice(0, 10)); }
  });
  p.time_markers = [
    ...["2027-03-02", "2027-03-30", "2027-04-27", "2027-06-01", "2027-06-29", "2027-08-03", "2027-08-31"].map(s => { const e = new Date(s + "T00:00Z"); e.setUTCDate(e.getUTCDate() + 1);
      return mk("Freight possession window (no access)", "band", s, e.toISOString().slice(0, 10), "#BF8F00"); }),
    mk("Main possession starts", "milestone", "2027-04-05", null, "#C00000"),
    mk("Harvest restriction – east of Cooper Jn", "restriction", "2027-10-04", "2027-11-12", "#C26A12", 137.1, 160),
    mk("Practical completion", "milestone", "2027-12-17", null, "#C00000"),
  ];
  p.productivities = [
    { id: newId("p_"), activity: "Re-sleepering", resources: "Sleeper exchange machine + 2 excavators", rate_text: "3,000 sleepers/shift", rate: 3000, qty_text: "90,000 sleepers", qty: 90000, crew: "Crew S", shifts: 30 },
    { id: newId("p_"), activity: "Cess drain cleaning", resources: "Excavator + roller", rate_text: "750 m/shift", rate: 0.75, qty_text: "32 km", qty: 32, crew: "Crew A", shifts: 43 },
    { id: newId("p_"), activity: "Ballast, lift & tamp", resources: "Ballast train + tamper", rate_text: "2.0 km/day", rate: 2, qty_text: "60 km", qty: 60, crew: "Ballast", shifts: 30 },
  ];
  p.page.blocks.at(-1).text = "Example project with made-up data.\nOption A runs every crew from Ashford to Dale. Option B starts at Cooper Junction, works west first, then east.\nUse 'Compare with' to show one option greyed behind the other.\nRe-sleepering shows a footprint: 1.5 km behind the work front, occupied 2 days after it passes.";
  save("rail-resleepering.tcs.json", p);
}

// ------------------------------------------------------------------ road: highway upgrade
{
  const p = newProject("Example highway upgrade", "road", 0, km(12.4), "2027-03-01", "2028-07-31", "km");
  Object.assign(p.meta, { title: "Example Highway – duplication", subtitle: "Example project · made-up data", client: "Example Roads", contract: "EX-ROAD-02", revision: "A" });
  Object.assign(p.chainage, { major_m: 1000, minor_m: 250, prefix: "CH", decimals: 3, snap_m: 5 });
  p.time.px_per_day = 1.4;
  p.sections = [sec("Stage 1 – north", 0, 5.2), sec("Stage 2 – interchange", 5.2, 7.6), sec("Stage 3 – south", 7.6, 12.2)];
  p.locations = [loc("Project start", 0.0, "limit"), loc("Northern intersection", 0.85, "intersection"), loc("Creek bridge", 3.4, "bridge", { to: 3.56 }),
    loc("Main interchange", 6.1, "interchange", { to: 6.9 }), loc("Rail overpass", 9.15, "bridge", { to: 9.24 }), loc("Southern intersection", 11.6, "intersection"),
    loc("Project end", 12.2, "limit"), loc("Retaining wall RW1", 7.8, "wall", { to: 8.3, label: false }),
    ...[[1.9, "Gas main"], [4.75, "Water main"], [10.4, "Fibre"]].map(([c, n]) => loc(n, c, "utility", { label: false })),
    ...[[2.2], [5.4], [8.9], [10.9]].map(([c], i) => loc(`Culvert ${i + 1}`, c, "culvert", { label: false }))];
  p.styles = [
    makeStyle("CLEAR", "Clear & grub", "line", "#548235"),
    makeStyle("EARTH", "Bulk earthworks", "block", "#C65911", { fill_opacity: 0.3 }),
    makeStyle("DRAIN", "Drainage", "line", "#00B0F0"),
    makeStyle("SUBBASE", "Subbase", "line", "#7F7F7F", { footprint: { enabled: true, length_m: 400, lag_days: 0, opacity: 0.16 } }),
    makeStyle("BASE", "Basecourse", "line", "#404040"),
    makeStyle("ASPHALT", "Asphalt wearing course", "line", "#18262B", { width: 4 }),
    makeStyle("BRIDGE", "Bridge works", "block", "#6A4FA3"),
    makeStyle("TRAFFIC", "Traffic switch", "milestone", "#C00000"),
  ];
  const ds = p.datasets[0].id; p.datasets[0].name = "Baseline";
  act(p, ds, "R100", "Clear & grub", "CLEAR", 0, 12.2, "2027-03-08", "2027-05-30");
  act(p, ds, "R200", "Earthworks Stage 1", "EARTH", 0, 5.2, "2027-04-12", "2027-08-29");
  act(p, ds, "R210", "Earthworks Stage 2", "EARTH", 5.2, 7.6, "2027-06-07", "2027-10-31");
  act(p, ds, "R220", "Earthworks Stage 3", "EARTH", 7.6, 12.2, "2027-08-02", "2027-12-19");
  act(p, ds, "R300", "Drainage", "DRAIN", 0, 12.2, "2027-05-10", "2027-12-12");
  act(p, ds, "R400", "Subbase", "SUBBASE", 0, 12.2, "2027-09-06", "2028-02-27");
  act(p, ds, "R500", "Basecourse", "BASE", 0, 12.2, "2027-10-04", "2028-03-26");
  act(p, ds, "R600", "Asphalt wearing course", "ASPHALT", 0, 12.2, "2028-02-07", "2028-05-14");
  act(p, ds, "B100", "Creek bridge", "BRIDGE", 3.38, 3.58, "2027-05-03", "2027-11-28");
  act(p, ds, "B200", "Interchange bridges", "BRIDGE", 6.3, 6.7, "2027-06-14", "2028-01-30");
  act(p, ds, "B300", "Rail overpass", "BRIDGE", 9.13, 9.26, "2027-07-05", "2028-02-20");
  act(p, ds, "T100", "Traffic switch – northbound", "TRAFFIC", 0, 7.6, "2028-03-06", "2028-03-06");
  act(p, ds, "T200", "Traffic switch – southbound", "TRAFFIC", 7.6, 12.2, "2028-04-10", "2028-04-10");
  p.time_markers = [mk("Christmas shutdown", "shutdown", "2027-12-20", "2028-01-09", "#808080"),
    mk("Wet season – reduced earthworks", "restriction", "2028-01-10", "2028-03-31", "#C26A12"), mk("Open to traffic", "milestone", "2028-06-02", null, "#C00000")];
  p.page.blocks.at(-1).text = "Example project with made-up data.\nEarthworks show as blocks by stage; pavement layers as lines.\nSubbase shows a 400 m footprint behind its work front.";
  save("road-highway.tcs.json", p);
}

// ------------------------------------------------------------------ tunnel: twin-tube TBM drive
{
  const p = newProject("Example twin-tube tunnel", "tunnel", km(-0.2), km(6.2), "2026-11-02", "2029-09-28", "km");
  Object.assign(p.meta, { title: "Example Tunnel – twin tubes", subtitle: "Example project · made-up data", client: "Example Metro", contract: "EX-TUN-03", revision: "A" });
  Object.assign(p.chainage, { major_m: 500, minor_m: 100, prefix: "CH", decimals: 3, snap_m: 5 });
  p.time.px_per_day = 0.9;
  p.sections = [sec("Drive 1 – portal to shaft", 0, 3.05), sec("Drive 2 – shaft to station", 3.05, 6.0)];
  p.locations = [loc("Western portal", 0.0, "portal"), loc("Mid shaft", 3.0, "shaft", { to: 3.1 }), loc("Eastern station box", 5.8, "station", { to: 6.0 }),
    loc("Fault zone", 2.05, "geology", { to: 2.4 }), loc("Soft ground", 4.4, "geology", { to: 4.7, label: false }),
    ...Array.from({ length: 23 }, (_, i) => 0.25 * (i + 1)).filter(c => c < 5.8 && Math.abs(c - 3.05) > 0.1).map((c, i) => loc(`XP${String(i + 1).padStart(2, "0")}`, c, "xp", { label: false })),
    loc("Ventilation building", 3.05, "vent", { label: false })];
  p.styles = [
    makeStyle("TBMLAUNCH", "TBM assembly & launch", "block", "#B13A3A"),
    makeStyle("TBM_A", "TBM drive – tube A", "line", "#002060", { width: 4, footprint: { enabled: true, length_m: 120, lag_days: 0, opacity: 0.2 },
      label: { show: true, text: "{name} · {rate} m/day", follow_slope: true, position: "mid", side: "above", size: 11 } }),
    makeStyle("TBM_B", "TBM drive – tube B", "line", "#1F8A86", { width: 4, footprint: { enabled: true, length_m: 120, lag_days: 0, opacity: 0.2 },
      label: { show: true, text: "{name} · {rate} m/day", follow_slope: true, position: "mid", side: "below", size: 11 } }),
    makeStyle("XP", "Cross passages", "block", "#C26A12"),
    makeStyle("INVERT", "Invert & walkway", "line", "#404040"),
    makeStyle("FITOUT", "Mechanical & electrical fit-out", "line", "#548235"),
    makeStyle("TBMMOVE", "TBM through shaft / turnaround", "block", "#7F7F7F"),
  ];
  const ds = p.datasets[0].id; p.datasets[0].name = "Baseline";
  act(p, ds, "T010", "TBM A assembly & launch", "TBMLAUNCH", -0.15, 0.05, "2026-11-09", "2027-02-26");
  act(p, ds, "T020", "TBM A drive 1 (portal to shaft)", "TBM_A", 0.05, 2.05, "2027-03-01", "2027-08-06");
  act(p, ds, "T021", "TBM A through fault zone", "TBM_A", 2.05, 2.4, "2027-08-09", "2027-10-29");
  act(p, ds, "T022", "TBM A to shaft", "TBM_A", 2.4, 3.0, "2027-11-01", "2028-01-21");
  act(p, ds, "T023", "TBM A through shaft", "TBMMOVE", 3.0, 3.1, "2028-01-24", "2028-03-03");
  act(p, ds, "T024", "TBM A drive 2 (shaft to station)", "TBM_A", 3.1, 5.8, "2028-03-06", "2028-11-24");
  act(p, ds, "T110", "TBM B assembly & launch", "TBMLAUNCH", -0.15, 0.05, "2027-03-01", "2027-05-28");
  act(p, ds, "T120", "TBM B drive 1 (portal to shaft)", "TBM_B", 0.05, 2.05, "2027-06-01", "2027-11-05");
  act(p, ds, "T121", "TBM B through fault zone", "TBM_B", 2.05, 2.4, "2027-11-08", "2028-01-28");
  act(p, ds, "T122", "TBM B to shaft", "TBM_B", 2.4, 3.0, "2028-01-31", "2028-04-21");
  act(p, ds, "T123", "TBM B through shaft", "TBMMOVE", 3.0, 3.1, "2028-04-24", "2028-06-02");
  act(p, ds, "T124", "TBM B drive 2 (shaft to station)", "TBM_B", 3.1, 5.8, "2028-06-05", "2029-02-23");
  [[0.5, "2028-02-07"], [1.25, "2028-03-20"], [2.0, "2028-05-01"], [2.75, "2028-06-12"], [3.5, "2028-11-06"], [4.25, "2028-12-18"], [5.0, "2029-03-05"]].forEach(([c, s], i) => {
    const e = new Date(s + "T00:00Z"); e.setUTCDate(e.getUTCDate() + 34);
    act(p, ds, `X${100 + i * 10}`, `Cross passages ${i * 3 + 1}–${i * 3 + 3}`, "XP", c - 0.12, c + 0.12, s, e.toISOString().slice(0, 10));
  });
  act(p, ds, "F100", "Invert & walkway", "INVERT", 0, 5.8, "2028-04-03", "2029-05-25");
  act(p, ds, "F200", "Mechanical & electrical fit-out", "FITOUT", 0, 5.8, "2028-09-04", "2029-08-31");
  p.time_markers = [mk("Christmas shutdown", "shutdown", "2027-12-22", "2028-01-07", "#808080"), mk("Christmas shutdown", "shutdown", "2028-12-22", "2029-01-07", "#808080"),
    mk("TBM A breakthrough", "milestone", "2028-11-24", null, "#C00000", 5.4, 6.0), mk("TBM B breakthrough", "milestone", "2029-02-23", null, "#C00000", 5.4, 6.0),
    mk("Systems commissioning", "possession", "2029-09-03", "2029-09-28", "#B13A3A")];
  p.page.blocks.at(-1).text = "Example project with made-up data.\nTwo TBMs launch from the western portal three months apart, slow through the fault zone, pass through the mid shaft and break through at the station box.\nEach drive shows a 120 m footprint for the TBM and its back-up gear.";
  save("tunnel-twin-tbm.tcs.json", p);
}

writeFileSync(new URL("index.json", OUT), JSON.stringify([
  { file: "rail-resleepering.tcs.json", name: "Rail – re-sleepering, two options", text: "60 km line, loops and level crossings, possession bands, re-sleepering footprint, Option A vs Option B." },
  { file: "road-highway.tcs.json", name: "Road – highway duplication", text: "12 km upgrade in three stages: earthworks blocks, pavement layers, bridges and traffic switches." },
  { file: "tunnel-twin-tbm.tcs.json", name: "Tunnel – twin-tube TBM", text: "6 km twin tubes with a mid shaft, fault zone, cross passages, TBM footprints and fit-out." },
], null, 1));
console.log("wrote index.json");
