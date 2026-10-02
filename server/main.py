"""Time-Chainage Studio API.

Run:  python -m uvicorn server.main:app --port 8765   (from the time-chainage-studio folder)
Docs: http://localhost:8765/docs
"""
from __future__ import annotations

import datetime as dt
import pathlib
import re

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import excel_import, store, tchart, xer
from .model import PAPER_MM, PRESETS, new_id, new_project, normalise

app = FastAPI(title="Time-Chainage Studio", version="0.1.0",
              description="Time-chainage display for P6 schedules: rail, road and tunnel. No scheduling logic; P6 stays the master.")
WEB = pathlib.Path(__file__).resolve().parent.parent / "web"


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")[:60] or "project"


def _get(pid: str) -> dict:
    try:
        return store.load(pid)
    except KeyError:
        raise HTTPException(404, f"Project {pid} not found")


# ------------------------------------------------------------------ reference data
@app.get("/api/presets")
def presets():
    return {"disciplines": {k: {"label": v["label"], "location_types": v["location_types"], "styles": v["styles"]} for k, v in PRESETS.items()},
            "papers": PAPER_MM, "date_fields": xer.DATE_FIELDS}


# ------------------------------------------------------------------ projects
@app.get("/api/projects")
def list_projects():
    return store.list_projects()


@app.post("/api/projects")
def create_project(body: dict = Body(...)):
    p = new_project(body.get("name") or "Untitled", body.get("discipline", "rail"), float(body.get("start_m", 0)), float(body.get("end_m", 10000)),
                    body.get("start"), body.get("finish"), body.get("unit", "km"))
    for k in ("meta", "chainage", "time"):
        if isinstance(body.get(k), dict):
            p[k].update(body[k])
    if body.get("sections"):
        p["sections"] = [dict(s, id=s.get("id") or new_id("s_")) for s in body["sections"]]
    return store.save(p)


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    return _get(pid)


@app.put("/api/projects/{pid}")
def put_project(pid: str, body: dict = Body(...)):
    if body.get("id") != pid:
        raise HTTPException(400, "The project id in the body does not match the URL.")
    return store.save(body)


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    store.delete(pid)
    return {"deleted": pid}


@app.post("/api/projects/{pid}/duplicate")
def duplicate(pid: str):
    p = _get(pid)
    p["id"] = new_id("prj_")
    p["name"] += " (copy)"
    return store.save(p)


# ------------------------------------------------------------------ import
@app.post("/api/import/excel")
async def import_excel(file: UploadFile = File(...), discipline: str = Form("rail")):
    try:
        p = excel_import.import_workbook(await file.read(), discipline)
    except ValueError as e:
        raise HTTPException(422, str(e))
    p["name"] = pathlib.Path(file.filename or "Excel import").stem
    return store.save(p)


@app.post("/api/import/tchart")
async def import_tc(file: UploadFile = File(...), unit: str = Form("auto")):
    try:
        p = tchart.import_tchart(await file.read(), unit)
    except (ValueError, KeyError) as e:
        raise HTTPException(422, f"Could not read that TurboChart file: {e}")
    p["name"] = pathlib.Path(file.filename or "TurboChart import").stem
    return store.save(p)


@app.post("/api/p6/inspect")
async def p6_inspect(file: UploadFile = File(...)):
    """Step 1 of a P6 import or sync: upload an XER, get back what can be mapped and a suggested mapping."""
    data = await file.read()
    try:
        x = xer.parse(data)
    except ValueError as e:
        raise HTTPException(422, str(e))
    token = xer.new_token()
    store.keep_upload(token, data, ".xer")
    d = xer.describe(x)
    return {"token": token, "file": file.filename, "describe": d, "suggested": xer.suggest_mapping(d)}


@app.post("/api/p6/codes/{token}/{code_type}")
def p6_code_values(token: str, code_type: str):
    x = xer.parse(store.get_upload(token, ".xer"))
    vals = [r for r in x["tables"].get("ACTVCODE", {}).get("rows", []) if r["actv_code_type_id"] == code_type]
    return [{"id": v["actv_code_id"], "short_name": v.get("short_name"), "name": v.get("actv_code_name")} for v in vals]


