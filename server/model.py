"""Project data model for Time-Chainage Studio.

A project is one JSON document. Chainage is stored in metres everywhere; the display unit is a
view setting. Times are naive local ISO strings "YYYY-MM-DDTHH:MM". An activity runs from `start`
to `finish`, where `finish` is exclusive: a one-day task on 5 Apr is start 2027-04-05T00:00,
finish 2027-04-06T00:00. This matches how P6 finish times and TurboChart finish dates are drawn.
"""
from __future__ import annotations

import copy
import datetime as dt
import uuid

SCHEMA_VERSION = 1


def new_id(prefix: str = "") -> str:
    return prefix + uuid.uuid4().hex[:10]


# ------------------------------------------------------------------ discipline presets
# Each preset gives the location types (with their marker symbol) and a starter style library.
LOCATION_SYMBOLS = ["circle", "tick", "box", "trapezoid", "diamond", "bar", "triangle", "band"]

PRESETS: dict[str, dict] = {
    "rail": {
        "label": "Rail",
        "location_types": [
            {"id": "loop", "name": "Crossing loop / yard", "symbol": "trapezoid", "colour": "#C26A12", "row": 1, "grid": True},
            {"id": "station", "name": "Station / town", "symbol": "circle", "colour": "#1F6E8C", "row": 1, "grid": True},
            {"id": "lx", "name": "Level crossing", "symbol": "tick", "colour": "#B13A3A", "row": 2, "grid": False},
            {"id": "ped", "name": "Pedestrian crossing", "symbol": "tick", "colour": "#1F6E8C", "row": 2, "grid": False},
            {"id": "bridge", "name": "Bridge", "symbol": "box", "colour": "#6A4FA3", "row": 3, "grid": False},
            {"id": "culvert", "name": "Culvert", "symbol": "box", "colour": "#6A4FA3", "row": 3, "grid": False},
            {"id": "turnout", "name": "Turnout", "symbol": "triangle", "colour": "#996633", "row": 4, "grid": False},
            {"id": "zone", "name": "Work zone / track section", "symbol": "band", "colour": "#8B0000", "row": 1, "grid": False},
            {"id": "limit", "name": "Contract / network limit", "symbol": "bar", "colour": "#18262B", "row": 1, "grid": True},
            {"id": "other", "name": "Other", "symbol": "diamond", "colour": "#5D6B70", "row": 4, "grid": False},
        ],
        "styles": [
            ("RESLEEPER", "Re-sleepering", "line", "#002060"), ("DRAIN", "Drainage", "line", "#00B0F0"),
            ("BALLAST", "Ballast, lift & tamp", "line", "#FFC000"), ("TAMP", "Tamp & regulate", "line", "#92D050"),
            ("RERAIL", "Re-railing", "line", "#C00000"), ("STRUC", "Structures", "line", "#C65911"),
            ("SITE", "Site establishment", "block", "#548235"), ("POSS", "Possession", "block", "#B13A3A"),
        ],
    },
    "road": {
        "label": "Road",
        "location_types": [
            {"id": "interchange", "name": "Interchange", "symbol": "trapezoid", "colour": "#C26A12", "row": 1, "grid": True},
            {"id": "intersection", "name": "Intersection", "symbol": "circle", "colour": "#1F6E8C", "row": 1, "grid": True},
            {"id": "bridge", "name": "Bridge / overpass", "symbol": "box", "colour": "#6A4FA3", "row": 2, "grid": True},
            {"id": "culvert", "name": "Culvert", "symbol": "box", "colour": "#6A4FA3", "row": 3, "grid": False},
            {"id": "wall", "name": "Retaining wall", "symbol": "band", "colour": "#7F6000", "row": 3, "grid": False},
            {"id": "utility", "name": "Utility crossing", "symbol": "tick", "colour": "#B13A3A", "row": 4, "grid": False},
            {"id": "access", "name": "Property access", "symbol": "tick", "colour": "#5D6B70", "row": 4, "grid": False},
            {"id": "limit", "name": "Project limit", "symbol": "bar", "colour": "#18262B", "row": 1, "grid": True},
            {"id": "other", "name": "Other", "symbol": "diamond", "colour": "#5D6B70", "row": 4, "grid": False},
        ],
        "styles": [
            ("CLEAR", "Clear & grub", "line", "#548235"), ("EARTH", "Bulk earthworks", "block", "#C65911"),
            ("DRAIN", "Drainage", "line", "#00B0F0"), ("SUBBASE", "Subbase", "line", "#7F7F7F"),
            ("BASE", "Basecourse", "line", "#404040"), ("ASPHALT", "Asphalt", "line", "#18262B"),
            ("BRIDGE", "Bridge works", "block", "#6A4FA3"), ("TRAFFIC", "Traffic switch", "milestone", "#C00000"),
        ],
    },
    "tunnel": {
        "label": "Tunnel",
        "location_types": [
            {"id": "portal", "name": "Portal", "symbol": "bar", "colour": "#18262B", "row": 1, "grid": True},
            {"id": "shaft", "name": "Shaft", "symbol": "circle", "colour": "#1F6E8C", "row": 1, "grid": True},
            {"id": "station", "name": "Station box", "symbol": "band", "colour": "#1F6E8C", "row": 1, "grid": True},
            {"id": "xp", "name": "Cross passage", "symbol": "tick", "colour": "#C26A12", "row": 2, "grid": False},
            {"id": "geology", "name": "Geology / fault zone", "symbol": "band", "colour": "#B13A3A", "row": 3, "grid": False},
            {"id": "vent", "name": "Ventilation / services", "symbol": "box", "colour": "#6A4FA3", "row": 3, "grid": False},
            {"id": "other", "name": "Other", "symbol": "diamond", "colour": "#5D6B70", "row": 4, "grid": False},
        ],
        "styles": [
            ("TBM", "TBM drive", "line", "#002060"), ("DNB", "Drill & blast / roadheader", "line", "#C65911"),
            ("LINING", "Lining", "line", "#7F7F7F"), ("INVERT", "Invert", "line", "#404040"),
            ("XP", "Cross passage construction", "block", "#C26A12"), ("FITOUT", "Fit-out", "line", "#548235"),
            ("TBMLAUNCH", "TBM assembly / launch", "block", "#B13A3A"),
        ],
    },
}
PRESETS["other"] = {"label": "Other linear asset", "location_types": PRESETS["road"]["location_types"], "styles": PRESETS["road"]["styles"]}


