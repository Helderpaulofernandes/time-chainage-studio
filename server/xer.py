"""Primavera P6 XER: read, describe for field mapping, map onto a project, and write.

Field mapping mirrors TurboChart's Primavera data set: pick the date fields, then say where start
chainage, end chainage and activity style come from (a user-defined field, an activity code, the
WBS, or nothing). A saved mapping is reused when the project is re-synced from a newer XER.
"""
from __future__ import annotations

import datetime as dt
import re

from .model import fmt_t, make_activity, make_style, new_id, parse_t

PALETTE = ["#002060", "#00B0F0", "#FFC000", "#92D050", "#C00000", "#C65911", "#7030A0", "#548235", "#FF66CC",
           "#996633", "#404040", "#1F8A86", "#8B0000", "#7F7F7F", "#E2C46B", "#4F81BD"]

DATE_FIELDS = {
    "early_start_date": "Early start", "early_end_date": "Early finish",
    "target_start_date": "Planned start", "target_end_date": "Planned finish",
    "late_start_date": "Late start", "late_end_date": "Late finish",
    "act_start_date": "Actual start", "act_end_date": "Actual finish",
    "act_or_early_start": "Actual start, else early start", "act_or_early_finish": "Actual finish, else early finish",
}


# ------------------------------------------------------------------ reading
def parse(data: bytes) -> dict:
    text = data.decode("cp1252", errors="replace")
    lines = text.replace("\r\n", "\n").split("\n")
    if not lines or not lines[0].startswith("ERMHDR"):
        raise ValueError("This is not an XER file: the first line should start with ERMHDR.")
    tables: dict[str, dict] = {}
    cur = None
    for ln in lines[1:]:
        parts = ln.split("\t")
        tag = parts[0]
        if tag == "%T":
            cur = tables.setdefault(parts[1], {"fields": [], "rows": []})
        elif tag == "%F" and cur is not None:
            cur["fields"] = parts[1:]
        elif tag == "%R" and cur is not None:
            vals = parts[1:] + [""] * (len(cur["fields"]) - len(parts) + 1)
            cur["rows"].append(dict(zip(cur["fields"], vals)))
    return {"header": lines[0].split("\t"), "tables": tables}


def _rows(x: dict, name: str) -> list[dict]:
    return x["tables"].get(name, {}).get("rows", [])


def describe(x: dict) -> dict:
    """Everything the mapping dialog needs: projects, task UDFs, activity code types, WBS and counts."""
    tasks = _rows(x, "TASK")
    udf_counts: dict[str, int] = {}
    for v in _rows(x, "UDFVALUE"):
        udf_counts[v["udf_type_id"]] = udf_counts.get(v["udf_type_id"], 0) + 1
    code_counts: dict[str, int] = {}
    for v in _rows(x, "TASKACTV"):
        code_counts[v["actv_code_type_id"]] = code_counts.get(v["actv_code_type_id"], 0) + 1
    types: dict[str, int] = {}
    for t in tasks:
        types[t.get("task_type", "")] = types.get(t.get("task_type", ""), 0) + 1
    return {
        "version": x["header"][1] if len(x["header"]) > 1 else "",
        "projects": [{"id": p["proj_id"], "short_name": p.get("proj_short_name", ""),
                      "tasks": sum(1 for t in tasks if t["proj_id"] == p["proj_id"])} for p in _rows(x, "PROJECT")],
        "udfs": [{"id": u["udf_type_id"], "label": u.get("udf_type_label", ""), "type": u.get("logical_data_type", ""),
                  "values": udf_counts.get(u["udf_type_id"], 0)} for u in _rows(x, "UDFTYPE") if u.get("table_name") == "TASK"],
        "codes": [{"id": c["actv_code_type_id"], "name": c.get("actv_code_type", ""), "assignments": code_counts.get(c["actv_code_type_id"], 0)}
                  for c in _rows(x, "ACTVTYPE")],
        "date_fields": DATE_FIELDS,
        "task_types": types,
        "tasks": len(tasks),
        "wbs": len(_rows(x, "PROJWBS")),
    }


