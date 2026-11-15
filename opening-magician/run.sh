#!/usr/bin/env bash
# Opening Magician — one-command start (macOS / Linux).
# Creates the Python environment and builds the interface on first run, then starts the local bridge.
set -euo pipefail
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
if [ ! -x .venv/bin/python ]; then
  echo "Setting up the Python environment…"
  "$PY" -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r backend/requirements.txt
fi
if [ ! -f frontend/dist/index.html ]; then
  echo "Building the interface…"
  (cd frontend && npm install --no-audit --no-fund && npm run build)
fi
cd backend
exec ../.venv/bin/python -m om "$@"
