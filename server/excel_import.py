"""Import an Excel time-chainage workbook.

Sheets are recognised by their header rows, not their names:
  * activity register  - columns ID, Activity, Start, Finish, CH from, CH to (one per staging option -> one dataset each)
  * assets             - columns Type, Name, Chainage from, Chainage to -> location markers
  * productivities     - columns Activity, Crew, Productivity, Qty -> productivity library
  * assumptions        - two-column notes, attached to the matching dataset
  * the drawn chart    - "SECTION" row -> section markers; full-width bands and red milestone lines drawn as shapes -> time markers
"""
from __future__ import annotations

import datetime as dt
import io
import re
import zipfile

import openpyxl
from openpyxl.utils import get_column_letter

from .model import fmt_t, make_activity, make_style, new_id, new_project

PALETTE = ["#002060", "#00B0F0", "#FFC000", "#92D050", "#C00000", "#C65911", "#7030A0", "#548235", "#FF66CC",
           "#996633", "#404040", "#1F8A86", "#8B0000", "#7F7F7F", "#E2C46B", "#4F81BD", "#A33F7A", "#2F8A55"]


def _norm(v) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip().lower()


def _find_header(ws, required: list[list[str]], max_rows: int = 12):
    """Return (row_index, {key: col_index}) for the first row containing every required header (any alias)."""
    for r in range(1, min(ws.max_row, max_rows) + 1):
        cells = {c: _norm(ws.cell(r, c).value) for c in range(1, min(ws.max_column, 40) + 1)}
        found = {}
        for aliases in required:
            for c, txt in cells.items():
                if txt and any(txt == a or txt.startswith(a) for a in aliases):
                    found[aliases[0]] = c
                    break
        if len(found) == len(required):
            return r, cells
    return None, None


def _col(cells: dict, *aliases) -> int | None:
    for c, txt in cells.items():
        if txt and any(txt == a or txt.startswith(a) for a in aliases):
            return c
    return None