def suggest_mapping(desc: dict) -> dict:
    """Guess a mapping from UDF names, so a file exported by this app maps itself."""
    def find(*words):
        for u in desc["udfs"]:
            lab = u["label"].lower()
            if all(w in lab for w in words):
                return {"source": "udf", "id": u["id"], "label": u["label"]}
        return {"source": "none"}
    start = find("start", "ch") if find("start", "ch")["source"] != "none" else find("start", "pos")
    end = find("end", "ch") if find("end", "ch")["source"] != "none" else find("end", "pos")
    style = find("style")
    if style["source"] == "none":
        style = find("shape")
    unit = "m" if "(m)" in (start.get("label") or "") else "km" if "km" in (start.get("label") or "").lower() else "m"
    return {"projects": [p["id"] for p in desc["projects"]], "start": "act_or_early_start", "finish": "act_or_early_finish",
            "ch_start": start, "ch_end": end, "ch_unit": unit, "style": style if style["source"] != "none" else {"source": "wbs"},
            "filter": {"source": "none", "values": []}, "skip_without_chainage": True, "include_milestones": True,
            "include_summary": False, "dataset_name": ""}


class _Lookup:
    def __init__(self, x: dict):
        self.udf = {(v["udf_type_id"], v["fk_id"]): v for v in _rows(x, "UDFVALUE")}
        self.code_val = {c["actv_code_id"]: c for c in _rows(x, "ACTVCODE")}
        self.task_code = {(v["task_id"], v["actv_code_type_id"]): v["actv_code_id"] for v in _rows(x, "TASKACTV")}
        self.wbs = {w["wbs_id"]: w for w in _rows(x, "PROJWBS")}

    def wbs_path(self, wbs_id: str) -> str:
        parts, seen = [], set()
        while wbs_id and wbs_id in self.wbs and wbs_id not in seen:
            seen.add(wbs_id)
            w = self.wbs[wbs_id]
            if w.get("proj_node_flag") == "Y":
                break
            parts.append(w.get("wbs_short_name", ""))
            wbs_id = w.get("parent_wbs_id", "")
        return ".".join(reversed(parts))

    def value(self, task: dict, src: dict) -> str | None:
        kind = (src or {}).get("source", "none")
        if kind == "udf":
            v = self.udf.get((src["id"], task["task_id"]))
            if not v:
                return None
            return v.get("udf_number") or v.get("udf_text") or v.get("udf_date") or None
        if kind == "code":
            cid = self.task_code.get((task["task_id"], src["id"]))
            c = self.code_val.get(cid) if cid else None
            if not c:
                return None
            return c.get("actv_code_name") if src.get("use") == "name" else c.get("short_name")
        if kind == "wbs":
            w = self.wbs.get(task.get("wbs_id", ""))
            return (w or {}).get("wbs_short_name") if src.get("use") != "path" else self.wbs_path(task.get("wbs_id", ""))
        if kind == "field":
            return task.get(src["id"]) or None
        return None


_KM_PLUS = re.compile(r"(-?\d+)\+(\d+(?:\.\d+)?)")
_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def chainage_to_m(raw: str | None, unit: str) -> float | None:
    """Accepts 232.135, CH232.135, 232135 or road-style 232+135 (always km+m)."""
    if raw is None or str(raw).strip() == "":
        return None
    s = str(raw).replace(",", "")
    m = _KM_PLUS.search(s)
    if m:
        return float(m.group(1)) * 1000 + float(m.group(2))
    m = _NUM.search(s)
    if not m:
        return None
    return float(m.group(0)) * (1000.0 if unit == "km" else 1.0)


def _date(task: dict, field: str) -> str | None:
    if field == "act_or_early_start":
        v = task.get("act_start_date") or task.get("early_start_date") or task.get("restart_date") or task.get("target_start_date")
    elif field == "act_or_early_finish":
        v = task.get("act_end_date") or task.get("early_end_date") or task.get("reend_date") or task.get("target_end_date")
    else:
        v = task.get(field)
    return fmt_t(parse_t(v)) if v else None


