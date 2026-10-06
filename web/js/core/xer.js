// Primavera P6 XER in the browser: read, describe for field mapping, map onto a project, sync, and write.
import { makeActivity, makeStyle, parseT, fmtT, DAY } from "./model.js";

export const PALETTE = ["#002060", "#00B0F0", "#FFC000", "#92D050", "#C00000", "#C65911", "#7030A0", "#548235", "#FF66CC",
  "#996633", "#404040", "#1F8A86", "#8B0000", "#7F7F7F", "#E2C46B", "#4F81BD"];
export const DATE_FIELDS = {
  early_start_date: "Early start", early_end_date: "Early finish", target_start_date: "Planned start", target_end_date: "Planned finish",
  late_start_date: "Late start", late_end_date: "Late finish", act_start_date: "Actual start", act_end_date: "Actual finish",
  act_or_early_start: "Actual start, else early start", act_or_early_finish: "Actual finish, else early finish",
};

// ---- Windows-1252 text, as P6 writes it
const CP1252_HI = { 128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225, 136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381,
  145: 8216, 146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732, 153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376 };
const TO_1252 = Object.fromEntries(Object.entries(CP1252_HI).map(([b, u]) => [u, +b]));
export function decode1252(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(CP1252_HI[b] || b); return s; }
export function encode1252(text) {
  text = text.replace(/→/g, "->");
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); out[i] = c < 128 || (c > 159 && c < 256) ? c : TO_1252[c] ?? 63; }
  return out;
}