def make_style(code: str, name: str, kind: str = "line", colour: str = "#1F6E8C", **kw) -> dict:
    s = {
        "code": code, "name": name, "kind": kind,  # line | block | bar | milestone
        "colour": colour, "width": 3 if kind in ("line", "bar") else 1.5, "dash": "solid",  # solid | dash | dot
        "fill_opacity": 0.35 if kind == "block" else 0.2,
        "label": {"show": True, "text": "{name}", "follow_slope": True, "position": "mid", "side": "above", "size": 11},
        "footprint": {"enabled": False, "length_m": 0.0, "lag_days": 0.0, "opacity": 0.18},
        "legend": True,
    }
    s.update(kw)
    return s


def new_project(name: str = "Untitled", discipline: str = "rail", ch_start_m: float = 0.0, ch_end_m: float = 10000.0,
                start: str | None = None, finish: str | None = None, unit: str = "km") -> dict:
    preset = PRESETS.get(discipline, PRESETS["rail"])
    today = dt.date.today()
    start = start or dt.date(today.year, today.month, 1).isoformat()
    finish = finish or dt.date(today.year + 1, today.month, 1).isoformat()
    ds_id = new_id("ds_")
    return {
        "schema": SCHEMA_VERSION,
        "id": new_id("prj_"),
        "name": name,
        "discipline": discipline,
        "meta": {"title": name, "subtitle": "", "client": "", "contract": "", "revision": "A", "author": "", "data_date": ""},
        "chainage": {"start_m": ch_start_m, "end_m": ch_end_m, "unit": unit, "prefix": "CH", "decimals": 3 if unit == "km" else 0,
                     "major_m": _nice_step(ch_end_m - ch_start_m) * 2, "minor_m": _nice_step(ch_end_m - ch_start_m), "reverse": False,
                     "snap_m": 10.0},
        "time": {"start": start, "finish": finish, "px_per_day": 2.0, "orientation": "down", "week_start": 1,
                 "week_labels": "project", "shade_weekends": False, "work_days_per_week": 7, "tz": "Australia/Melbourne"},
        "location_types": copy.deepcopy(preset["location_types"]),
        "location_rows": 4,
        "styles": [make_style(c, n, k, col) for c, n, k, col in preset["styles"]],
        "datasets": [{"id": ds_id, "name": "Main", "source": "manual"}],
        "view": {"main_dataset": ds_id, "compare_dataset": None, "show_footprints": True, "show_labels": True,
                 "show_time_markers": True, "show_location_grid": True},
        "sections": [],
        "locations": [],
        "time_markers": [],
        "activities": [],
        "productivities": [],
        "page": default_page(),
        "p6": None,  # {"mapping": {...}, "last_sync": "...", "source_file": "..."}
        # {"data": data-URL, "nat_w", "nat_h", "fit": "chainage"|"full", "ch_start_m", "ch_end_m", "height_px", "opacity", "keep_ratio", "show"}
        "header_image": None,
    }


