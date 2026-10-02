"""TurboChart .tchart import and export (field layout taken from TurboChart 2.4 files)."""
from __future__ import annotations

import datetime as dt
import json
import re
import uuid

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

from .model import fmt_t, make_activity, make_style, new_id, new_project, parse_t

ZERO = "00000000-0000-0000-0000-000000000000"


def _gid() -> str:
    return str(uuid.uuid4())


def _col(hexs: str, a: int = 255) -> dict:
    hexs = (hexs or "#000000").lstrip("#")[:6].ljust(6, "0")
    n = int(hexs, 16)
    r, g, b = n >> 16 & 255, n >> 8 & 255, n & 255
    lin = lambda c: c / 255 / 12.92 if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4
    return {"A": a, "B": b, "G": g, "R": r, "ScA": round(a / 255, 7), "ScB": round(lin(b), 9), "ScG": round(lin(g), 9), "ScR": round(lin(r), 9)}


def _hex(c: dict | None) -> str:
    if not c:
        return "#000000"
    return "#{:02X}{:02X}{:02X}".format(c.get("R", 0), c.get("G", 0), c.get("B", 0))


def _tz(name: str):
    try:
        return ZoneInfo(name) if ZoneInfo else None
    except Exception:
        return None


def _melb_offset_h(d: dt.datetime) -> int:
    def first_sun(y, m):
        x = dt.date(y, m, 1)
        return x + dt.timedelta(days=(6 - x.weekday()) % 7)
    return 11 if (d.date() >= first_sun(d.year, 10) or d.date() < first_sun(d.year, 4)) else 10


def _to_tc(t: str, tz) -> str:
    d = parse_t(t)
    if tz is not None:
        aware = d.replace(tzinfo=tz)
        ms = int(aware.timestamp() * 1000)
        off = aware.utcoffset() or dt.timedelta(0)
    else:
        off = dt.timedelta(hours=_melb_offset_h(d))
        ms = int((d - dt.datetime(1970, 1, 1) - off).total_seconds() * 1000)
    # TurboChart writes the zone's standard offset in the suffix; the millisecond value carries the real instant
    std = min(tz.utcoffset(dt.datetime(d.year, 1, 15)), tz.utcoffset(dt.datetime(d.year, 7, 15))) if tz is not None else off
    hrs = int((std or off).total_seconds() // 3600)
    return f"/Date({ms}{'+' if hrs >= 0 else '-'}{abs(hrs):02d}00)/"


_TC_DATE = re.compile(r"/Date\((-?\d+)([+-]\d{4})?\)/")


def _from_tc(s: str | None, tz) -> str | None:
    if not s:
        return None
    m = _TC_DATE.match(s)
    if not m:
        return None
    utc = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc) + dt.timedelta(milliseconds=int(m.group(1)))
    local = utc.astimezone(tz) if tz is not None else utc + dt.timedelta(hours=_melb_offset_h(utc.replace(tzinfo=None)))
    return fmt_t(local.replace(tzinfo=None))