def apply_mapping(x: dict, mapping: dict, project: dict, dataset_id: str) -> dict:
    """Turn XER tasks into activities for one dataset. Returns {"activities", "new_styles", "skipped"}."""
    look = _Lookup(x)
    want_proj = set(mapping.get("projects") or [])
    flt = mapping.get("filter") or {"source": "none"}
    flt_vals = set(flt.get("values") or [])
    unit = mapping.get("ch_unit", "m")
    styles = {s["code"]: s for s in project["styles"]}
    new_styles: list[dict] = []
    acts, skipped = [], {"no_chainage": 0, "filtered": 0, "type": 0, "no_dates": 0}
    for t in _rows(x, "TASK"):
        if want_proj and t["proj_id"] not in want_proj:
            continue
        ttype = t.get("task_type", "")
        is_mile = ttype in ("TT_Mile", "TT_FinMile")
        if (is_mile and not mapping.get("include_milestones", True)) or (ttype == "TT_WBS" and not mapping.get("include_summary")):
            skipped["type"] += 1
            continue
        if flt.get("source", "none") != "none" and flt_vals and (look.value(t, flt) or "") not in flt_vals:
            skipped["filtered"] += 1
            continue
        c0 = chainage_to_m(look.value(t, mapping.get("ch_start")), unit)
        c1 = chainage_to_m(look.value(t, mapping.get("ch_end")), unit)
        if c0 is None and c1 is None:
            if mapping.get("skip_without_chainage", True):
                skipped["no_chainage"] += 1
                continue
            c0 = c1 = project["chainage"]["start_m"]
        c0 = c1 if c0 is None else c0
        c1 = c0 if c1 is None else c1
        s = _date(t, mapping.get("start", "act_or_early_start"))
        f = _date(t, mapping.get("finish", "act_or_early_finish"))
        if is_mile:
            s = s or f
            f = s
        if not s or not f:
            skipped["no_dates"] += 1
            continue
        if f < s:
            s, f = f, s
        code = (look.value(t, mapping.get("style")) or ("MILESTONE" if is_mile else "P6")).strip().upper().replace(" ", "_")[:24]
        if code not in styles:
            kind = "milestone" if is_mile else ("block" if abs(c1 - c0) < 1e-6 else "line")
            st = make_style(code, code.replace("_", " ").title(), kind, PALETTE[len(styles) % len(PALETTE)])
            styles[code] = st
            new_styles.append(st)
        a = make_activity(dataset_id, t.get("task_code", ""), t.get("task_name", ""), s, f, c0, c1, code,
                          wbs=look.wbs_path(t.get("wbs_id", "")), locked=True,
                          p6={"task_id": t["task_id"], "proj_id": t["proj_id"], "task_code": t.get("task_code", ""), "task_type": ttype,
                              "status": t.get("status_code", ""), "guid": t.get("guid", ""),
                              "total_float_days": _hours_to_days(t.get("total_float_hr_cnt")),
                              "driving": t.get("driving_path_flag") == "Y"})
        acts.append(a)
    return {"activities": acts, "new_styles": new_styles, "skipped": skipped}


def _hours_to_days(v):
    try:
        return round(float(v) / 8.0, 1)
    except (TypeError, ValueError):
        return None


def sync(project: dict, x: dict, mapping: dict, dataset_id: str) -> dict:
    """Re-read a newer XER with the saved mapping. Matches by activity ID; keeps local label/footprint overrides."""
    res = apply_mapping(x, mapping, project, dataset_id)
    old = {a["code"]: a for a in project["activities"] if a["dataset"] == dataset_id and a.get("p6")}
    keep = [a for a in project["activities"] if not (a["dataset"] == dataset_id and a.get("p6"))]
    added, changed, unchanged = [], [], 0
    for a in res["activities"]:
        o = old.pop(a["code"], None)
        if o:
            diff = [k for k in ("name", "start", "finish", "ch0_m", "ch1_m", "style") if o.get(k) != a.get(k)]
            for k in ("id", "label", "footprint", "notes", "qty", "qty_unit", "rate", "rate_unit"):
                a[k] = o.get(k)
            if diff:
                changed.append({"code": a["code"], "fields": diff})
            else:
                unchanged += 1
        else:
            added.append(a["code"])
        keep.append(a)
    project["activities"] = keep
    project["styles"].extend(res["new_styles"])
    return {"added": added, "changed": changed, "removed": sorted(old.keys()), "unchanged": unchanged, "skipped": res["skipped"]}