// ------------------------------------------------------------------ reading
export function parse(bytes) {
  const text = decode1252(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (!lines[0] || !lines[0].startsWith("ERMHDR")) throw new Error("This is not an XER file: the first line should start with ERMHDR.");
  const tables = {}; let cur = null;
  for (const ln of lines.slice(1)) {
    const parts = ln.split("\t");
    if (parts[0] === "%T") cur = tables[parts[1]] = { fields: [], rows: [] };
    else if (parts[0] === "%F" && cur) cur.fields = parts.slice(1);
    else if (parts[0] === "%R" && cur) { const r = {}; cur.fields.forEach((f, i) => (r[f] = parts[i + 1] ?? "")); cur.rows.push(r); }
  }
  return { header: lines[0].split("\t"), tables };
}
const rows = (x, n) => (x.tables[n] || {}).rows || [];

export function describe(x) {
  const tasks = rows(x, "TASK"), udfN = {}, codeN = {}, types = {};
  rows(x, "UDFVALUE").forEach(v => (udfN[v.udf_type_id] = (udfN[v.udf_type_id] || 0) + 1));
  rows(x, "TASKACTV").forEach(v => (codeN[v.actv_code_type_id] = (codeN[v.actv_code_type_id] || 0) + 1));
  tasks.forEach(t => (types[t.task_type || ""] = (types[t.task_type || ""] || 0) + 1));
  return {
    version: x.header[1] || "",
    projects: rows(x, "PROJECT").map(p => ({ id: p.proj_id, short_name: p.proj_short_name || "", tasks: tasks.filter(t => t.proj_id === p.proj_id).length })),
    udfs: rows(x, "UDFTYPE").filter(u => u.table_name === "TASK").map(u => ({ id: u.udf_type_id, label: u.udf_type_label || "", type: u.logical_data_type || "", values: udfN[u.udf_type_id] || 0 })),
    codes: rows(x, "ACTVTYPE").map(c => ({ id: c.actv_code_type_id, name: c.actv_code_type || "", assignments: codeN[c.actv_code_type_id] || 0 })),
    date_fields: DATE_FIELDS, task_types: types, tasks: tasks.length, wbs: rows(x, "PROJWBS").length,
  };
}

export function suggestMapping(d) {
  const find = (...words) => { for (const u of d.udfs) { const l = u.label.toLowerCase(); if (words.every(w => l.includes(w))) return { source: "udf", id: u.id, label: u.label }; } return { source: "none" }; };
  const start = find("start", "ch").source !== "none" ? find("start", "ch") : find("start", "pos");
  const end = find("end", "ch").source !== "none" ? find("end", "ch") : find("end", "pos");
  let style = find("style"); if (style.source === "none") style = find("shape");
  const lab = (start.label || "").toLowerCase();
  return { projects: d.projects.map(p => p.id), start: "act_or_early_start", finish: "act_or_early_finish", ch_start: start, ch_end: end,
    ch_unit: lab.includes("(m)") ? "m" : lab.includes("km") ? "km" : "m", style: style.source !== "none" ? style : { source: "wbs" },
    filter: { source: "none", values: [] }, skip_without_chainage: true, include_milestones: true, include_summary: false, dataset_name: "" };
}

class Lookup {
  constructor(x) {
    this.udf = new Map(rows(x, "UDFVALUE").map(v => [v.udf_type_id + "|" + v.fk_id, v]));
    this.codeVal = new Map(rows(x, "ACTVCODE").map(c => [c.actv_code_id, c]));
    this.taskCode = new Map(rows(x, "TASKACTV").map(v => [v.task_id + "|" + v.actv_code_type_id, v.actv_code_id]));
    this.wbs = new Map(rows(x, "PROJWBS").map(w => [w.wbs_id, w]));
  }
  wbsPath(id) {
    const parts = [], seen = new Set();
    while (id && this.wbs.has(id) && !seen.has(id)) { seen.add(id); const w = this.wbs.get(id); if (w.proj_node_flag === "Y") break; parts.push(w.wbs_short_name || ""); id = w.parent_wbs_id || ""; }
    return parts.reverse().join(".");
  }
  value(t, src) {
    const k = (src || {}).source || "none";
    if (k === "udf") { const v = this.udf.get(src.id + "|" + t.task_id); return v ? v.udf_number || v.udf_text || v.udf_date || null : null; }
    if (k === "code") { const cid = this.taskCode.get(t.task_id + "|" + src.id), c = cid && this.codeVal.get(cid); return c ? (src.use === "name" ? c.actv_code_name : c.short_name) : null; }
    if (k === "wbs") { const w = this.wbs.get(t.wbs_id || ""); return src.use === "path" ? this.wbsPath(t.wbs_id || "") : (w || {}).wbs_short_name || null; }
    if (k === "field") return t[src.id] || null;
    return null;
  }
}

// Accepts 232.135, CH232.135, 232135 or road-style 232+135 (always km+m).
export function chainageToM(raw, unit) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).replace(/,/g, "");
  const kp = s.match(/(-?\d+)\+(\d+(?:\.\d+)?)/); if (kp) return +kp[1] * 1000 + +kp[2];
  const n = s.match(/-?\d+(?:\.\d+)?/); if (!n) return null;
  return +n[0] * (unit === "km" ? 1000 : 1);
}
function dateOf(t, f) {
  const v = f === "act_or_early_start" ? t.act_start_date || t.early_start_date || t.restart_date || t.target_start_date
    : f === "act_or_early_finish" ? t.act_end_date || t.early_end_date || t.reend_date || t.target_end_date : t[f];
  return v ? fmtT(parseT(v)) : null;
}

export function applyMapping(x, m, project, datasetId) {
  const look = new Lookup(x), want = new Set(m.projects || []), flt = m.filter || { source: "none" }, fv = new Set(flt.values || []);
  const styles = Object.fromEntries(project.styles.map(s => [s.code, s])), newStyles = [], acts = [];
  const skipped = { no_chainage: 0, filtered: 0, type: 0, no_dates: 0 };
  for (const t of rows(x, "TASK")) {
    if (want.size && !want.has(t.proj_id)) continue;
    const tt = t.task_type || "", mile = tt === "TT_Mile" || tt === "TT_FinMile";
    if ((mile && m.include_milestones === false) || (tt === "TT_WBS" && !m.include_summary)) { skipped.type++; continue; }
    if ((flt.source || "none") !== "none" && fv.size && !fv.has(look.value(t, flt) || "")) { skipped.filtered++; continue; }
    let c0 = chainageToM(look.value(t, m.ch_start), m.ch_unit), c1 = chainageToM(look.value(t, m.ch_end), m.ch_unit);
    if (c0 == null && c1 == null) { if (m.skip_without_chainage !== false) { skipped.no_chainage++; continue; } c0 = c1 = project.chainage.start_m; }
    if (c0 == null) c0 = c1; if (c1 == null) c1 = c0;
    let s = dateOf(t, m.start || "act_or_early_start"), f = dateOf(t, m.finish || "act_or_early_finish");
    if (mile) { s = s || f; f = s; }
    if (!s || !f) { skipped.no_dates++; continue; }
    if (f < s) [s, f] = [f, s];
    const code = String(look.value(t, m.style) || (mile ? "MILESTONE" : "P6")).trim().toUpperCase().replace(/ /g, "_").slice(0, 24);
    if (!styles[code]) {
      const st = makeStyle(code, code.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), mile ? "milestone" : Math.abs(c1 - c0) < 1e-6 ? "block" : "line", PALETTE[Object.keys(styles).length % PALETTE.length]);
      styles[code] = st; newStyles.push(st);
    }
    const tf = parseFloat(t.total_float_hr_cnt);
    acts.push(makeActivity(datasetId, t.task_code || "", t.task_name || "", s, f, c0, c1, code, { wbs: look.wbsPath(t.wbs_id || ""), locked: true,
      p6: { task_id: t.task_id, proj_id: t.proj_id, task_code: t.task_code || "", task_type: tt, status: t.status_code || "", guid: t.guid || "",
        total_float_days: isNaN(tf) ? null : Math.round(tf / 8 * 10) / 10, driving: t.driving_path_flag === "Y" } }));
  }
  return { activities: acts, new_styles: newStyles, skipped };
}