# ------------------------------------------------------------------ export
def export(p: dict) -> bytes:
    tz = _tz(p["time"].get("tz", "Australia/Melbourne"))
    unit = p["chainage"]["unit"]
    k = 1000.0 if unit == "km" else 1.0
    pos = lambda m: round(m / k, 6)
    black, white, grey, clear = _col("#000000"), _col("#FFFFFF"), _col("#808080"), _col("#FFFFFF", 0)
    ink, axis = _col("#18262B"), _col("#A9A9A9")

    lib, chart_vals = [], []
    for i, s in enumerate(p["styles"]):
        sid = _gid()
        c = _col(s["colour"])
        block = s["kind"] == "block"
        cv = {"FontSize": int(s["label"].get("size", 11)), "Id": sid, "Legend": bool(s.get("legend", True)), "OrderCanvas": 1, "OrderLegend": i + 1,
              "PositionOffset": 0, "ShowText": bool(s["label"].get("show")), "TextColour": black, "TextHorzAlign": 0, "TextVertAlign": 0,
              "Transparency": 0, "Visible": True}
        lib.append({"ChartValues": cv, "Description": s["name"], "DistanceOffset": 10, "EndShape": {"FillColour": c, "ShapeType": 0, "Size": 10},
                    "FillColour": c if block else white, "FillLineColour": c, "FillLineSpacing": 10, "FillLineThickness": 2, "FillType": 1 if block else 0,
                    "FontSize": int(s["label"].get("size", 11)), "Id": sid, "Legend": bool(s.get("legend", True)), "LineColour": c,
                    "LineStyle": 0 if s.get("dash", "solid") == "solid" else 1, "LineThickness": s.get("width", 2), "Name": s["code"], "OrderCanvas": 1,
                    "OrderLegend": i + 1, "PositionOffset": 0, "ShowText": bool(s["label"].get("show")),
                    "StartShape": {"FillColour": c, "ShapeType": 0, "Size": 10}, "TextColour": black, "TextHorzAlign": 0, "TextVertAlign": 0,
                    "TimeOffset": 20, "Transparency": round(1 - s.get("fill_opacity", 0.35), 2) if block else 0, "Type": 1 if block else 0,
                    "Visible": True})
        chart_vals.append({"Key": sid, "Value": cv})

    ds_ids = {d["id"]: _gid() for d in p["datasets"]}
    tasks = []
    for a in p["activities"]:
        if a["dataset"] not in ds_ids:
            continue
        tasks.append({"CalendarCode": "", "Critical": bool((a.get("p6") or {}).get("driving")), "DataSetId": ds_ids[a["dataset"]],
                      "Description": a["name"], "EndPosition": pos(a["ch1_m"]), "ExternalId": (a.get("p6") or {}).get("task_id"),
                      "FilterCode": a.get("wbs") or "", "FinishDate": _to_tc(a["finish"], tz), "Id": _gid(), "LocationCode": "", "Name": a["code"],
                      "Order": 0, "ShapeCode": a["style"], "ShowText": None, "SourceTask": None, "StartDate": _to_tc(a["start"], tz),
                      "StartPosition": pos(a["ch0_m"])})

    def loc(name, text, s, e, row, rot, fg):
        return {"Background": clear, "BorderLineColour": grey, "BorderLineThickness": 1, "EndLineColour": grey, "EndLineStyle": 0,
                "EndLineThickness": 0, "EndPosition": e, "FontSize": 12 if row <= 2 else 9, "Id": _gid(), "Name": name, "NewVersion": True,
                "Rotate": rot, "Row": row, "StartLineColour": grey, "StartLineStyle": 0, "StartLineThickness": 1, "StartPosition": s, "Text": text,
                "TextColour": fg}

    ltypes = {t["id"]: t for t in p["location_types"]}
    locs = [loc(f"S{i+1}", s["name"], pos(min(s["from_m"], s["to_m"])), pos(max(s["from_m"], s["to_m"])), 1, False, black)
            for i, s in enumerate(p["sections"])]
    min_w = (p["chainage"]["end_m"] - p["chainage"]["start_m"]) / 2000
    for i, l in enumerate(sorted(p["locations"], key=lambda l: l["ch_m"])):
        t = ltypes.get(l["type"], {"colour": "#5D6B70", "row": 4})
        s, e = (l["ch_m"], l["to_m"]) if l.get("to_m") is not None else (l["ch_m"] - min_w, l["ch_m"] + min_w)
        row = 1 + int(l.get("row") or t.get("row", 4))
        locs.append(loc(f"L{i+1:03d}", l["name"], pos(s), pos(e), row, row >= 3, _col(t["colour"])))

    def hl(name, text, s, e, d0, d1, hexs, op, fill=0, size=12):
        return {"EndPosition": e, "FillColour": _col(hexs), "FillLineColour": _col(hexs), "FillLineSpacing": 6, "FillLineThickness": 1,
                "FillType": fill, "FinishDate": d1, "Id": ZERO, "LineColour": _col(hexs), "LineStyle": 0, "LineThickness": 1, "Name": name,
                "NewVersion": True, "Opacity": op, "RotateText": d0 is None, "ShowTextLeft": True, "ShowTextRight": False, "StartDate": d0,
                "StartPosition": s, "Text": text, "TextColour": _col(hexs), "TextOffset": 0, "TextSize": size}

    hls = []
    for i, l in enumerate(p["locations"]):
        t = ltypes.get(l["type"], {})
        if l.get("grid", t.get("grid")):
            hls.append(hl(f"LG{i+1}", l["name"], pos(l["ch_m"]), pos(l["to_m"]) if l.get("to_m") is not None else None, None, None,
                          t.get("colour", "#5D6B70"), 0.15))
    for i, m in enumerate(p["time_markers"]):
        c0 = m.get("ch0_m") if m.get("ch0_m") is not None else p["chainage"]["start_m"]
        c1 = m.get("ch1_m") if m.get("ch1_m") is not None else p["chainage"]["end_m"]
        fin = m.get("finish") or fmt_t(parse_t(m["start"]) + dt.timedelta(days=1))
        hls.append(hl(f"TM{i+1}", m["label"], pos(c0), pos(c1), _to_tc(m["start"], tz), _to_tc(fin, tz), m.get("colour") or "#808080",
                      0.6 if m.get("kind") == "milestone" else 0.25, 2 if m.get("kind") == "shutdown" else 0))

    t0 = p["time"]["start"] + "T00:00"
    t1 = p["time"]["finish"] + "T00:00"
    c_lo, c_hi = pos(p["chainage"]["start_m"]), pos(p["chainage"]["end_m"])

    # header image -> TurboChart top image (it takes a raw base64 PNG or JPEG; SVG has no equivalent)
    hi = p.get("header_image") or {}
    m = re.match(r"data:image/(png|jpeg);base64,(.+)", hi.get("data") or "", re.S)
    top = {"FitTopImage": False, "ImageBase64": None, "ShowTopImage": False, "TopImageStartPosition": 0, "TopImageEndPosition": 0, "MaxImagePercentage": 20}
    if m:
        full = hi.get("fit") == "full"
        top = {"FitTopImage": full, "ImageBase64": m.group(2), "ShowTopImage": hi.get("show", True) is not False,
               "TopImageStartPosition": 0 if full else pos(hi.get("ch_start_m", p["chainage"]["start_m"])),
               "TopImageEndPosition": 0 if full else pos(hi.get("ch_end_m", p["chainage"]["end_m"])), "MaxImagePercentage": 30}

    def chart(name, ds1, ds2=None):
        return {**_chart_base(name, ds1, ds2), **top}

    def _chart_base(name, ds1, ds2=None):
        return {"AllowDragging": False, "AllowTaskCreation": False, "Annotations": [], "ChartName": name, "ChartSpecificShapeValues": chart_vals,
                "CriticalityColour": _col("#FF0000"), "CriticalityOpacity": 0.9, "CriticalityThickness": 4, "CustomPageHeight": 0, "CustomPageWidth": 0,
                "DataSet1Id": ds1, "DataSet2Blend": 0.2 if ds2 else 0, "DataSet2Colour": grey, "DataSet2Id": ds2 or ZERO, "DataSet2Offset": 0,
                "DataSet2Transparency": 0.6 if ds2 else 0.5, "DataSet3Blend": 0, "DataSet3Colour": _col("#008000"), "DataSet3Id": ZERO,
                "DataSet3Offset": 0, "DataSet3Transparency": 0.5, "EndFilter": _to_tc(t1, tz), "EndPosition": c_hi, "FitToScreen": True,
                "FitTopImage": False, "HideCalendars": False, "HideTasks": False, "HighLighters": hls, "Id": _gid(), "ImageBase64": None,
                "ImagePath": None, "IsPrintPreview": False, "LineStyleMonth": 0, "LineStylePosition": 0, "LineStyleWeek": 0, "LineStyleYear": 0,
                "LocationRows": [True] * 10, "MaxImagePercentage": 20, "MonthTimelineAxisLineColour": _col("#D9D9D9"), "MonthTimelineThickness": 1,
                "PositionAxisColour": white, "PositionAxisFontSize": 12, "PositionAxisLineColour": axis, "PositionAxisTextColour": ink,
                "PositionLineThickness": 1, "PositionScaleUnits": pos(p["chainage"]["major_m"]), "ReverseDates": p["time"].get("orientation") == "up",
                "ReversePosition": bool(p["chainage"].get("reverse")), "RotateChart": False, "Show1": True, "Show2": bool(ds2), "Show3": False,
                "ShowAnnotations": True, "ShowCritcal": False, "ShowCritcal2": False, "ShowCritcal3": False, "ShowDataSetText2": False,
                "ShowDataSetText3": False, "ShowHighlighters": True, "ShowLegend": True, "ShowLocationGridBottom": False, "ShowLocationGridTop": True,
                "ShowPositionBottom": True, "ShowPositionTop": False, "ShowTimelineLeft": True, "ShowTimelineRight": True, "ShowTopImage": False,
                "ShowWeekNumber": True, "StartFilter": _to_tc(t0, tz), "StartPosition": c_lo, "StartWeek": 0, "TimeScaleUnits": 2,
                "TimelineAxisColour": white, "TimelineAxisFontSize": 12, "TimelineAxisTextColour": ink, "TopImageEndPosition": 0,
                "TopImageStartPosition": 0, "WeekTimelineAxisLineColour": axis, "WeekTimelineThickness": 1, "YearTimelineAxisLineColour": _col("#404040"),
                "YearTimelineThickness": 2, "Zoom": 1}

    charts = [chart(d["name"], ds_ids[d["id"]]) for d in p["datasets"]]
    cmp_id = p["view"].get("compare_dataset")
    if cmp_id and cmp_id in ds_ids:
        main = p["view"]["main_dataset"]
        charts.append(chart(f'Compare - {_ds_name(p, main)} over {_ds_name(p, cmp_id)}', ds_ids[main], ds_ids[cmp_id]))

    def box(i, **o):
        b = {"BackColour": clear, "Bold": False, "FillLineColour": black, "FillLineSpacing": 10, "FillLineThickness": 2, "FillType": 0,
             "FontName": "Arial", "FontSize": 40, "Height": "__NaN__", "HorizontalAlignment": 2, "ID": i, "ImageBase64": None, "Italic": False,
             "LineColour": black, "LineThickness": 0, "Margin": {"Bottom": 0, "Left": 0, "Right": 0, "Top": 0}, "Radius": 0, "Text": "",
             "TextAlignment": 2, "TextColour": black, "TextVerticalAlignment": 1, "Underline": False, "VerticalAlignment": 3, "Width": "__NaN__"}
        b.update(o)
        return b

    view = {"AllowDragging": False, "AllowTaskCreation": False, "ChartName": "Chart1", "CustomPageHeight": 0, "CustomPageWidth": 0,
            "DataSet1Id": ZERO, "DataSet2Colour": grey, "DataSet2Id": ZERO, "DataSet2Transparency": 0.5, "DataSet3Colour": _col("#008000"),
            "DataSet3Id": ZERO, "DataSet3Transparency": 0.5, "EndFilter": _to_tc(t1, tz), "EndPosition": c_hi, "FitToScreen": True,
            "HideChartImage": False, "Id": _gid(), "ImageBase64": None, "ImagePath": None, "IsPrintPreview": False,
            "PositionScaleUnits": pos(p["chainage"]["major_m"]), "ReversePosition": bool(p["chainage"].get("reverse")), "Show1": True,
            "Show2": False, "Show3": False, "ShowCritcal": False, "ShowLegend": True, "ShowPositionBottom": True, "ShowPositionTop": False,
            "ShowTimelineLeft": True, "ShowTimelineRight": True, "StartFilter": _to_tc(t0, tz), "StartPosition": c_lo, "StartWeek": 0,
            "TimeScaleUnits": 2, "Zoom": 1}
    paper_code = {"A4": 9, "A3": 8, "A2": 66, "A1": 0, "Letter": 1, "Ledger": 3}.get(p["page"].get("paper"), 8)
    doc = {"ActiveChartId": charts[0]["Id"] if charts else ZERO, "Calendars": [], "Charts": charts,
           "DataSets": [{"AstaPP": None, "Id": ds_ids[d["id"]], "MSP": None, "Name": d["name"], "P6OPC": None, "P6WS": None, "P6WSRest": None,
                         "Primavera": None, "Safran": None, "SourceDataType": 0} for d in p["datasets"]],
           "Filters": [], "Graphics": [], "HighLighters": None, "Library": lib, "Locations": locs,
           "PageLayout": {"Chart": box("CHART", HorizontalAlignment=3, Margin={"Bottom": 0, "Left": 0, "Right": 500, "Top": 100}),
                          "CustomPageHeight": 0, "CustomPageWidth": 0, "IsPortrait": p["page"].get("orientation") == "portrait",
                          "Legend": box("LEGEND", FontSize=20, Margin={"Bottom": 300, "Left": 0, "Right": 0, "Top": 100}, Width=500),
                          "PageGraphics": [box(_gid(), Bold=True, Height=100, HorizontalAlignment=3,
                                               Margin={"Bottom": 0, "Left": 0, "Right": 500, "Top": 0},
                                               Text=p["meta"].get("title") or p["name"], VerticalAlignment=0, TextColour=ink)],
                          "PageMargin": {"Bottom": 10, "Left": 10, "Right": 10, "Top": 10}, "PaperSize": paper_code},
           "PositionPrefix": p["chainage"].get("prefix") or None, "PositionSuffix": " " + unit,
           "Properties": [{"Key": "ProjectTitle", "Value": p["meta"].get("title") or p["name"]}, {"Key": "ProjectOwner", "Value": p["meta"].get("client", "")},
                          {"Key": "Author", "Value": p["meta"].get("author", "")}, {"Key": "DataDate", "Value": p["meta"].get("data_date") or "Undefined"},
                          {"Key": "Revision", "Value": p["meta"].get("revision", "")}],
           "Tasks": tasks, "ViewOptions": view}
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")).replace('"__NaN__"', "NaN").encode("utf-8")


