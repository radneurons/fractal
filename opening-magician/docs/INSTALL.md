# Installation and setup

## Requirements

* Python 3.11 or newer, Node.js 18 or newer
* For real boards: a computer with Bluetooth LE. Linux needs BlueZ; macOS asks for Bluetooth permission
  for the terminal or app that starts the bridge; Windows 10 or newer.

## Run

```bash
./run.sh                 # macOS / Linux
run.bat                  # Windows
```

Manual equivalent:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
(cd frontend && npm install && npm run build)
(cd backend && ../.venv/bin/python -m om)
```

Open `http://127.0.0.1:8765`. Your data lives in `data/` next to the code (override with `OM_DATA_DIR`).

For interface development run the bridge as above and, in a second terminal:

```bash
cd frontend && npm run dev        # http://localhost:5173, proxies /api and /ws to the bridge
```

## Engines

Opening Magician never downloads an engine. Install the ones you want and are licensed to use, then
register the executable in **Engines → Register an engine**. Registration performs the real UCI
handshake and reads the engine's own option table. Engines found on your `PATH` (or in `~/engines`
or `engines-local/`) are listed under "Found on this computer".

| Platform | Stockfish example | Path to register |
|---|---|---|
| macOS (Homebrew) | `brew install stockfish` | `/opt/homebrew/bin/stockfish` (Apple silicon) or `/usr/local/bin/stockfish` |
| Debian / Ubuntu | `sudo apt install stockfish` | `/usr/games/stockfish` |
| Fedora | `sudo dnf install stockfish` | `/usr/bin/stockfish` |
| Arch | `sudo pacman -S stockfish` | `/usr/bin/stockfish` |
| Windows | download from stockfishchess.org and unzip | e.g. `C:\Engines\stockfish\stockfish-windows-x86-64-avx2.exe` |

Notes that save time:

* Pick the build that matches your CPU (`avx2`, `bmi2`, `sse41-popcnt`, `apple-silicon` …). A build your
  CPU cannot run exits immediately and registration reports that it could not start.
* On macOS a downloaded binary may be quarantined: `xattr -d com.apple.quarantine /path/to/engine`.
* On Linux and macOS the file must be executable: `chmod +x /path/to/engine`.
* Engines that need a network file (Lc0 weights, some NNUE engines) take the path as a UCI option —
  set it in **Engines → Options** as that engine's default.
* Syzygy tablebases: set the engine's `SyzygyPath` option the same way.
* Threads and Hash are capped by **Engines → Resources** so several engines cannot each take every core.

Recommended first setup: register one strong engine, then in the Discovery Lab use the bundled engine
(or the strong engine at a low skill level) as the explorers and the strong engine as the observer.

## Deployment modes

| Mode | Command | Who may control it |
|---|---|---|
| Local desktop (default) | `python -m om` | This computer only (bound to 127.0.0.1) |
| Local network | `python -m om --mode lan` | Devices that send the admin token |
| Research server | `python -m om --mode server --data-dir /srv/om` | Same; long jobs continue with no browser open |
| Spectator | any of the above | Anyone with a `/watch/<token>` link — read-only broadcast data, nothing else |

In `lan` and `server` mode the bridge prints an **admin token** (also stored in `data/admin-token.txt`).
On another device open the address, go to **Settings → Backup & project → Connection** and paste it.
Remote clients can only register engines from folders listed in `OM_ENGINE_ALLOWLIST`
(path-separator separated); otherwise register engines on the machine itself. Put a TLS reverse proxy in
front if the network is not your own.

Environment variables: `OM_MODE`, `OM_HOST`, `OM_PORT`, `OM_DATA_DIR`, `OM_ADMIN_TOKEN`, `OM_ENGINE_ALLOWLIST`.

## Desktop shell (optional)

`desktop/` contains an Electron shell that starts the bridge and opens the interface in its own window:

```bash
./run.sh --help            # once, so the environment and the built interface exist
cd desktop && npm install && npm start
```

This configuration was written but **not run** during development. See docs/STATUS.md.

## Backups and moving to another computer

* The database is backed up automatically every six hours to `data/backups/` (the last seven are kept);
  **Settings → Back up now** makes one immediately.
* **Settings → Export project package** writes one `.omproj` file. On the new computer install the app,
  choose **Restore from a package…**, then re-register your engines (binaries are never packaged).
