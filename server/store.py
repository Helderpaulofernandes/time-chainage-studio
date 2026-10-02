"""Projects are stored as one JSON file each. Uploads waiting for a field mapping are kept alongside."""
from __future__ import annotations

import json
import os
import pathlib
import tempfile

from .model import normalise


def _pick_data_dir() -> pathlib.Path:
    wanted = os.environ.get("TCS_DATA") or str(pathlib.Path(__file__).resolve().parent.parent / "data")
    for cand in (pathlib.Path(wanted), pathlib.Path.home() / ".time-chainage-studio"):
        try:
            (cand / "projects").mkdir(parents=True, exist_ok=True)
            (cand / "uploads").mkdir(parents=True, exist_ok=True)
            probe = cand / ".write-test"
            probe.write_text("ok")
            probe.unlink()
            return cand
        except OSError:
            continue
    raise RuntimeError("No writable data folder. Set TCS_DATA to a folder you can write to.")


DATA = _pick_data_dir()
PROJECTS = DATA / "projects"
UPLOADS = DATA / "uploads"


def _path(pid: str) -> pathlib.Path:
    if not pid.replace("_", "").isalnum():
        raise KeyError(pid)
    return PROJECTS / f"{pid}.json"


def list_projects() -> list[dict]:
    out = []
    for f in sorted(PROJECTS.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
        try:
            p = json.loads(f.read_text(encoding="utf-8"))
            out.append({"id": p["id"], "name": p.get("name", ""), "discipline": p.get("discipline", ""),
                        "activities": len(p.get("activities", [])), "modified": f.stat().st_mtime})
        except (OSError, ValueError, KeyError):
            continue
    return out


def load(pid: str) -> dict:
    f = _path(pid)
    if not f.exists():
        raise KeyError(pid)
    return normalise(json.loads(f.read_text(encoding="utf-8")))


def save(p: dict) -> dict:
    p = normalise(p)
    p["rev"] = int(p.get("rev") or 0) + 1  # every save gets a new revision; see main.put_project
    f = _path(p["id"])
    # write then replace, so a crash never leaves half a project on disk
    fd, tmp = tempfile.mkstemp(dir=PROJECTS, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as h:
        json.dump(p, h, ensure_ascii=False, indent=1)
    os.replace(tmp, f)
    return p


def delete(pid: str) -> None:
    _path(pid).unlink(missing_ok=True)


def keep_upload(token: str, data: bytes, ext: str) -> pathlib.Path:
    f = UPLOADS / f"{token}{ext}"
    f.write_bytes(data)
    return f


def get_upload(token: str, ext: str) -> bytes:
    if not token.isalnum():
        raise KeyError(token)
    f = UPLOADS / f"{token}{ext}"
    if not f.exists():
        raise KeyError(token)
    return f.read_bytes()