def _ds_name(p, did):
    return next((d["name"] for d in p["datasets"] if d["id"] == did), "")


# ------------------------------------------------------------------ import
def import_tchart(data: bytes, unit_hint: str = "auto", tz_name: str = "Australia/Melbourne") -> dict:
    text = data.decode("utf-8-sig", errors="replace")
    text = re.sub(r"\bNaN\b", "null", text)
    doc = json.loads(text)
    tz = _tz(tz_name)
    suffix = (doc.get("PositionSuffix") or "").strip().lower()
    unit = unit_hint if unit_hint in ("m", "km") else ("km" if suffix == "km" else "m")
    k = 1000.0 if unit == "km" else 1.0
    title = next((x["Value"] for x in doc.get("Properties", []) if x.get("Key") == "ProjectTitle"), "") or "TurboChart import"
    chart0 = (doc.get("Charts") or [{}])[0]
    s0 = (chart0.get("StartPosition") or 0) * k
    s1 = (chart0.get("EndPosition") or 1000) * k
    p = new_project(title, "other", s0, s1, unit=unit)
    p["meta"]["title"] = title
    p["datasets"] = [{"id": new_id("ds_"), "name": d.get("Name") or "Data set", "source": "tchart", "tc_id": d["Id"]} for d in doc.get("DataSets", [])]
    if not p["datasets"]:
        p["datasets"] = [{"id": new_id("ds_"), "name": "Main", "source": "tchart", "tc_id": ""}]
    by_tc = {d["tc_id"]: d["id"] for d in p["datasets"]}
    p["view"]["main_dataset"] = by_tc.get(chart0.get("DataSet1Id"), p["datasets"][0]["id"])
    if chart0.get("Show2") and chart0.get("DataSet2Id") in by_tc:
        p["view"]["compare_dataset"] = by_tc[chart0["DataSet2Id"]]
    p["styles"] = []
    for l in doc.get("Library", []):
        kind = "block" if l.get("Type") == 1 else "line"
        st = make_style(l.get("Name") or "S", l.get("Description") or l.get("Name") or "", kind, _hex(l.get("LineColour")))
        st["width"] = l.get("LineThickness") or st["width"]
        st["dash"] = "dash" if l.get("LineStyle") else "solid"
        st["label"]["show"] = bool(l.get("ShowText"))
        p["styles"].append(st)
    known = {s["code"] for s in p["styles"]}
    times = []
    for t in doc.get("Tasks", []):
        s, f = _from_tc(t.get("StartDate"), tz), _from_tc(t.get("FinishDate"), tz)
        if not s or not f:
            continue
        code = t.get("ShapeCode") or "TC"
        if code not in known:
            p["styles"].append(make_style(code, code, "line", "#1F6E8C"))
            known.add(code)
        p["activities"].append(make_activity(by_tc.get(t.get("DataSetId"), p["datasets"][0]["id"]), t.get("Name") or "", t.get("Description") or "",
                                             s, f, (t.get("StartPosition") or 0) * k, (t.get("EndPosition") or 0) * k, code,
                                             wbs=t.get("FilterCode") or ""))
        times += [s, f]
    if times:
        p["time"]["start"], p["time"]["finish"] = min(times)[:10], max(times)[:10]
    p["location_types"].append({"id": "tc", "name": "TurboChart location", "symbol": "band", "colour": "#5D6B70", "row": 2, "grid": False})
    for l in doc.get("Locations", []):
        a, b = (l.get("StartPosition") or 0) * k, (l.get("EndPosition") if l.get("EndPosition") is not None else l.get("StartPosition") or 0) * k
        if l.get("Row") == 1:
            p["sections"].append({"id": new_id("s_"), "name": l.get("Text") or l.get("Name") or "", "from_m": a, "to_m": b})
        else:
            p["locations"].append({"id": new_id("l_"), "name": l.get("Text") or l.get("Name") or "", "ch_m": a, "to_m": b if abs(b - a) > 1e-9 else None,
                                   "type": "tc", "row": max(1, (l.get("Row") or 2) - 1), "label": True, "grid": False, "notes": l.get("Name") or ""})
    for h in chart0.get("HighLighters") or []:
        if h.get("StartDate"):
            p["time_markers"].append({"id": new_id("t_"), "label": h.get("Text") or h.get("Name") or "", "kind": "band",
                                      "start": _from_tc(h["StartDate"], tz), "finish": _from_tc(h.get("FinishDate"), tz),
                                      "ch0_m": (h.get("StartPosition") or 0) * k if h.get("StartPosition") is not None else None,
                                      "ch1_m": h["EndPosition"] * k if h.get("EndPosition") is not None else None, "colour": _hex(h.get("FillColour"))})
    # top image: take it from the first chart that has one
    img_chart = next((c for c in doc.get("Charts") or [] if c.get("ImageBase64")), None)
    if img_chart:
        raw = img_chart["ImageBase64"]
        kind, w, hgt = _img_info(raw)
        full = bool(img_chart.get("FitTopImage")) or not (img_chart.get("TopImageEndPosition") or 0) > (img_chart.get("TopImageStartPosition") or 0)
        p["header_image"] = {"data": f"data:image/{kind};base64,{raw}", "nat_w": w, "nat_h": hgt, "name": "TurboChart top image",
                             "fit": "full" if full else "chainage",
                             "ch_start_m": None if full else img_chart["TopImageStartPosition"] * k,
                             "ch_end_m": None if full else img_chart["TopImageEndPosition"] * k,
                             "height_px": None, "opacity": 1, "keep_ratio": False, "show": img_chart.get("ShowTopImage", True) is not False}
    return p


def _img_info(b64: str) -> tuple[str, int, int]:
    """Image type and pixel size from the first bytes of a base64 PNG or JPEG."""
    import base64
    head = base64.b64decode(b64[:120000] + "=" * (-len(b64[:120000]) % 4), validate=False)
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png", int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
    if head[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(head):
            if head[i] != 0xFF:
                break
            marker, seg = head[i + 1], int.from_bytes(head[i + 2:i + 4], "big")
            if marker in (0xC0, 0xC1, 0xC2):
                return "jpeg", int.from_bytes(head[i + 7:i + 9], "big"), int.from_bytes(head[i + 5:i + 7], "big")
            i += 2 + seg
        return "jpeg", 1000, 200
    return "png", 1000, 200