// Re-read a newer XER with the saved mapping; match by Activity ID and keep local label / footprint / productivity settings.
export function sync(project, x, m, datasetId) {
  const res = applyMapping(x, m, project, datasetId);
  const old = new Map(project.activities.filter(a => a.dataset === datasetId && a.p6).map(a => [a.code, a]));
  const keep = project.activities.filter(a => !(a.dataset === datasetId && a.p6));
  const added = [], changed = []; let unchanged = 0;
  for (const a of res.activities) {
    const o = old.get(a.code);
    if (o) {
      old.delete(a.code);
      const diff = ["name", "start", "finish", "ch0_m", "ch1_m", "style"].filter(k => o[k] !== a[k]);
      for (const k of ["id", "label", "footprint", "notes", "qty", "qty_unit", "rate", "rate_unit"]) a[k] = o[k];
      diff.length ? changed.push({ code: a.code, fields: diff }) : unchanged++;
    } else added.push(a.code);
    keep.push(a);
  }
  project.activities = keep; project.styles.push(...res.new_styles);
  return { added, changed, removed: [...old.keys()].sort(), unchanged, skipped: res.skipped };
}

// ------------------------------------------------------------------ writing
const XF = {
  CURRTYPE: "curr_id decimal_digit_cnt curr_symbol decimal_symbol digit_group_symbol pos_curr_fmt_type neg_curr_fmt_type curr_type curr_short_name group_digit_cnt base_exch_rate",
  UDFTYPE: "udf_type_id table_name udf_type_name udf_type_label logical_data_type super_flag indicator_expression summary_indicator_expression export_flag",
  PROJECT: "proj_id fy_start_month_num rsrc_self_add_flag allow_complete_flag rsrc_multi_assign_flag checkout_flag project_flag step_complete_flag cost_qty_recalc_flag batch_sum_flag name_sep_char def_complete_pct_type proj_short_name acct_id orig_proj_id source_proj_id base_type_id clndr_id sum_base_proj_id task_code_base task_code_step priority_num wbs_max_sum_level strgy_priority_num last_checksum critical_drtn_hr_cnt def_cost_per_qty last_recalc_date plan_start_date plan_end_date scd_end_date add_date last_tasksum_date fcst_start_date def_duration_type task_code_prefix guid def_qty_type add_by_name web_local_root_path proj_url def_rate_type add_act_remain_flag act_this_per_link_flag def_task_type act_pct_link_flag critical_path_type task_code_prefix_flag def_rollup_dates_flag use_project_baseline_flag rem_target_link_flag reset_planned_flag allow_neg_act_flag sum_assign_level last_fin_dates_id last_baseline_update_date cr_external_key apply_actuals_date fintmpl_id last_schedule_date matrix_id last_level_date hist_interval hist_level control_updates_flag rsrc_role_match_flag px_enable_publication_flag publish_spread_assign_level px_last_update_date px_priority schedule_type location_id loaded_scope_level export_flag new_fin_dates_id baselines_to_export baseline_names_to_export sync_wbs_heir_flag sched_wbs_heir_type wbs_heir_levels next_data_date base_proj_id base_proj_id1 base_proj_id2 close_period_flag sum_refresh_date trsrcsum_loaded sumtask_loaded",
  CALENDAR: "clndr_id default_flag clndr_name proj_id base_clndr_id last_chng_date clndr_type day_hr_cnt week_hr_cnt month_hr_cnt year_hr_cnt rsrc_private clndr_data",
  SCHEDOPTIONS: "schedoptions_id proj_id sched_outer_depend_type sched_open_critical_flag sched_lag_early_start_flag sched_retained_logic sched_setplantoforecast sched_float_type sched_calendar_on_relationship_lag sched_use_expect_end_flag sched_progress_override level_float_thrs_cnt level_outer_assign_flag level_outer_assign_priority level_over_alloc_pct level_within_float_flag level_keep_sched_date_flag level_all_rsrc_flag sched_use_project_end_date_for_float enable_multiple_longest_path_calc limit_multiple_longest_path_calc max_multiple_longest_path use_total_float_multiple_longest_paths key_activity_for_multiple_longest_paths LevelPriorityList",
  PROJWBS: "wbs_id proj_id obs_id seq_num est_wt proj_node_flag sum_data_flag status_code wbs_short_name wbs_name phase_id parent_wbs_id ev_user_pct ev_etc_user_value orig_cost indep_remain_total_cost ann_dscnt_rate_pct dscnt_period_type indep_remain_work_qty anticip_start_date anticip_end_date ev_compute_type ev_etc_compute_type guid tmpl_guid plan_open_state",
  TASK: "task_id proj_id wbs_id clndr_id phys_complete_pct rev_fdbk_flag est_wt lock_plan_flag auto_compute_act_flag complete_pct_type task_type duration_type status_code task_code task_name rsrc_id total_float_hr_cnt free_float_hr_cnt remain_drtn_hr_cnt act_work_qty remain_work_qty target_work_qty target_drtn_hr_cnt target_equip_qty act_equip_qty remain_equip_qty cstr_date act_start_date act_end_date late_start_date late_end_date expect_end_date early_start_date early_end_date restart_date reend_date target_start_date target_end_date rem_late_start_date rem_late_end_date cstr_type priority_type suspend_date resume_date float_path float_path_order guid tmpl_guid cstr_date2 cstr_type2 driving_path_flag act_this_per_work_qty act_this_per_equip_qty external_early_start_date external_late_end_date cbs_id pre_pess_start_date pre_pess_finish_date post_pess_start_date post_pess_finish_date create_date update_date create_user update_user location_id control_updates_flag crt_path_num",
  UDFVALUE: "udf_type_id fk_id proj_id udf_date udf_number udf_text udf_code_id",
};

