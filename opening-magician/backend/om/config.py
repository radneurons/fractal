"""Runtime configuration. Everything is local-first; nothing here needs the internet."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@dataclass
class Settings:
    # local | lan | server.  "local" binds to loopback and trusts loopback callers.
    mode: str = field(default_factory=lambda: os.environ.get("OM_MODE", "local"))
    host: str = field(default_factory=lambda: os.environ.get("OM_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.environ.get("OM_PORT", "8765")))
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("OM_DATA_DIR", ROOT / "data")))
    # Admin token: required for every control API when the caller is not on loopback.
    admin_token: str = field(default_factory=lambda: os.environ.get("OM_ADMIN_TOKEN", ""))
    frontend_dist: Path = field(default_factory=lambda: ROOT / "frontend" / "dist")
    # Engines may only be registered from these directories when the caller is remote.
    engine_allowlist: list[str] = field(
        default_factory=lambda: [p for p in os.environ.get("OM_ENGINE_ALLOWLIST", "").split(os.pathsep) if p]
    )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "opening-magician.sqlite3"

    def ensure(self) -> "Settings":
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "backups").mkdir(exist_ok=True)
        (self.data_dir / "exports").mkdir(exist_ok=True)
        if self.mode != "local" and not self.admin_token:
            # Never run a network-reachable bridge without a control token.
            tok_file = self.data_dir / "admin-token.txt"
            if tok_file.exists():
                self.admin_token = tok_file.read_text().strip()
            else:
                self.admin_token = secrets.token_urlsafe(24)
                tok_file.write_text(self.admin_token)
                tok_file.chmod(0o600)
        return self


settings = Settings()
