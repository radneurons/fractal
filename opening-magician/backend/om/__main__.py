"""Launch the Opening Magician bridge:  python -m om  [--host H] [--port P] [--mode local|lan|server]"""
from __future__ import annotations

import argparse

import uvicorn

from . import APP_NAME, __version__
from .config import settings


def main() -> None:
    ap = argparse.ArgumentParser(prog="opening-magician", description=f"{APP_NAME} native bridge {__version__}")
    ap.add_argument("--host", default=None, help="bind address (default 127.0.0.1; lan/server modes default to 0.0.0.0)")
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--mode", choices=["local", "lan", "server"], default=None)
    ap.add_argument("--data-dir", default=None)
    args = ap.parse_args()
    if args.mode:
        settings.mode = args.mode
    if args.data_dir:
        from pathlib import Path
        settings.data_dir = Path(args.data_dir)
    if args.port:
        settings.port = args.port
    settings.host = args.host or ("127.0.0.1" if settings.mode == "local" else "0.0.0.0")
    settings.ensure()
    from .api.app import create_app
    print(f"{APP_NAME} {__version__} — mode: {settings.mode} — http://{settings.host}:{settings.port}")
    if settings.mode != "local":
        print(f"Admin token (required by other devices): {settings.admin_token}")
        print("Spectator links (/watch/<token>) need no token and expose read-only broadcast data only.")
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
