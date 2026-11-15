// Opening Magician desktop shell (Electron).
// It starts the Python bridge that lives next to this folder, waits until it answers, and opens the
// interface in a window.  The bridge keeps running research while the window is hidden and is
// stopped cleanly when the app quits.
//
// STATUS: provided as a ready-to-use configuration, but it was NOT run during development
// (no display / Electron in the build environment).  Treat the first launch as a test.
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const PORT = process.env.OM_PORT || "8765";
const URL = `http://127.0.0.1:${PORT}`;
let bridge = null;
let win = null;

function pythonPath() {
  const venv = process.platform === "win32" ? path.join(ROOT, ".venv", "Scripts", "python.exe") : path.join(ROOT, ".venv", "bin", "python");
  return fs.existsSync(venv) ? venv : process.platform === "win32" ? "python" : "python3";
}

function healthy() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/health`, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
  });
}

async function startBridge() {
  if (await healthy()) return;                       // a bridge is already running (e.g. started from a terminal)
  bridge = spawn(pythonPath(), ["-m", "om", "--port", PORT], {
    cwd: path.join(ROOT, "backend"),
    env: { ...process.env, OM_DATA_DIR: process.env.OM_DATA_DIR || path.join(app.getPath("userData"), "data") },
    stdio: "ignore",
  });
  bridge.on("exit", (code) => { bridge = null; if (code && win) dialog.showErrorBox("Opening Magician", `The local bridge stopped (exit code ${code}).`); });
  for (let i = 0; i < 60; i++) { if (await healthy()) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("The local bridge did not start. Run ./run.sh once in a terminal to see why.");
}

async function createWindow() {
  win = new BrowserWindow({ width: 1480, height: 940, minWidth: 980, minHeight: 640, backgroundColor: "#0e0c0a", title: "Opening Magician",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  await win.loadURL(URL);
}

app.whenReady().then(async () => {
  try { await startBridge(); await createWindow(); }
  catch (e) { dialog.showErrorBox("Opening Magician", String(e.message || e)); app.quit(); }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { if (bridge) { bridge.kill(process.platform === "win32" ? undefined : "SIGTERM"); bridge = null; } });