@app.post("/api/p6/preview")
def p6_preview(body: dict = Body(...)):
    """Apply a mapping without saving: first rows plus counts, so the dialog can show what will come in."""
    x = xer.parse(store.get_upload(body["token"], ".xer"))
    p = new_project("preview")
    res = xer.apply_mapping(x, body["mapping"], p, "preview")
    rows = [{k: a[k] for k in ("code", "name", "start", "finish", "ch0_m", "ch1_m", "style", "wbs")} for a in res["activities"][:40]]
    return {"count": len(res["activities"]), "skipped": res["skipped"], "rows": rows, "styles": [s["code"] for s in res["new_styles"]]}


@app.post("/api/p6/import")
def p6_import(body: dict = Body(...)):
    """Create a project from an XER (or add a dataset to an existing project) using a mapping."""
    x = xer.parse(store.get_upload(body["token"], ".xer"))
    mapping = body["mapping"]
    if body.get("project_id"):
        p = _get(body["project_id"])
    else:
        setup = body.get("setup") or {}
        p = new_project(setup.get("name") or body.get("file") or "P6 import", setup.get("discipline", "rail"), unit=setup.get("unit", "km"))
        p["styles"] = []
        p["datasets"] = []
    ds = {"id": new_id("ds_"), "name": mapping.get("dataset_name") or body.get("file") or "P6", "source": "p6", "mapping": mapping,
          "last_sync": dt.datetime.now().isoformat(timespec="seconds"), "source_file": body.get("file")}
    p["datasets"].append(ds)
    res = xer.apply_mapping(x, mapping, p, ds["id"])
    p["styles"].extend(res["new_styles"])
    p["activities"].extend(res["activities"])
    p["p6"] = {"mapping": mapping}
    if not body.get("project_id") and res["activities"]:
        lo = min(min(a["ch0_m"], a["ch1_m"]) for a in res["activities"])
        hi = max(max(a["ch0_m"], a["ch1_m"]) for a in res["activities"])
        pad = max((hi - lo) * 0.02, 10)
        p["chainage"]["start_m"], p["chainage"]["end_m"] = lo - pad, hi + pad
        p["time"]["start"] = min(a["start"] for a in res["activities"])[:10]
        p["time"]["finish"] = max(a["finish"] for a in res["activities"])[:10]
    p["view"]["main_dataset"] = ds["id"]
    p = store.save(p)
    return {"project": p, "skipped": res["skipped"], "count": len(res["activities"])}


@app.post("/api/projects/{pid}/p6/sync")
def p6_sync(pid: str, body: dict = Body(...)):
    """Re-read a newer XER into an existing P6 dataset with its saved mapping (dates, chainage, style)."""
    p = _get(pid)
    ds = next((d for d in p["datasets"] if d["id"] == body["dataset_id"]), None)
    if not ds or not ds.get("mapping"):
        raise HTTPException(400, "That dataset has no saved P6 mapping. Import it from P6 first.")
    mapping = body.get("mapping") or ds["mapping"]
    x = xer.parse(store.get_upload(body["token"], ".xer"))
    report = xer.sync(p, x, mapping, ds["id"])
    if body.get("apply", True):
        ds["mapping"] = mapping
        ds["last_sync"] = dt.datetime.now().isoformat(timespec="seconds")
        ds["source_file"] = body.get("file") or ds.get("source_file")
        p = store.save(p)
    return {"report": report, "project": p}


# ------------------------------------------------------------------ export
@app.get("/api/projects/{pid}/export/xer")
def export_xer(pid: str, dataset: str | None = None):
    p = _get(pid)
    data = xer.write(p, dataset)
    ds = next((d["name"] for d in p["datasets"] if d["id"] == (dataset or p["view"]["main_dataset"])), "")
    return Response(data, media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{_slug(p["name"] + "_" + ds)}.xer"'})


@app.get("/api/projects/{pid}/export/tchart")
def export_tchart(pid: str):
    p = _get(pid)
    return Response(tchart.export(p), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{_slug(p["name"])}.tchart"'})


@app.get("/api/projects/{pid}/export/json")
def export_json(pid: str):
    p = _get(pid)
    return JSONResponse(p, headers={"Content-Disposition": f'attachment; filename="{_slug(p["name"])}.tcs.json"'})


@app.post("/api/import/json")
async def import_json(file: UploadFile = File(...)):
    import json
    try:
        p = json.loads((await file.read()).decode("utf-8"))
        p["id"] = new_id("prj_")
        return store.save(normalise(p))
    except (ValueError, KeyError) as e:
        raise HTTPException(422, f"Not a Time-Chainage Studio project: {e}")


# ------------------------------------------------------------------ front end
@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


app.mount("/", StaticFiles(directory=WEB), name="web")