# ------------------------------------------------------------------ writing
XF = {
    "CURRTYPE": "curr_id decimal_digit_cnt curr_symbol decimal_symbol digit_group_symbol pos_curr_fmt_type neg_curr_fmt_type curr_type curr_short_name group_digit_cnt base_exch_rate",
    "UDFTYPE": "udf_type_id table_name udf_type_name udf_type_label logical_data_type super_flag indicator_expression summary_indicator_expression export_flag",
    "PROJECT": "proj_id fy_start_month_num rsrc_self_add_flag allow_complete_flag rsrc_multi_assign_flag checkout_flag project_flag step_complete_flag cost_qty_recalc_flag batch_sum_flag name_sep_char def_complete_pct_type proj_short_name acct_id orig_proj_id source_proj_id base_type_id clndr_id sum_base_proj_id task_code_base task_code_step priority_num wbs_max_sum_level strgy_priority_num last_checksum critical_drtn_hr_cnt def_cost_per_qty last_recalc_date plan_start_date plan_end_date scd_end_date add_date last_tasksum_date fcst_start_date def_duration_type task_code_prefix guid def_qty_type add_by_name web_local_root_path proj_url def_rate_type add_act_remain_flag act_this_per_link_flag def_task_type act_pct_link_flag critical_path_type task_code_prefix_flag def_rollup_dates_flag use_project_baseline_flag rem_target_link_flag reset_planned_flag allow_neg_act_flag sum_assign_level last_fin_dates_id last_baseline_update_date cr_external_key apply_actuals_date fintmpl_id last_schedule_date matrix_id last_level_date hist_interval hist_level control_updates_flag rsrc_role_match_flag px_enable_publication_flag publish_spread_assign_level px_last_update_date px_priority schedule_type location_id loaded_scope_level export_flag new_fin_dates_id baselines_to_export baseline_names_to_export sync_wbs_heir_flag sched_wbs_heir_type wbs_heir_levels next_data_date base_proj_id base_proj_id1 base_proj_id2 close_period_flag sum_refresh_date trsrcsum_loaded sumtask_loaded",
    "CALENDAR": "clndr_id default_flag clndr_name proj_id base_clndr_id last_chng_date clndr_type day_hr_cnt week_hr_cnt month_hr_cnt year_hr_cnt rsrc_private clndr_data",
    "SCHEDOPTIONS": "schedoptions_id proj_id sched_outer_depend_type sched_open_critical_flag sched_lag_early_start_flag sched_retained_logic sched_setplantoforecast sched_float_type sched_calendar_on_relationship_lag sched_use_expect_end_flag sched_progress_override level_float_thrs_cnt level_outer_assign_flag level_outer_assign_priority level_over_alloc_pct level_within_float_flag level_keep_sched_date_flag level_all_rsrc_flag sched_use_project_end_date_for_float enable_multiple_longest_path_calc limit_multiple_longest_path_calc max_multiple_longest_path use_total_float_multiple_longest_paths key_activity_for_multiple_longest_paths LevelPriorityList",
    "PROJWBS": "wbs_id proj_id obs_id seq_num est_wt proj_node_flag sum_data_flag status_code wbs_short_name wbs_name phase_id parent_wbs_id ev_user_pct ev_etc_user_value orig_cost indep_remain_total_cost ann_dscnt_rate_pct dscnt_period_type indep_remain_work_qty anticip_start_date anticip_end_date ev_compute_type ev_etc_compute_type guid tmpl_guid plan_open_state",
    "TASK": "task_id proj_id wbs_id clndr_id phys_complete_pct rev_fdbk_flag est_wt lock_plan_flag auto_compute_act_flag complete_pct_type task_type duration_type status_code task_code task_name rsrc_id total_float_hr_cnt free_float_hr_cnt remain_drtn_hr_cnt act_work_qty remain_work_qty target_work_qty target_drtn_hr_cnt target_equip_qty act_equip_qty remain_equip_qty cstr_date act_start_date act_end_date late_start_date late_end_date expect_end_date early_start_date early_end_date restart_date reend_date target_start_date target_end_date rem_late_start_date rem_late_end_date cstr_type priority_type suspend_date resume_date float_path float_path_order guid tmpl_guid cstr_date2 cstr_type2 driving_path_flag act_this_per_work_qty act_this_per_equip_qty external_early_start_date external_late_end_date cbs_id pre_pess_start_date pre_pess_finish_date post_pess_start_date post_pess_finish_date create_date update_date create_user update_user location_id control_updates_flag crt_path_num",
    "UDFVALUE": "udf_type_id fk_id proj_id udf_date udf_number udf_text udf_code_id",
}
_W1252 = {"–": "\x96", "—": "\x97", "‘": "\x91", "’": "\x92", "“": "\x93", "”": "\x94", "•": "\x95", "…": "\x85", "→": "->"}


