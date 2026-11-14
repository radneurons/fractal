"""Opening Magician Project Package (.omproj) — a portable archive of everything needed
to restore a project on another computer: database snapshot, PGNs, studies, opening
books, engine *metadata* (never engine binaries — their licences differ), research
findings, training progress and preferences.
"""
from __future__ import annotations

import json
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

from . import __version__
from .books.model import export_json
from .books.store import BookStore
from .db import SCHEMA_VERSION, Database

MANIFEST = "manifest.json"


def export_package(db: Database, books: BookStore, dest: Path) -> dict[str, Any]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        snap = db.backup(Path(tmp) / "database.sqlite3")
        counts = {t: db.scalar(f"SELECT COUNT(*) FROM {t}") for t in
                  ("games", "studies", "chapters", "books", "book_versions", "findings", "experiments", "tournaments",
                   "puzzles", "cards", "training_events", "engines", "engine_profiles")}
        engines = [{"name": e["name"], "version": e["version"], "kind": e["kind"], "path": e["path"], "platform": e["platform"],
                    "arch": e["arch"], "defaults": e["defaults"]} for e in db.all("engines")]
        manifest = {"format": "opening-magician-project", "format_version": 1, "app_version": __version__,
                    "schema_version": SCHEMA_VERSION, "created_at": time.time(), "counts": counts, "engines": engines,
                    "note": "Engine binaries are not included. Re-register engines on the new computer; profiles and "
                            "research remain attached by engine name/version."}
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(MANIFEST, json.dumps(manifest, indent=2))
            z.write(snap, "database.sqlite3")
            games = db.all("games", order="created_at", cols="kind,pgn")
            for kind in sorted({g["kind"] for g in games}):
                z.writestr(f"pgn/{kind}-games.pgn", "\n\n".join(g["pgn"].strip() for g in games if g["kind"] == kind) + "\n")
            for s in db.all("studies"):
                chapters = db.all("chapters", "study_id=?", (s["id"],), order="position")
                z.writestr(f"studies/{_safe(s['title'])}-{s['id'][-6:]}.pgn", "\n\n".join(c["pgn"].strip() for c in chapters) + "\n")
            for b in db.all("books"):
                z.writestr(f"books/{_safe(b['name'])}-{b['id'][-6:]}.json", export_json(books.load(b["id"])))
            z.writestr("research/findings.json", json.dumps(db.all("findings"), indent=1))
            z.writestr("settings/preferences.json", json.dumps({r["key"]: json.loads(r["value"]) for r in db.query("SELECT key,value FROM prefs")}, indent=1))
    return {"path": str(dest), "size": dest.stat().st_size, "manifest": manifest}


def inspect_package(path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(path) as z:
        if MANIFEST not in z.namelist():
            raise ValueError("Not an Opening Magician project package (manifest missing)")
        manifest = json.loads(z.read(MANIFEST))
        if manifest.get("format") != "opening-magician-project":
            raise ValueError("Not an Opening Magician project package")
        return {**manifest, "files": len(z.namelist())}


def restore_package(db: Database, books: BookStore, path: Path) -> dict[str, Any]:
    manifest = inspect_package(path)
    if manifest["schema_version"] > SCHEMA_VERSION:
        raise ValueError("This package was created by a newer version of Opening Magician")
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(path) as z:
            z.extract("database.sqlite3", tmp)
        db.replace_with(Path(tmp) / "database.sqlite3")
    books._cache.clear()
    # Engines registered on another machine may not exist here: mark them so the UI asks for re-registration.
    import os
    missing = 0
    for e in db.all("engines", "kind='native'"):
        if not os.path.isfile(e["path"]):
            db.update("engines", e["id"], {"status": "missing: executable not found on this computer"})
            missing += 1
    return {"restored": True, "manifest": manifest, "engines_missing": missing}


def _safe(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in name)[:60] or "item"
