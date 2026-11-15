"""SQLite persistence (WAL, foreign keys, versioned migrations, transactions).

A deliberately thin repository layer: every table has a stable text id, JSON
payload columns are (de)serialised here, and all writes go through `tx()` so a
crash can never leave half a tournament round or half a book version behind.
PostgreSQL deployment can swap this module; nothing else touches SQL dialects.
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import threading
import time
import uuid
import zlib
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator

SCHEMA_VERSION = 4

MIGRATIONS: dict[int, str] = {
    1: """
    CREATE TABLE engines (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, args TEXT NOT NULL DEFAULT '[]',
        kind TEXT NOT NULL DEFAULT 'native', version TEXT, author TEXT, platform TEXT, arch TEXT,
        options TEXT NOT NULL DEFAULT '{}', defaults TEXT NOT NULL DEFAULT '{}',
        notes TEXT, status TEXT NOT NULL DEFAULT 'unverified', created_at REAL NOT NULL, verified_at REAL
    );
    CREATE TABLE engine_profiles (
        id TEXT PRIMARY KEY, engine_id TEXT NOT NULL REFERENCES engines(id) ON DELETE CASCADE,
        name TEXT NOT NULL, purpose TEXT, options TEXT NOT NULL DEFAULT '{}', limits TEXT NOT NULL DEFAULT '{}',
        created_at REAL NOT NULL
    );
    CREATE TABLE games (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, white TEXT, black TEXT, result TEXT, termination TEXT,
        pgn TEXT NOT NULL, start_fen TEXT, opening TEXT, eco TEXT, plies INTEGER DEFAULT 0,
        tournament_id TEXT, experiment_id TEXT, meta TEXT NOT NULL DEFAULT '{}',
        created_at REAL NOT NULL, finished_at REAL
    );
    CREATE INDEX games_tournament ON games(tournament_id);
    CREATE INDEX games_experiment ON games(experiment_id);
    CREATE INDEX games_kind ON games(kind, created_at);
    CREATE TABLE analysis (
        id TEXT PRIMARY KEY, epd TEXT NOT NULL, engine_sig TEXT NOT NULL, engine_name TEXT,
        depth INTEGER, seldepth INTEGER, nodes INTEGER, time_ms INTEGER, multipv INTEGER,
        lines TEXT NOT NULL, stop_reason TEXT, budget TEXT NOT NULL DEFAULT '{}', created_at REAL NOT NULL
    );
    CREATE INDEX analysis_epd ON analysis(epd, engine_sig, depth);
    CREATE TABLE books (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, source TEXT, profile TEXT NOT NULL DEFAULT 'main',
        target_color TEXT, meta TEXT NOT NULL DEFAULT '{}', head_version INTEGER NOT NULL DEFAULT 0,
        created_at REAL NOT NULL, updated_at REAL NOT NULL
    );
    CREATE TABLE book_versions (
        id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        version INTEGER NOT NULL, parent_version INTEGER, summary TEXT, data BLOB NOT NULL,
        stats TEXT NOT NULL DEFAULT '{}', changes TEXT NOT NULL DEFAULT '{}', evidence TEXT NOT NULL DEFAULT '[]',
        created_at REAL NOT NULL, UNIQUE(book_id, version)
    );
    CREATE TABLE tournaments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, format TEXT NOT NULL, config TEXT NOT NULL, state TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending', report TEXT, created_at REAL NOT NULL, started_at REAL, finished_at REAL
    );
    CREATE TABLE experiments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL, stages TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending', report TEXT, created_at REAL NOT NULL, finished_at REAL
    );
    CREATE TABLE findings (
        id TEXT PRIMARY KEY, experiment_id TEXT REFERENCES experiments(id) ON DELETE SET NULL,
        epd TEXT NOT NULL, fen TEXT NOT NULL, move_uci TEXT NOT NULL, move_san TEXT NOT NULL, line_san TEXT,
        category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'discovered', scores TEXT NOT NULL DEFAULT '{}',
        ranking TEXT NOT NULL DEFAULT '{}', evidence TEXT NOT NULL DEFAULT '{}', notes TEXT,
        created_at REAL NOT NULL, updated_at REAL NOT NULL
    );
    CREATE INDEX findings_epd ON findings(epd, move_uci);
    CREATE TABLE puzzles (
        id TEXT PRIMARY KEY, fen TEXT NOT NULL, solution TEXT NOT NULL, alternatives TEXT NOT NULL DEFAULT '[]',
        themes TEXT NOT NULL DEFAULT '[]', difficulty TEXT, rating INTEGER DEFAULT 1500, title TEXT, explanation TEXT,
        source TEXT NOT NULL DEFAULT '{}', verification TEXT NOT NULL DEFAULT '{}', created_at REAL NOT NULL
    );
    CREATE TABLE puzzle_attempts (
        id TEXT PRIMARY KEY, puzzle_id TEXT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
        solved INTEGER NOT NULL, time_ms INTEGER, hints INTEGER DEFAULT 0, mistakes INTEGER DEFAULT 0, created_at REAL NOT NULL
    );
    CREATE TABLE studies (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, kind TEXT NOT NULL DEFAULT 'opening',
        tags TEXT NOT NULL DEFAULT '[]', refs TEXT NOT NULL DEFAULT '{}', created_at REAL NOT NULL, updated_at REAL NOT NULL
    );
    CREATE TABLE chapters (
        id TEXT PRIMARY KEY, study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
        title TEXT NOT NULL, pgn TEXT NOT NULL, orientation TEXT DEFAULT 'white', position INTEGER NOT NULL DEFAULT 0,
        meta TEXT NOT NULL DEFAULT '{}', updated_at REAL NOT NULL
    );
    CREATE TABLE cards (
        id TEXT PRIMARY KEY, deck TEXT NOT NULL, epd TEXT NOT NULL, fen TEXT NOT NULL, move_uci TEXT NOT NULL,
        san TEXT NOT NULL, line TEXT NOT NULL DEFAULT '[]', color TEXT NOT NULL, opening TEXT, kind TEXT NOT NULL DEFAULT 'recall',
        note TEXT, ease REAL NOT NULL DEFAULT 2.5, interval_days REAL NOT NULL DEFAULT 0, due REAL NOT NULL,
        reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0, last_result TEXT, created_at REAL NOT NULL,
        UNIQUE(deck, epd, move_uci)
    );
    CREATE INDEX cards_due ON cards(deck, due);
    CREATE TABLE training_events (
        id TEXT PRIMARY KEY, card_id TEXT, mode TEXT NOT NULL, dimension TEXT, correct INTEGER NOT NULL,
        time_ms INTEGER, hints INTEGER DEFAULT 0, detail TEXT NOT NULL DEFAULT '{}', created_at REAL NOT NULL
    );
    CREATE INDEX training_events_time ON training_events(created_at);
    CREATE TABLE hw_devices (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, model TEXT NOT NULL, profile TEXT NOT NULL DEFAULT '{}',
        last_seen REAL, created_at REAL NOT NULL
    );
    CREATE TABLE hw_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, device TEXT, simulated INTEGER NOT NULL DEFAULT 0,
        direction TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT, note TEXT
    );
    CREATE TABLE prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE broadcasts (
        id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, title TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}',
        state TEXT NOT NULL DEFAULT '{}', active INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL
    );
    CREATE TABLE jobs (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 5, payload TEXT NOT NULL DEFAULT '{}', checkpoint TEXT NOT NULL DEFAULT '{}',
        result TEXT, error TEXT, budget TEXT NOT NULL DEFAULT '{}', progress REAL NOT NULL DEFAULT 0,
        created_at REAL NOT NULL, updated_at REAL NOT NULL, run_after REAL
    );
    CREATE INDEX jobs_status ON jobs(status, priority, created_at);
    """,
    2: """
    CREATE TABLE play_sessions (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, config TEXT NOT NULL, state TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL
    );
    CREATE TABLE links (
        id INTEGER PRIMARY KEY AUTOINCREMENT, src_kind TEXT NOT NULL, src_id TEXT NOT NULL,
        dst_kind TEXT NOT NULL, dst_id TEXT NOT NULL, rel TEXT NOT NULL, created_at REAL NOT NULL,
        UNIQUE(src_kind, src_id, dst_kind, dst_id, rel)
    );
    CREATE INDEX links_src ON links(src_kind, src_id);
    CREATE INDEX links_dst ON links(dst_kind, dst_id);
    """,
    3: """
    CREATE TABLE collections (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, player TEXT, kind TEXT NOT NULL DEFAULT 'opponent', source TEXT,
        stats TEXT NOT NULL DEFAULT '{}', white_book_id TEXT, black_book_id TEXT, created_at REAL NOT NULL
    );
    CREATE TABLE watch (
        id TEXT PRIMARY KEY, book_id TEXT NOT NULL, epd TEXT NOT NULL, fen TEXT NOT NULL, move_uci TEXT NOT NULL,
        san TEXT NOT NULL, line TEXT, baseline TEXT NOT NULL DEFAULT '{}', latest TEXT NOT NULL DEFAULT '{}',
        history TEXT NOT NULL DEFAULT '[]', alert TEXT, updated_at REAL NOT NULL, UNIQUE(book_id, epd, move_uci)
    );
    CREATE INDEX watch_book ON watch(book_id);
    """,
    4: """
    CREATE TABLE gambits (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, start_fen TEXT, fen TEXT NOT NULL, epd TEXT NOT NULL,
        move_uci TEXT NOT NULL, san TEXT NOT NULL, line TEXT NOT NULL DEFAULT '[]', detail TEXT NOT NULL DEFAULT '{}',
        report TEXT NOT NULL DEFAULT '{}', config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'assessed',
        created_at REAL NOT NULL, updated_at REAL NOT NULL, UNIQUE(epd, move_uci)
    );
    """,
}

# Columns that hold JSON; decoded on read, encoded on write.
JSON_COLS = {
    "args", "options", "defaults", "limits", "meta", "lines", "budget", "stats", "changes", "evidence", "config",
    "state", "report", "stages", "scores", "ranking", "solution", "alternatives", "themes", "source", "verification",
    "tags", "refs", "line", "detail", "profile", "payload", "checkpoint", "result", "baseline", "latest", "history",
}
# hw_log.payload is a hex string, prefs.value handled separately, puzzles.source is JSON.
RAW_OVERRIDES = {("hw_log", "payload"), ("books", "source"), ("books", "profile"), ("watch", "line"), ("collections", "source")}


def new_id(prefix: str = "") -> str:
    return (prefix + "_" if prefix else "") + uuid.uuid4().hex[:16]


def now() -> float:
    return time.time()


def pack(obj: Any) -> bytes:
    return zlib.compress(json.dumps(obj, separators=(",", ":")).encode(), 6)


def unpack(blob: bytes) -> Any:
    return json.loads(zlib.decompress(blob).decode())


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._depth = 0
        c = self._conn
        if self.path != ":memory:":
            c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA busy_timeout=5000")
        self.migrate()

    # -- schema ---------------------------------------------------------
    def migrate(self) -> None:
        with self._lock:
            self._conn.execute("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            row = self._conn.execute("SELECT value FROM schema_meta WHERE key='version'").fetchone()
            current = int(row["value"]) if row else 0
            for v in range(current + 1, SCHEMA_VERSION + 1):
                with self.tx():
                    for stmt in _split(MIGRATIONS[v]):
                        self._conn.execute(stmt)
                    self._conn.execute(
                        "INSERT INTO schema_meta(key,value) VALUES('version',?) "
                        "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(v),))

    @property
    def schema_version(self) -> int:
        row = self._conn.execute("SELECT value FROM schema_meta WHERE key='version'").fetchone()
        return int(row["value"]) if row else 0

    # -- transactions ---------------------------------------------------
    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """Re-entrant transaction: commits on success, rolls back everything on error."""
        with self._lock:
            outer = self._depth == 0
            if outer:
                self._conn.execute("BEGIN IMMEDIATE")
            self._depth += 1
            try:
                yield self._conn
            except BaseException:
                self._depth -= 1
                if outer:
                    self._conn.execute("ROLLBACK")
                raise
            else:
                self._depth -= 1
                if outer:
                    self._conn.execute("COMMIT")

    # -- helpers --------------------------------------------------------
    def _enc(self, table: str, data: dict[str, Any]) -> dict[str, Any]:
        out = {}
        for k, v in data.items():
            if k in JSON_COLS and (table, k) not in RAW_OVERRIDES and not isinstance(v, (bytes, type(None))):
                out[k] = json.dumps(v, separators=(",", ":"))
            elif isinstance(v, bool):
                out[k] = int(v)
            else:
                out[k] = v
        return out

    def _dec(self, table: str, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        d = dict(row)
        for k, v in d.items():
            if k in JSON_COLS and (table, k) not in RAW_OVERRIDES and isinstance(v, str):
                try:
                    d[k] = json.loads(v)
                except ValueError:
                    pass
        return d

    def insert(self, table: str, data: dict[str, Any]) -> dict[str, Any]:
        enc = self._enc(table, data)
        cols = ",".join(enc)
        with self.tx() as c:
            c.execute(f"INSERT INTO {table} ({cols}) VALUES ({','.join('?' * len(enc))})", list(enc.values()))
        return data

    def upsert(self, table: str, data: dict[str, Any], key: str = "id") -> dict[str, Any]:
        enc = self._enc(table, data)
        cols = ",".join(enc)
        sets = ",".join(f"{k}=excluded.{k}" for k in enc if k != key)
        with self.tx() as c:
            c.execute(
                f"INSERT INTO {table} ({cols}) VALUES ({','.join('?' * len(enc))}) "
                f"ON CONFLICT({key}) DO UPDATE SET {sets}", list(enc.values()))
        return data

    def update(self, table: str, id_: str, data: dict[str, Any], key: str = "id") -> None:
        if not data:
            return
        enc = self._enc(table, data)
        with self.tx() as c:
            c.execute(f"UPDATE {table} SET {','.join(k + '=?' for k in enc)} WHERE {key}=?", [*enc.values(), id_])

    def delete(self, table: str, id_: str, key: str = "id") -> None:
        with self.tx() as c:
            c.execute(f"DELETE FROM {table} WHERE {key}=?", (id_,))

    def get(self, table: str, id_: str, key: str = "id") -> dict[str, Any] | None:
        with self._lock:
            return self._dec(table, self._conn.execute(f"SELECT * FROM {table} WHERE {key}=?", (id_,)).fetchone())

    def all(self, table: str, where: str = "", params: Iterable[Any] = (), order: str = "", limit: int | None = None,
            cols: str = "*") -> list[dict[str, Any]]:
        sql = f"SELECT {cols} FROM {table}"
        if where:
            sql += " WHERE " + where
        if order:
            sql += " ORDER BY " + order
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        with self._lock:
            return [self._dec(table, r) for r in self._conn.execute(sql, list(params)).fetchall()]  # type: ignore[misc]

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, list(params)).fetchall()]

    def scalar(self, sql: str, params: Iterable[Any] = ()) -> Any:
        with self._lock:
            row = self._conn.execute(sql, list(params)).fetchone()
            return row[0] if row else None

    def execute(self, sql: str, params: Iterable[Any] = ()) -> None:
        with self.tx() as c:
            c.execute(sql, list(params))

    # -- prefs ----------------------------------------------------------
    def pref(self, key: str, default: Any = None) -> Any:
        v = self.scalar("SELECT value FROM prefs WHERE key=?", (key,))
        return json.loads(v) if v is not None else default

    def set_pref(self, key: str, value: Any) -> None:
        self.execute("INSERT INTO prefs(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                     (key, json.dumps(value)))

    # -- knowledge graph links -----------------------------------------
    def link(self, src_kind: str, src_id: str, dst_kind: str, dst_id: str, rel: str) -> None:
        self.execute("INSERT OR IGNORE INTO links(src_kind,src_id,dst_kind,dst_id,rel,created_at) VALUES(?,?,?,?,?,?)",
                     (src_kind, src_id, dst_kind, dst_id, rel, now()))

    def links_for(self, kind: str, id_: str) -> list[dict[str, Any]]:
        return self.query("SELECT * FROM links WHERE (src_kind=? AND src_id=?) OR (dst_kind=? AND dst_id=?)",
                          (kind, id_, kind, id_))

    # -- backup ---------------------------------------------------------
    def backup(self, dest: Path) -> Path:
        """Online, consistent snapshot (SQLite backup API) — safe while jobs are writing."""
        dest.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            target = sqlite3.connect(str(dest))
            try:
                self._conn.backup(target)
            finally:
                target.close()
        return dest

    def replace_with(self, src: Path) -> None:
        """Swap the live database for another SQLite file (project restore).  The previous
        file is kept next to it as `.before-restore` so a restore is itself reversible."""
        with self._lock:
            if self.path == ":memory:":
                raise RuntimeError("Cannot restore into an in-memory database")
            check = sqlite3.connect(str(src))
            try:
                ok = check.execute("PRAGMA integrity_check").fetchone()[0]
                has = check.execute("SELECT name FROM sqlite_master WHERE name='schema_meta'").fetchone()
            finally:
                check.close()
            if ok != "ok" or not has:
                raise RuntimeError("The file is not a valid Opening Magician database")
            self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            self._conn.close()
            shutil.copyfile(self.path, self.path + ".before-restore")
            for suffix in ("-wal", "-shm"):
                Path(self.path + suffix).unlink(missing_ok=True)
            shutil.copyfile(src, self.path)
            self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._depth = 0
            self.migrate()

    def integrity(self) -> str:
        return str(self.scalar("PRAGMA integrity_check"))

    def close(self) -> None:
        with self._lock:
            self._conn.close()


def _split(script: str) -> list[str]:
    return [s.strip() for s in script.split(";") if s.strip()]


def rotate_backups(db: Database, backup_dir: Path, keep: int = 7) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = db.backup(backup_dir / f"opening-magician-{stamp}.sqlite3")
    snaps = sorted(backup_dir.glob("opening-magician-*.sqlite3"))
    for old in snaps[:-keep]:
        old.unlink(missing_ok=True)
    return dest


def restore_file(src: Path, dest: Path) -> None:
    shutil.copyfile(src, dest)