def default_page() -> dict:
    return {
        "paper": "A3", "orientation": "landscape", "margins_mm": {"top": 10, "right": 10, "bottom": 10, "left": 10},
        "blocks": [
            {"id": "title", "kind": "title", "x": 0, "y": 0, "w": 0.72, "h": 0.07, "text": "{title}", "font_size": 22, "bold": True, "border": False},
            {"id": "titleblock", "kind": "titleblock", "x": 0.72, "y": 0, "w": 0.28, "h": 0.07, "border": True},
            {"id": "chart", "kind": "chart", "x": 0, "y": 0.08, "w": 0.82, "h": 0.92, "border": True},
            {"id": "legend", "kind": "legend", "x": 0.83, "y": 0.08, "w": 0.17, "h": 0.6, "border": True},
            {"id": "notes", "kind": "text", "title": "Notes", "show_title": True, "shrink": True, "x": 0.83, "y": 0.69, "w": 0.17, "h": 0.31,
             "text": "", "font_size": 9, "border": True},
        ],
    }


PAPER_MM = {"A4": (297, 210), "A3": (420, 297), "A2": (594, 420), "A1": (841, 594), "A0": (1189, 841),
            "Letter": (279, 216), "Ledger": (432, 279), "ANSI D": (864, 559)}


def _nice_step(span: float) -> float:
    raw = max(span, 1) / 20
    mag = 10 ** len(str(int(raw))) / 10
    for m in (1, 2, 5, 10):
        if raw <= m * mag:
            return m * mag
    return 10 * mag


# ------------------------------------------------------------------ helpers used by importers / exporters
def parse_t(s: str) -> dt.datetime:
    s = s.strip().replace(" ", "T")
    if len(s) == 10:
        s += "T00:00"
    return dt.datetime.fromisoformat(s[:16])


def fmt_t(t: dt.datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M")


def make_activity(dataset_id: str, code: str, name: str, start: str, finish: str, ch0_m: float, ch1_m: float,
                  style: str, **kw) -> dict:
    a = {"id": new_id("a_"), "dataset": dataset_id, "code": code, "name": name, "start": start, "finish": finish,
         "ch0_m": ch0_m, "ch1_m": ch1_m, "style": style, "wbs": "", "notes": "",
         "qty": None, "qty_unit": "", "rate": None, "rate_unit": "",  # rate is quantity per working day
         "label": None, "footprint": None,  # per-activity overrides of the style's label / footprint
         "locked": False, "p6": None}
    a.update(kw)
    return a


def normalise(p: dict) -> dict:
    """Fill gaps in older or hand-edited documents so the UI can rely on every key."""
    base = new_project(p.get("name", "Untitled"), p.get("discipline", "rail"))
    for k, v in base.items():
        if k not in p:
            p[k] = v
    for k in ("meta", "chainage", "time", "view"):
        for kk, vv in base[k].items():
            p[k].setdefault(kk, vv)
    for s in p["styles"]:
        ref = make_style(s.get("code", "X"), s.get("name", ""), s.get("kind", "line"), s.get("colour", "#1F6E8C"))
        for kk, vv in ref.items():
            s.setdefault(kk, vv)
        for sub in ("label", "footprint"):
            for kk, vv in ref[sub].items():
                s[sub].setdefault(kk, vv)
    if not p["datasets"]:
        p["datasets"] = base["datasets"]
    if p["view"].get("main_dataset") not in {d["id"] for d in p["datasets"]}:
        p["view"]["main_dataset"] = p["datasets"][0]["id"]
    return p