// One dataset as a P6 project: 7-day 24 h calendar, WBS from activity groups, three UDFs (start/end chainage, activity style).
export function write(p, datasetId) {
  const ds = datasetId || p.view.main_dataset, dsName = (p.datasets.find(d => d.id === ds) || {}).name || "Main";
  const m = (p.p6 || {}).mapping || {}, unit = m.ch_unit || "m", scale = unit === "km" ? 1000 : 1;
  const labS = (m.ch_start || {}).label || `Start Chainage (${unit})`, labE = (m.ch_end || {}).label || `End Chainage (${unit})`, labSt = (m.style || {}).label || "Activity Style";
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  const now = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const PID = "3001", CAL = "3001", HPD = 24;
  const short = (p.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20)) || "TCS";
  const out = [["ERMHDR", "25.12", now.slice(0, 10), "Project", "admin", "Time-Chainage Studio", "dbxDatabaseNoName", "Project Management", "AUST"].join("\t")];
  const table = (name, rs) => {
    const f = XF[name].split(" ");
    out.push("%T\t" + name, "%F\t" + f.join("\t"));
    rs.forEach(r => out.push("%R\t" + f.map(k => String(r[k] ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")));
  };
  table("CURRTYPE", [{ curr_id: 1, decimal_digit_cnt: 2, curr_symbol: "A$", decimal_symbol: ".", digit_group_symbol: ",", pos_curr_fmt_type: "#1.1", neg_curr_fmt_type: "(#1.1)", curr_type: "Australian Dollar", curr_short_name: "AUST", group_digit_cnt: 3, base_exch_rate: 1 }]);
  table("UDFTYPE", [["9101", labS, "FT_FLOAT_2_DECIMALS"], ["9102", labE, "FT_FLOAT_2_DECIMALS"], ["9103", labSt, "FT_TEXT"]].map(([i, l, t]) =>
    ({ udf_type_id: i, table_name: "TASK", udf_type_name: "user_field_" + i, udf_type_label: l, logical_data_type: t, super_flag: "N", export_flag: "Y" })));
  const acts = p.activities.filter(a => a.dataset === ds);
  const t0 = acts.length ? acts.map(a => a.start).sort()[0] : p.time.start + "T00:00", t1 = acts.length ? acts.map(a => a.finish).sort().at(-1) : p.time.finish + "T00:00";
  table("PROJECT", [{ proj_id: PID, fy_start_month_num: 1, rsrc_self_add_flag: "Y", allow_complete_flag: "Y", rsrc_multi_assign_flag: "Y", checkout_flag: "N", project_flag: "Y",
    step_complete_flag: "N", cost_qty_recalc_flag: "N", batch_sum_flag: "Y", name_sep_char: ".", def_complete_pct_type: "CP_Drtn", proj_short_name: short, clndr_id: CAL,
    task_code_base: 1000, task_code_step: 10, priority_num: 10, wbs_max_sum_level: 0, strgy_priority_num: 100, critical_drtn_hr_cnt: 0, def_cost_per_qty: "0.0000",
    last_recalc_date: t0.replace("T", " "), plan_start_date: t0.replace("T", " "), scd_end_date: t1.replace("T", " "), add_date: now, def_duration_type: "DT_FixedDUR2",
    def_qty_type: "QT_Hour", add_by_name: "admin", def_rate_type: "COST_PER_QTY", add_act_remain_flag: "N", act_this_per_link_flag: "Y", def_task_type: "TT_Task",
    act_pct_link_flag: "N", critical_path_type: "CT_TotFloat", task_code_prefix_flag: "N", def_rollup_dates_flag: "Y", use_project_baseline_flag: "Y",
    rem_target_link_flag: "Y", reset_planned_flag: "N", allow_neg_act_flag: "N", sum_assign_level: "SL_Taskrsrc", last_schedule_date: now, hist_interval: "Month",
    hist_level: "HL_None", control_updates_flag: "N", rsrc_role_match_flag: "N", px_enable_publication_flag: "N", publish_spread_assign_level: "SL_Taskrsrc", px_priority: 50,
    loaded_scope_level: 7, export_flag: "Y", sync_wbs_heir_flag: "N", sched_wbs_heir_type: "WBS_Com", wbs_heir_levels: 4, sum_refresh_date: "1899-12-30 00:00" }]);
  const day = n => `(0||${n}()(\x7f\x7f      (0||0(s|00:00|f|00:00)())))`;
  const cal = "(0||CalendarData()(\x7f\x7f  (0||DaysOfWeek()(" + [1, 2, 3, 4, 5, 6, 7].map(n => "\x7f\x7f    " + day(n)).join("") + "))\x7f\x7f  (0||VIEW(ShowTotal|N)())\x7f\x7f  (0||Exceptions()()))";
  table("CALENDAR", [{ clndr_id: CAL, default_flag: "N", clndr_name: "TCS 7 day 24 h - elapsed time", proj_id: PID, last_chng_date: now.slice(0, 10) + " 00:00", clndr_type: "CA_Project",
    day_hr_cnt: HPD, week_hr_cnt: HPD * 7, month_hr_cnt: 730, year_hr_cnt: 8760, rsrc_private: "N", clndr_data: cal }]);
  table("SCHEDOPTIONS", [{ schedoptions_id: 1, proj_id: PID, sched_outer_depend_type: "SD_Both", sched_open_critical_flag: "N", sched_lag_early_start_flag: "Y",
    sched_retained_logic: "Y", sched_setplantoforecast: "N", sched_float_type: "FT_FF", sched_calendar_on_relationship_lag: "rcal_Predecessor", sched_use_expect_end_flag: "Y",
    sched_progress_override: "N", level_float_thrs_cnt: 0, level_outer_assign_flag: "N", level_outer_assign_priority: 5, level_over_alloc_pct: 25, level_within_float_flag: "N",
    level_keep_sched_date_flag: "Y", level_all_rsrc_flag: "Y", sched_use_project_end_date_for_float: "Y", enable_multiple_longest_path_calc: "N",
    limit_multiple_longest_path_calc: "Y", max_multiple_longest_path: 10, use_total_float_multiple_longest_paths: "Y", LevelPriorityList: "priority_type,ASC_BY_FIELD/ASC\x7f\x7f" }]);
  const WB = { proj_id: PID, est_wt: 1, sum_data_flag: "N", status_code: "WS_Open", ev_user_pct: 6, ev_etc_user_value: 0.88, orig_cost: "0.0000", indep_remain_total_cost: "0.0000",
    ev_compute_type: "EC_Cmp_pct", ev_etc_compute_type: "EE_Rem_hr" };
  const wbs = [{ ...WB, wbs_id: "4000", seq_num: 0, proj_node_flag: "Y", wbs_short_name: short, wbs_name: `${p.meta.title || p.name} - ${dsName}` }], wmap = {};
  const wbsFor = path => {
    let parent = "4000", key = "";
    for (const part of String(path || "").split(".").filter(Boolean)) {
      key = key ? key + "." + part : part;
      if (!wmap[key]) { wmap[key] = String(4001 + Object.keys(wmap).length); wbs.push({ ...WB, wbs_id: wmap[key], seq_num: wbs.length * 10, proj_node_flag: "N", wbs_short_name: part.slice(0, 40), wbs_name: part, parent_wbs_id: parent }); }
      parent = wmap[key];
    }
    return parent;
  };
  const styles = Object.fromEntries(p.styles.map(s => [s.code, s])), tasks = [], udf = [];
  const xd = ms => fmtT(ms).replace("T", " ");
  acts.slice().sort((a, b) => a.start.localeCompare(b.start) || a.code.localeCompare(b.code)).forEach((a, n) => {
    const tid = String(500001 + n), st = parseT(a.start);
    const mile = (styles[a.style] || {}).kind === "milestone" || ["TT_Mile", "TT_FinMile"].includes((a.p6 || {}).task_type);
    const fi = mile ? st : parseT(a.finish), hrs = Math.round((fi - st) / 36e5 * 100) / 100, s = xd(st), f = xd(fi);
    tasks.push({ task_id: tid, proj_id: PID, wbs_id: wbsFor(a.wbs || a.style), clndr_id: CAL, phys_complete_pct: 0, rev_fdbk_flag: "N", est_wt: 1, lock_plan_flag: "N",
      auto_compute_act_flag: "N", complete_pct_type: "CP_Drtn", task_type: mile ? "TT_Mile" : "TT_Task", duration_type: "DT_FixedDrtn", status_code: "TK_NotStart",
      task_code: a.code || `TCS${1000 + 10 * n}`, task_name: a.name, total_float_hr_cnt: 0, free_float_hr_cnt: 0, remain_drtn_hr_cnt: hrs, act_work_qty: 0, remain_work_qty: 0,
      target_work_qty: 0, target_drtn_hr_cnt: hrs, target_equip_qty: 0, act_equip_qty: 0, remain_equip_qty: 0, cstr_date: s, late_start_date: s, late_end_date: f,
      early_start_date: s, early_end_date: f, restart_date: s, reend_date: f, target_start_date: s, target_end_date: f, rem_late_start_date: s, rem_late_end_date: f,
      cstr_type: "CS_MSOA", priority_type: "PT_Normal", driving_path_flag: "N", act_this_per_work_qty: 0, act_this_per_equip_qty: 0, create_date: now, update_date: now,
      create_user: "admin", update_user: "admin", control_updates_flag: "N" });
    udf.push({ udf_type_id: "9101", fk_id: tid, proj_id: PID, udf_number: (a.ch0_m / scale).toFixed(2) }, { udf_type_id: "9102", fk_id: tid, proj_id: PID, udf_number: (a.ch1_m / scale).toFixed(2) },
      { udf_type_id: "9103", fk_id: tid, proj_id: PID, udf_text: a.style });
  });
  table("PROJWBS", wbs); table("TASK", tasks); table("UDFVALUE", udf);
  out.push("%E");
  return encode1252(out.join("\r\n") + "\r\n");
}