def _d(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    return None


def _style_key(name: str) -> tuple[str, str]:
    base = re.split(r"\s+[–—-]\s+", name.strip())[0]
    base = re.sub(r"\s*\(.*?\)\s*", " ", base).strip()
    words = [w for w in re.sub(r"[^A-Za-z0-9 ]", " ", base).upper().split() if w not in ("AND", "THE", "OF", "CREW")]
    code = ""
    for w in words:  # whole words only, up to 16 characters
        if len(code) + len(w) + (1 if code else 0) > 16:
            break
        code = f"{code}_{w}" if code else w
    code = code or (words[0][:16] if words else "ACT")
    return code, _smart_title(base) if base.isupper() else base


def _smart_title(s: str) -> str:
    """Title-case an ALL-CAPS name but keep short acronyms such as LX, AO or TBM."""
    return " ".join(w if (len(w) <= 3 and w.isalpha() and w not in ("AND", "THE", "FOR", "ALL", "OFF")) else w.capitalize() for w in s.split())


DATE_RE = re.compile(r"(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{4})", re.I)
MONTHS = {m: i + 1 for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}


def import_workbook(data: bytes, discipline: str = "rail") -> dict:
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    registers, assets, prods, notes = [], [], [], {}
    chart_sheets = []
    for ws in wb.worksheets:
        hr, cells = _find_header(ws, [["id"], ["start"], ["finish"], ["ch from", "chainage from", "start chainage", "from ch"],
                                      ["ch to", "chainage to", "end chainage", "to ch"]])
        if hr:
            title = next((str(ws.cell(r, c).value) for r in range(1, hr) for c in range(1, 4) if ws.cell(r, c).value), ws.title)
            registers.append((ws, hr, cells, title))
            continue
        hr, cells = _find_header(ws, [["type"], ["chainage from", "ch from"]])
        if hr:
            assets.append((ws, hr, cells))
            continue
        hr, cells = _find_header(ws, [["activity"], ["crew"], ["productivity"]])
        if hr:
            prods.append((ws, hr, cells))
            continue
        if _find_header(ws, [["section"]], 6)[0] and _find_header(ws, [["km (start of column)", "km"]], 10)[0]:
            chart_sheets.append(ws)
            continue
        if ws.max_column <= 4 and "assumption" in ws.title.lower():
            notes[ws.title] = [(str(r[1]), str(r[2])) for r in ws.iter_rows(min_row=2, values_only=True) if r[1] and r[2]]
    if not registers:
        raise ValueError("No activity register found. A register needs the columns ID, Start, Finish, CH from and CH to.")

    # ---------------------------------------------------------- activities
    datasets, raw = [], []
    for ws, hr, cells, title in registers:
        c = dict(id=_col(cells, "id"), name=_col(cells, "activity", "name", "description"), leg=_col(cells, "leg", "direction"),
                 start=_col(cells, "start"), finish=_col(cells, "finish"), ch0=_col(cells, "ch from", "chainage from", "start chainage", "from ch"),
                 ch1=_col(cells, "ch to", "chainage to", "end chainage", "to ch"), rate=_col(cells, "avg rate", "rate"),
                 qty=_col(cells, "qty", "quantity"), stand=_col(cells, "stand-down", "standdown"), basis=_col(cells, "source", "basis"))
        rate_hdr = _norm(ws.cell(hr, c["rate"]).value) if c["rate"] else ""
        name = re.sub(r"^activity register\s*[—–-]\s*", "", title, flags=re.I).strip()
        ds = {"id": new_id("ds_"), "name": name.title() if name.isupper() else name, "source": f"excel:{ws.title}", "notes": []}
        for nt, rows in notes.items():
            if nt.lower().replace("assumptions", "").strip(" -") == ws.title.lower().replace("activity register", "").strip(" -"):
                ds["notes"] = rows
        datasets.append(ds)
        for r in range(hr + 1, ws.max_row + 1):
            g = lambda k: ws.cell(r, c[k]).value if c.get(k) else None
            s, f = _d(g("start")), _d(g("finish"))
            if not g("id") or not s or not f or g("ch0") is None or g("ch1") is None:
                continue
            raw.append(dict(ds=ds["id"], id=str(g("id")), name=str(g("name") or g("id")), leg=str(g("leg") or ""), start=s, finish=f,
                            ch0=float(g("ch0")), ch1=float(g("ch1")), rate=g("rate"), rate_hdr=rate_hdr, qty=g("qty"), stand=g("stand"),
                            basis=g("basis")))
    big = max(max(abs(x["ch0"]), abs(x["ch1"])) for x in raw)
    unit = "km" if big < 5000 else "m"
    k = 1000.0 if unit == "km" else 1.0

    # ---------------------------------------------------------- styles, grouped by activity family
    families: dict[str, dict] = {}
    by_label: dict[str, str] = {}
    for x in raw:
        code, label = _style_key(x["name"])
        if label not in by_label:  # same short code for two different families -> number it
            base, n = code, 2
            while code in families:
                code = f"{base[:14]}_{n}"
                n += 1
            by_label[label] = code
        code = by_label[label]
        f = families.setdefault(code, {"name": label, "rows": []})
        f["rows"].append(x)
        x["style"] = code
    styles = []
    for i, (code, f) in enumerate(families.items()):
        static = all(abs(x["ch1"] - x["ch0"]) * k < 1 or _norm(x["leg"]) in ("static", "corridor-wide", "interface", "all crews") for x in f["rows"])
        styles.append(make_style(code, f["name"], "block" if static else "line", PALETTE[i % len(PALETTE)]))

    # ---------------------------------------------------------- band rows (interfaces, stand-downs) become time markers
    markers = []
    acts = []
    for x in raw:
        leg = _norm(x["leg"])
        if leg in ("interface", "all crews") and abs(x["ch1"] - x["ch0"]) * k > 1:
            continue  # drawn as bands from the chart sheet when present, else added below
        a = make_activity(x["ds"], x["id"], x["name"], fmt_t(dt.datetime.combine(x["start"], dt.time())),
                          fmt_t(dt.datetime.combine(x["finish"] + dt.timedelta(days=1), dt.time())), x["ch0"] * k, x["ch1"] * k, x["style"],
                          notes=" · ".join(str(v) for v in (x["leg"], x["qty"], x["basis"]) if v and str(v) != "—"))
        days = (x["finish"] - x["start"]).days + 1
        length = abs(x["ch1"] - x["ch0"]) * k
        if length > 1:
            a["qty"], a["qty_unit"] = round(length, 1), "m"
            a["rate"], a["rate_unit"] = round(length / days, 1), "m/day"
        if x["stand"]:
            a["notes"] = (a["notes"] + f' · stand-downs {x["stand"]}').strip(" ·")
        acts.append(a)

    # ---------------------------------------------------------- locations from the assets sheet
    TYPE_MAP = [("loop", "loop"), ("level crossing", "lx"), ("pedestrian", "ped"), ("bridge", "bridge"), ("culvert", "culvert"),
                ("turnout", "turnout"), ("track", "zone"), ("station", "station"), ("limit", "limit")]
    locations = []
    for ws, hr, cells in assets:
        ct, cn, c0, c1, cw = (_col(cells, "type"), _col(cells, "name", "description"), _col(cells, "chainage from", "ch from"),
                              _col(cells, "chainage to", "ch to"), _col(cells, "works", "notes", "scope"))
        for r in range(hr + 1, ws.max_row + 1):
            v0 = ws.cell(r, c0).value
            if v0 is None or not isinstance(v0, (int, float)):
                continue
            tname = _norm(ws.cell(r, ct).value)
            tid = next((t for key, t in TYPE_MAP if key in tname), "other")
            v1 = ws.cell(r, c1).value if c1 else None
            locations.append({"id": new_id("l_"), "name": str(ws.cell(r, cn).value or tname), "ch_m": float(v0) * k,
                              "to_m": float(v1) * k if isinstance(v1, (int, float)) else None, "type": tid, "row": None,
                              "label": tid in ("loop", "lx", "station", "limit", "zone"), "grid": tid in ("loop", "limit"),
                              "notes": str(ws.cell(r, cw).value or "") if cw else ""})

    # ---------------------------------------------------------- productivities
    productivities = []
    for ws, hr, cells in prods:
        cA, cC, cP, cPn, cQ, cQn, cCrew, cSh = (_col(cells, "activity"), _col(cells, "crew"), _col(cells, "productivity"),
                                                  _col(cells, "productivity no"), _col(cells, "qty"), _col(cells, "qty no"), None,
                                                  _col(cells, "no. shifts", "shifts"))
        crew_cols = [c for c, t in cells.items() if t == "crew"]
        cCrew = crew_cols[1] if len(crew_cols) > 1 else None
        for r in range(hr + 1, ws.max_row + 1):
            act = ws.cell(r, cA).value
            if not act:
                continue
            productivities.append({"id": new_id("p_"), "activity": str(act), "resources": str(ws.cell(r, cC).value or ""),
                                   "rate_text": str(ws.cell(r, cP).value or ""), "rate": ws.cell(r, cPn).value if cPn else None,
                                   "qty_text": str(ws.cell(r, cQ).value or ""), "qty": ws.cell(r, cQn).value if cQn else None,
                                   "crew": str(ws.cell(r, cCrew).value or "") if cCrew else "", "shifts": ws.cell(r, cSh).value if cSh else None})

    # ---------------------------------------------------------- chart sheet: sections + drawn bands and milestones
    sections = []
    title = None
    if chart_sheets:
        ws = chart_sheets[0]
        title = ws.cell(1, 2).value
        sections = _sections(ws, locations, k)
        markers = _drawn_markers(data, wb, ws, k)
    if not markers:
        for x in raw:
            if _norm(x["leg"]) in ("interface", "all crews"):
                markers.append({"id": new_id("t_"), "label": x["name"], "kind": "shutdown" if "stand" in x["name"].lower() else "band",
                                "start": fmt_t(dt.datetime.combine(x["start"], dt.time())),
                                "finish": fmt_t(dt.datetime.combine(x["finish"] + dt.timedelta(days=1), dt.time())),
                                "ch0_m": None, "ch1_m": None, "colour": "#808080"})

    # register rows drawn as bands: short ones (a stand-down) take their exact dates from the register
    for x in raw:
        if _norm(x["leg"]) not in ("interface", "all crews") or (x["finish"] - x["start"]).days > 31:
            continue
        first = x["name"].split()[0].lower()
        for m in markers:
            if m["kind"] != "milestone" and m["label"].lower().startswith(first):
                m["start"] = fmt_t(dt.datetime.combine(x["start"], dt.time()))
                m["finish"] = fmt_t(dt.datetime.combine(x["finish"] + dt.timedelta(days=1), dt.time()))
    used = {a["style"] for a in acts}
    styles = [s for s in styles if s["code"] in used]

    # ---------------------------------------------------------- assemble
    ch_lo = min(min(a["ch0_m"], a["ch1_m"]) for a in acts)
    ch_hi = max(max(a["ch0_m"], a["ch1_m"]) for a in acts)
    t_lo = min(a["start"] for a in acts)[:10]
    t_hi = max(a["finish"] for a in acts)[:10]
    if markers:  # drop the legend sample drawn below the chart; let milestones extend the time range
        cutoff = (dt.date.fromisoformat(t_hi) + dt.timedelta(days=45)).isoformat()
        markers = [m for m in markers if m["kind"] == "milestone" or m["start"][:10] <= cutoff]
        t_hi = max([t_hi] + [(dt.date.fromisoformat(m["start"][:10]) + dt.timedelta(days=7)).isoformat() for m in markers])
    step = 1000.0 if unit == "km" else 100.0
    p = new_project(str(title or registers[0][3])[:120], discipline, (ch_lo // (10 * step)) * 10 * step - 0,
                    -(-ch_hi // (10 * step)) * 10 * step, t_lo, t_hi, unit)
    p["meta"]["title"] = re.split(r"\s+[—–]\s+", str(title or p["name"]))[0][:80]
    p["meta"]["subtitle"] = str(title or "")
    p["chainage"].update({"major_m": 10 * step, "minor_m": step if unit == "km" else 50, "decimals": 3 if unit == "km" else 0, "snap_m": 10.0})
    lt0 = dt.date.fromisoformat(t_lo)
    p["time"]["start"] = (lt0 - dt.timedelta(days=lt0.weekday())).isoformat()
    p["time"]["px_per_day"] = 1.6
    p["styles"] = styles
    p["datasets"] = datasets
    p["view"]["main_dataset"] = datasets[0]["id"]
    p["view"]["compare_dataset"] = datasets[1]["id"] if len(datasets) > 1 else None
    p["activities"] = acts
    p["locations"] = locations
    if sections:  # the sheet's sections are 1 km columns; pin the ends to the work extents
        sections[0]["from_m"], sections[-1]["to_m"] = ch_lo, ch_hi
    p["sections"] = sections
    p["time_markers"] = markers
    p["productivities"] = productivities
    limits = [l for l in locations if l["type"] == "limit"]
    if not limits:
        for v in (min(min(a["ch0_m"], a["ch1_m"]) for a in acts), max(max(a["ch0_m"], a["ch1_m"]) for a in acts)):
            p["locations"].append({"id": new_id("l_"), "name": "Limit", "ch_m": v, "to_m": None, "type": "limit", "row": None, "label": True,
                                   "grid": True, "notes": "From the activity extents"})
    notes_block = p["page"]["blocks"][-1]
    if datasets[0].get("notes"):
        notes_block.update(title="Assumptions", shrink=True, text="\n".join(f"{k_}: {v_}" for k_, v_ in datasets[0]["notes"]))
    return p


def _sections(ws, locations, k):
    sec_row = km_row = None
    for r in range(1, 12):
        lab = _norm(ws.cell(r, 2).value)
        if lab == "section":
            sec_row = r
        if lab.startswith("km (start of column)"):
            km_row = r
    if not sec_row or not km_row:
        return []
    km = {c: ws.cell(km_row, c).value for c in range(3, ws.max_column + 1) if isinstance(ws.cell(km_row, c).value, (int, float))}
    if not km:
        return []
    out = []
    ranges = sorted([m for m in ws.merged_cells.ranges if m.min_row == sec_row], key=lambda m: m.min_col)
    for m in ranges:
        name = ws.cell(sec_row, m.min_col).value
        if not name or m.min_col not in km:
            continue
        a = km[m.min_col] * k
        b = (km.get(m.max_col, km[max(km)]) + 1) * k
        out.append({"id": new_id("s_"), "name": str(name).title(), "from_m": a, "to_m": b})
    # snap shared boundaries to a named location (e.g. "... – GLEN THOMPSON" | "GLEN THOMPSON – ...") when one exists
    places = [l for l in locations if l["type"] in ("loop", "station", "limit")]
    for i in range(len(out) - 1):
        left = re.split(r"\s*[–—-]\s*", out[i]["name"])[-1].lower()
        hit = next((l for l in places if left and left.split()[0] in l["name"].lower()), None)
        if hit:
            out[i]["to_m"] = out[i + 1]["from_m"] = hit["ch_m"]
    lo = min((a["ch_m"] for a in locations if a["type"] == "limit"), default=None)
    if out and locations:
        out[0]["from_m"] = max(out[0]["from_m"], min(l["ch_m"] for l in locations))
        out[-1]["to_m"] = min(out[-1]["to_m"], max((l["to_m"] or l["ch_m"]) for l in locations))
    return out


def _drawn_markers(data: bytes, wb, ws, k) -> list[dict]:
    """Read full-width bands and horizontal milestone lines from the sheet's drawing layer."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return []
    idx = wb.worksheets.index(ws) + 1
    rels_name = f"xl/worksheets/_rels/sheet{idx}.xml.rels"
    drawing = None
    if rels_name in z.namelist():
        m = re.search(r'Target="\.\./drawings/(drawing\d+\.xml)"', z.read(rels_name).decode("utf-8", "replace"))
        drawing = f"xl/drawings/{m.group(1)}" if m else None
    if not drawing or drawing not in z.namelist():
        return []
    xml = z.read(drawing).decode("utf-8", "replace")
    # time grid: first "Week commencing" date row and rows per week
    head = next(((r, c) for r in range(1, 40) for c in range(1, 4) if _norm(ws.cell(r, c).value).startswith("week commencing")), None)
    if not head:
        return []
    date_rows = [r for r in range(head[0] + 1, ws.max_row + 1) if isinstance(ws.cell(r, head[1]).value, dt.datetime)]
    if len(date_rows) < 2:
        return []
    r0, per_week = date_rows[0], date_rows[1] - date_rows[0]
    d0 = ws.cell(r0, head[1]).value
    height = lambda r: (ws.row_dimensions[r].height or ws.sheet_format.defaultRowHeight or 15) * 12700

    def when(row0: int, off: int) -> dt.datetime:  # row0 is 0-based from the drawing
        r = row0 + 1
        frac = off / height(r)
        return d0 + dt.timedelta(days=7 * ((r - r0) + frac) / per_week)

    anchors = re.findall(r"<xdr:twoCellAnchor.*?</xdr:twoCellAnchor>", xml, re.S)
    pos = re.compile(r"<xdr:from><xdr:col>(\d+)</xdr:col><xdr:colOff>(-?\d+)</xdr:colOff><xdr:row>(\d+)</xdr:row><xdr:rowOff>(-?\d+)</xdr:rowOff></xdr:from>"
                     r"<xdr:to><xdr:col>(\d+)</xdr:col><xdr:colOff>(-?\d+)</xdr:colOff><xdr:row>(\d+)</xdr:row><xdr:rowOff>(-?\d+)</xdr:rowOff></xdr:to>")
    items = []
    for a in anchors:
        m = pos.search(a)
        if not m:
            continue
        g = list(map(int, m.groups()))
        txt = "".join(re.findall(r"<a:t>([^<]*)</a:t>", a)).replace("&amp;", "&").strip()
        geom = re.search(r'prst="(\w+)"', a)
        cols = re.findall(r'srgbClr val="(\w+)"', a)
        items.append({"c0": g[0], "r0": g[2], "o0": g[3], "c1": g[4], "r1": g[6], "o1": g[7], "text": txt,
                      "geom": geom.group(1) if geom else "", "colour": "#" + cols[0] if cols else "#808080"})
    last_col = max(i["c1"] for i in items) if items else 0
    out = []
    for i, it in enumerate(items):
        full = it["c0"] <= 3 and it["c1"] >= last_col - 3
        if not full:
            continue
        label = it["text"]
        if not label and i + 1 < len(items) and items[i + 1]["text"] and abs(items[i + 1]["r0"] - it["r0"]) <= 1:
            label = items[i + 1]["text"]
        t0, t1 = when(it["r0"], it["o0"]), when(it["r1"], it["o1"])
        if it["geom"] == "rect" and (t1 - t0).days < 60 and label:
            # bands are drawn within a week row; snap to whole days
            s = dt.datetime.combine(t0.date() + dt.timedelta(days=1 if t0.hour >= 12 else 0), dt.time())
            if "TUE" in label.upper() and s.weekday() != 1:
                s = dt.datetime.combine(t0.date() - dt.timedelta(days=t0.weekday()) + dt.timedelta(days=1), dt.time())
            span = 2 if "TUE" in label.upper() and "THU" in label.upper() else max(1, round((t1 - t0).total_seconds() / 86400))
            out.append({"id": new_id("t_"), "label": label.split(" — ")[0].title(), "kind": "shutdown" if "STAND-DOWN" in label.upper() else "band",
                        "start": fmt_t(s), "finish": fmt_t(s + dt.timedelta(days=span)), "ch0_m": None, "ch1_m": None,
                        "colour": "#808080" if "STAND-DOWN" in label.upper() else "#BF8F00"})
        elif it["geom"] == "line" and it["r0"] == it["r1"]:
            near = next((x for x in items[i + 1:i + 3] if x["text"]), None)
            lab = near["text"] if near else ""
            dm = DATE_RE.search(lab)
            if dm:
                day = dt.datetime(int(dm.group(3)), MONTHS[dm.group(2).upper()[:3]], int(dm.group(1)))
            else:
                day = dt.datetime.combine(t0.date(), dt.time())
            out.append({"id": new_id("t_"), "label": lab.split(" — ")[0].split(" (")[0][:70] or "Milestone", "kind": "milestone",
                        "start": fmt_t(day), "finish": None, "ch0_m": None, "ch1_m": None, "colour": it["colour"]})
    # the sheet's legend sample sits after the chart window; drop markers more than a year past the last band
    if out:
        out.sort(key=lambda m: m["start"])
    seen, uniq = set(), []
    for m in out:
        key = (m["label"], m["start"])
        if key not in seen:
            seen.add(key)
            uniq.append(m)
    return uniq