def write(project: dict, dataset_id: str | None = None) -> bytes:
    """Write one dataset as a P6 project with a 7-day calendar and three UDFs (start/end chainage, activity style).

    UDF labels and chainage unit follow the saved P6 mapping when there is one, so P6 matches the
    fields it already has on re-import ("Update existing project")."""
    ds = dataset_id or project["view"]["main_dataset"]
    ds_name = next((d["name"] for d in project["datasets"] if d["id"] == ds), "Main")
    m = (project.get("p6") or {}).get("mapping") or {}
    unit = m.get("ch_unit", "m")
    scale = 1000.0 if unit == "km" else 1.0
    lab_s = (m.get("ch_start") or {}).get("label") or f"Start Chainage ({unit})"
    lab_e = (m.get("ch_end") or {}).get("label") or f"End Chainage ({unit})"
    lab_st = (m.get("style") or {}).get("label") or "Activity Style"
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    pid, cal, hpd = "3001", "3001", 8
    short = re.sub(r"[^A-Za-z0-9]+", "-", project["name"]).strip("-")[:20] or "TCS"
    out = ["\t".join(["ERMHDR", "25.12", now[:10], "Project", "admin", "Time-Chainage Studio", "dbxDatabaseNoName", "Project Management", "AUST"])]

    def table(name, rows):
        f = XF[name].split()
        out.append("%T\t" + name)
        out.append("%F\t" + "\t".join(f))
        for r in rows:
            out.append("%R\t" + "\t".join(re.sub(r"[\t\r\n]+", " ", str(r.get(k, "") if r.get(k) is not None else "")) for k in f))

    table("CURRTYPE", [dict(curr_id=1, decimal_digit_cnt=2, curr_symbol="A$", decimal_symbol=".", digit_group_symbol=",", pos_curr_fmt_type="#1.1",
                            neg_curr_fmt_type="(#1.1)", curr_type="Australian Dollar", curr_short_name="AUST", group_digit_cnt=3, base_exch_rate=1)])
    U = {"s": ("9101", lab_s, "FT_FLOAT_2_DECIMALS"), "e": ("9102", lab_e, "FT_FLOAT_2_DECIMALS"), "st": ("9103", lab_st, "FT_TEXT")}
    table("UDFTYPE", [dict(udf_type_id=i, table_name="TASK", udf_type_name="user_field_" + i, udf_type_label=l, logical_data_type=t, super_flag="N",
                           export_flag="Y") for i, l, t in U.values()])
    acts = [a for a in project["activities"] if a["dataset"] == ds]
    t0 = min((a["start"] for a in acts), default=project["time"]["start"] + "T00:00")
    t1 = max((a["finish"] for a in acts), default=project["time"]["finish"] + "T00:00")
    table("PROJECT", [dict(proj_id=pid, fy_start_month_num=1, rsrc_self_add_flag="Y", allow_complete_flag="Y", rsrc_multi_assign_flag="Y",
                           checkout_flag="N", project_flag="Y", step_complete_flag="N", cost_qty_recalc_flag="N", batch_sum_flag="Y", name_sep_char=".",
                           def_complete_pct_type="CP_Drtn", proj_short_name=short, clndr_id=cal, task_code_base=1000, task_code_step=10,
                           priority_num=10, wbs_max_sum_level=0, strgy_priority_num=100, critical_drtn_hr_cnt=0, def_cost_per_qty="0.0000",
                           last_recalc_date=t0.replace("T", " "), plan_start_date=t0.replace("T", " "), scd_end_date=t1.replace("T", " "),
                           add_date=now, def_duration_type="DT_FixedDUR2", def_qty_type="QT_Hour", add_by_name="admin", def_rate_type="COST_PER_QTY",
                           add_act_remain_flag="N", act_this_per_link_flag="Y", def_task_type="TT_Task", act_pct_link_flag="N",
                           critical_path_type="CT_TotFloat", task_code_prefix_flag="N", def_rollup_dates_flag="Y", use_project_baseline_flag="Y",
                           rem_target_link_flag="Y", reset_planned_flag="N", allow_neg_act_flag="N", sum_assign_level="SL_Taskrsrc",
                           last_schedule_date=now, hist_interval="Month", hist_level="HL_None", control_updates_flag="N", rsrc_role_match_flag="N",
                           px_enable_publication_flag="N", publish_spread_assign_level="SL_Taskrsrc", px_priority=50, loaded_scope_level=7,
                           export_flag="Y", sync_wbs_heir_flag="N", sched_wbs_heir_type="WBS_Com", wbs_heir_levels=4, sum_refresh_date="1899-12-30 00:00")])
    day = lambda n: f"(0||{n}()(\x7f\x7f      (0||0(s|00:00|f|00:00)())))"
    cal_data = ("(0||CalendarData()(\x7f\x7f  (0||DaysOfWeek()(" + "".join("\x7f\x7f    " + day(n) for n in range(1, 8)) +
                "))\x7f\x7f  (0||VIEW(ShowTotal|N)())\x7f\x7f  (0||Exceptions()()))")
    # 24 h, 7 days: P6 durations then equal elapsed time exactly, so the chart and P6 agree to the hour
    hpd = 24
    table("CALENDAR", [dict(clndr_id=cal, default_flag="N", clndr_name="TCS 7 day 24 h - elapsed time", proj_id=pid, last_chng_date=now[:10] + " 00:00",
                            clndr_type="CA_Project", day_hr_cnt=hpd, week_hr_cnt=hpd * 7, month_hr_cnt=730, year_hr_cnt=8760, rsrc_private="N",
                            clndr_data=cal_data)])
    table("SCHEDOPTIONS", [dict(schedoptions_id=1, proj_id=pid, sched_outer_depend_type="SD_Both", sched_open_critical_flag="N",
                                sched_lag_early_start_flag="Y", sched_retained_logic="Y", sched_setplantoforecast="N", sched_float_type="FT_FF",
                                sched_calendar_on_relationship_lag="rcal_Predecessor", sched_use_expect_end_flag="Y", sched_progress_override="N",
                                level_float_thrs_cnt=0, level_outer_assign_flag="N", level_outer_assign_priority=5, level_over_alloc_pct=25,
                                level_within_float_flag="N", level_keep_sched_date_flag="Y", level_all_rsrc_flag="Y",
                                sched_use_project_end_date_for_float="Y", enable_multiple_longest_path_calc="N", limit_multiple_longest_path_calc="Y",
                                max_multiple_longest_path=10, use_total_float_multiple_longest_paths="Y", LevelPriorityList="priority_type,ASC_BY_FIELD/ASC\x7f\x7f")])
    WB = dict(proj_id=pid, est_wt=1, sum_data_flag="N", status_code="WS_Open", ev_user_pct=6, ev_etc_user_value=0.88, orig_cost="0.0000",
              indep_remain_total_cost="0.0000", ev_compute_type="EC_Cmp_pct", ev_etc_compute_type="EE_Rem_hr")
    wbs = [dict(WB, wbs_id="4000", seq_num=0, proj_node_flag="Y", wbs_short_name=short, wbs_name=f'{project["meta"].get("title") or project["name"]} - {ds_name}')]
    wmap: dict[str, str] = {}

    def wbs_for(path: str) -> str:
        parent = "4000"
        key = ""
        for part in [p for p in (path or "").split(".") if p]:
            key = key + "." + part if key else part
            if key not in wmap:
                wid = str(4001 + len(wmap))
                wmap[key] = wid
                wbs.append(dict(WB, wbs_id=wid, seq_num=len(wbs) * 10, proj_node_flag="N", wbs_short_name=part[:40], wbs_name=part,
                                parent_wbs_id=parent))
            parent = wmap[key]
        return parent

    styles = {s["code"]: s for s in project["styles"]}
    tasks, udf = [], []
    for n, a in enumerate(sorted(acts, key=lambda a: (a["start"], a["code"]))):
        tid = str(500001 + n)
        st, fi = parse_t(a["start"]), parse_t(a["finish"])
        mile = styles.get(a["style"], {}).get("kind") == "milestone" or (a.get("p6") or {}).get("task_type") in ("TT_Mile", "TT_FinMile")
        if mile:
            fi = st
        hrs = round((fi - st).total_seconds() / 3600, 2)
        s, f = st.strftime("%Y-%m-%d %H:%M"), fi.strftime("%Y-%m-%d %H:%M")
        tasks.append(dict(task_id=tid, proj_id=pid, wbs_id=wbs_for(a.get("wbs") or a["style"]), clndr_id=cal, phys_complete_pct=0, rev_fdbk_flag="N",
                          est_wt=1, lock_plan_flag="N", auto_compute_act_flag="N", complete_pct_type="CP_Drtn",
                          task_type="TT_Mile" if mile else "TT_Task", duration_type="DT_FixedDrtn", status_code="TK_NotStart",
                          task_code=a["code"] or f"TCS{1000 + 10 * n}", task_name=a["name"], total_float_hr_cnt=0, free_float_hr_cnt=0,
                          remain_drtn_hr_cnt=hrs, act_work_qty=0, remain_work_qty=0, target_work_qty=0, target_drtn_hr_cnt=hrs, target_equip_qty=0,
                          act_equip_qty=0, remain_equip_qty=0, cstr_date=s, late_start_date=s, late_end_date=f, early_start_date=s, early_end_date=f,
                          restart_date=s, reend_date=f, target_start_date=s, target_end_date=f, rem_late_start_date=s, rem_late_end_date=f,
                          cstr_type="CS_MSOA", priority_type="PT_Normal", driving_path_flag="N", act_this_per_work_qty=0, act_this_per_equip_qty=0,
                          create_date=now, update_date=now, create_user="admin", update_user="admin", control_updates_flag="N"))
        udf.append(dict(udf_type_id="9101", fk_id=tid, proj_id=pid, udf_number=f'{a["ch0_m"] / scale:.2f}'))
        udf.append(dict(udf_type_id="9102", fk_id=tid, proj_id=pid, udf_number=f'{a["ch1_m"] / scale:.2f}'))
        udf.append(dict(udf_type_id="9103", fk_id=tid, proj_id=pid, udf_text=a["style"]))
    table("PROJWBS", wbs)
    table("TASK", tasks)
    table("UDFVALUE", udf)
    out.append("%E")
    text = "\r\n".join(out) + "\r\n"
    text = "".join(_W1252.get(c, c) for c in text)
    return text.encode("cp1252", errors="replace")


def default_export_mapping(unit: str = "m") -> dict:
    """The mapping that reads back a file produced by write()."""
    return {"projects": [], "start": "early_start_date", "finish": "early_end_date",
            "ch_start": {"source": "udf", "id": "9101", "label": f"Start Chainage ({unit})"},
            "ch_end": {"source": "udf", "id": "9102", "label": f"End Chainage ({unit})"},
            "ch_unit": unit, "style": {"source": "udf", "id": "9103", "label": "Activity Style"},
            "filter": {"source": "none", "values": []}, "skip_without_chainage": True, "include_milestones": True,
            "include_summary": False, "dataset_name": ""}


def new_token() -> str:
    return new_id("u")
