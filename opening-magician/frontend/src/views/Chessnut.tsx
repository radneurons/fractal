// Chessnut control centre: connection, the simulator's "hands", Robot Studio, LED tester and the traffic log.
import { useEffect, useState } from "react";
import { api, useApi, useLive } from "../api";
import Board from "../chess/Board";
import { parsePlacement } from "../chess/Board2D";
import { PieceIcon } from "../chess/pieces2d";
import { START_FEN } from "../chess/tree";
import { act, ago, useStore } from "../store";
import { Check, Field, Num, Panel, Select, Tabs } from "../ui/ui";

const CHECKLIST = [
  "Bluetooth pairing works and position reports arrive with the documented length (38 bytes on Move, 36 bytes on Air / Air+ / Go / Pro).",
  "The decoded position matches the real board for the start position and after several hand moves (square order h8 → a1).",
  "A simple one-piece target position (for example 1.e4) is executed correctly with nothing in the way.",
  "The STOP command halts motion immediately with the stop-command variant selected below — tested with a hand ready on the power switch.",
  "After STOP and after a completed motion the board resumes position reports and the app shows the true position.",
  "Touching a piece during a non-force motion halts it, as the manufacturer documents.",
];

export default function Chessnut() {
  const { hw, setHw, takeHandoff, prefs } = useStore();
  const [tab, setTab] = useState<"connect" | "robot" | "leds" | "log">("connect");
  const [scan, setScan] = useState<any | null>(null);
  const [scanning, setScanning] = useState(false);
  const [simModel, setSimModel] = useState("move");
  const [target, setTarget] = useState(START_FEN);
  const [hand, setHand] = useState<string | null>(null);
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST.map(() => false));
  const log = useApi<any[]>(tab === "log" ? "/api/hw/log?limit=150" : null, { interval: 2000 });
  const reload = () => api.get("/api/hw").then(setHw).catch(() => undefined);
  useEffect(() => { const h = takeHandoff(); if (h?.fen) { setTarget(h.fen); setTab("robot"); } reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLive("hw", (m) => { if (m.type === "position" || m.type === "battery" || m.type === "pieces") reload(); });

  const dev = hw?.device, robot = hw?.robot, sim = hw?.sim;
  const boardFen = dev?.board_fen ? `${dev.board_fen} w - - 0 1` : null;
  const run = (fn: () => Promise<any>, ok?: string) => act(async () => { const r = await fn(); await reload(); return r; }, ok);
  const simAct = (action: string, body: any = {}) => run(() => api.post(`/api/hw/sim/${action}`, body));
  const placement = boardFen ? parsePlacement(boardFen) : {};

  const onSimSquare = (sq: string) => {
    if (!sim) return;
    if (hand) { simAct("place", { square: sq, piece: hand }); setHand(null); }
    else if (placement[sq]) { setHand(placement[sq]); simAct("lift", { square: sq }); }
  };

  return (
    <div className="view">
      <div className="view-head">
        <div><h1>Chessnut</h1><div className="sub">Air, Air+, Go and Pro (sensors + LEDs) and the robotic Move — driven only by the manufacturer's documented protocol.</div></div>
        <span className="spacer" />
        {dev && <span className={`pill ${dev.simulated ? "sim" : "good"}`}>{dev.simulated ? "SIMULATED" : "REAL HARDWARE"}</span>}
        {dev && <button className="btn" onClick={() => run(() => api.post("/api/hw/disconnect"), "Disconnected")}>Disconnect</button>}
      </div>
      <Tabs value={tab} onChange={setTab} items={[["connect", "Connection & board"], ["robot", "Robot Studio"], ["leds", "LED guidance"], ["log", "Protocol log"]]} />

      {tab === "connect" && (
        <div className="split">
          <div className="col">
            {boardFen ? <>
              {dev.simulated && <div className="sim-banner">SIMULATED BOARD — click a piece to lift it, then a square to put it down</div>}
              <Board fen={boardFen} tools={false} leds={dev.leds} ghosts={sim?.lifted} editor={sim ? { onSquare: onSimSquare } : undefined} mode="2d" />
              {sim && <div className="row">
                <span className="muted">In hand:</span>{hand ? <><PieceIcon piece={hand} set={prefs.pieces2d} /><button className="btn xs" onClick={() => setHand(null)}>put aside (captured)</button></> : <span className="muted">nothing</span>}
                <span className="grow" />
                <button className="btn sm" onClick={() => simAct("set", { fen: START_FEN })}>Reset to start</button>
              </div>}
            </> : <div className="empty">No board connected.<br />Scan for a real board or start the simulator.</div>}
          </div>
          <div className="col gap-lg">
            {!dev && <>
              <Panel title="Real board (Bluetooth LE)" actions={<button className="btn primary sm" disabled={scanning} onClick={async () => { setScanning(true); setScan(await act(() => api.post("/api/hw/scan", { timeout: 6 }))); setScanning(false); }}>{scanning ? "Scanning…" : "Scan"}</button>}>
                {scan?.error && <div className="note warn">Bluetooth is not available to the bridge on this machine: {scan.error}</div>}
                {scan && !scan.error && !scan.devices.length && <p className="muted">No Chessnut board found. Switch the board on and keep it close.</p>}
                {(scan?.devices || []).map((d: any) => (
                  <div className="row" key={d.address} style={{ padding: "4px 0" }}>
                    <b>{d.name}</b><span className="muted mono">{d.address}</span><span className="muted">{d.rssi} dBm</span><span className="grow" />
                    {d.supported ? <button className="btn sm" onClick={() => run(() => api.post("/api/hw/connect", d), "Connected")}>Connect</button> : <span className="pill warn" title={d.note}>needs a verified profile</span>}
                  </div>))}
                {(hw?.known || []).length > 0 && <><div className="label" style={{ marginTop: 8 }}>Known boards</div>
                  {hw.known.map((k: any) => <div className="row" key={k.id}><span>{k.name}</span><span className="muted">{k.model} · seen {ago(k.last_seen)}</span><span className="grow" />
                    <button className="btn xs" onClick={() => run(() => api.post("/api/hw/connect", { address: k.address, name: k.name, model: k.model }), "Connected")}>Reconnect</button></div>)}</>}
                <p className="help" style={{ marginTop: 8 }}>Models with their own verified profile: {Object.values(hw?.models || {}).map((m: any) => m.label).join(", ")}. Other Chessnut models are not driven until their protocol is verified.</p>
              </Panel>
              <Panel title="Simulator" hint="same driver code path, simulated firmware">
                <div className="row">
                  <Select value={simModel} onChange={setSimModel} options={Object.entries(hw?.models || { move: { label: "Chessnut Move" } }).map(([k, m]: any) => [k, m.label + (m.robotic ? " (robotic)" : "")])} style={{ maxWidth: 240 }} />
                  <button className="btn" onClick={() => run(() => api.post("/api/hw/connect", { simulator: true, model: simModel, step_time: 0.6 }), "Simulator connected")}>Start simulator</button>
                </div>
                <p className="help" style={{ marginTop: 8 }}>The simulator answers the documented byte commands. Anything it shows is labelled simulated and never reported as a real device acknowledgement.</p>
              </Panel>
            </>}
            {dev && <>
              <Panel title={dev.name} hint={dev.capabilities.label} actions={<button className="btn sm" onClick={() => run(() => api.post("/api/hw/refresh"))}>Refresh</button>}>
                <div className="grid g3">
                  <div className="kpi"><b>{dev.battery ? `${dev.battery.percent}%` : "–"}</b><span>Battery{dev.battery?.charging ? " · charging" : ""}</span></div>
                  <div className="kpi"><b>{dev.reports}</b><span>Position reports</span></div>
                  <div className="kpi"><b>{dev.capabilities.report_len}</b><span>Bytes / report</span></div>
                </div>
                <p style={{ marginTop: 10 }}>
                  <span className="pill">{dev.capabilities.robotic ? "moves pieces" : "no motors"}</span>{" "}
                  <span className="pill">{dev.capabilities.led === "rgb" ? "colour LEDs" : "single-colour LEDs"}</span>{" "}
                  {dev.capabilities.piece_status && <span className="pill">piece status</span>}{" "}
                  {dev.length_warnings > 0 && <span className="pill warn">{dev.length_warnings} report(s) with unexpected length</span>}
                </p>
                {hw.reconcile && <p className="help">Board vs. current game: <b>{hw.reconcile.status.replace(/_/g, " ")}</b>{hw.owner ? ` (used by ${hw.owner.split(":")[0]})` : ""}</p>}
                <div className="grid g2" style={{ marginTop: 8 }}>
                  <Check checked={dev.profile.auto_queen} onChange={(v) => run(() => api.put("/api/hw/profile", { auto_queen: v }))} label="Assume a queen" help="A pawn left on the last rank counts as a queen promotion." />
                  {dev.capabilities.family === "air" && <Field label="LED bit order in a rank byte" help="Documented as “h to a”; switch if the mirror image lights up on your board.">
                    <Select value={dev.profile.led_bit_order} onChange={(v) => run(() => api.put("/api/hw/profile", { led_bit_order: v }))} options={[["h_lsb", "bit 0 = h-file (default)"], ["a_lsb", "bit 0 = a-file"]]} /></Field>}
                </div>
              </Panel>
              {sim && (
                <Panel title="Simulator controls" hint="what a person or a fault would do">
                  <div className="row">
                    <button className="btn sm" onClick={() => simAct("battery", { percent: 14 })}>Low battery</button>
                    <button className="btn sm" onClick={() => simAct("battery", { percent: 80, charging: true })}>Charging</button>
                    <button className="btn sm" onClick={() => simAct("drop")}>Drop the connection</button>
                    {dev.capabilities.robotic && <>
                      <button className="btn sm" onClick={() => simAct("fault", { kind: "stall" })}>Next motion: motor stall</button>
                      <button className="btn sm" onClick={() => simAct("fault", { kind: "misplace" })}>Next motion: piece misplaced</button>
                      <Field label="Seconds per piece"><Num value={0.6} min={0.05} step={0.1} style={{ width: 80 }} onChange={(v) => simAct("speed", { step_time: v })} /></Field></>}
                  </div>
                  {sim.motion && <p className="help" style={{ marginTop: 8 }}>Simulated motion: {sim.motion.done}/{sim.motion.total} piece steps{sim.motion.halted ? ` — halted (${sim.motion.halted})` : sim.moving ? " — moving" : ""}</p>}
                </Panel>)}
            </>}
            <Panel title="What the documentation leaves open">
              {(hw?.ambiguities || []).map((a: any) => <p key={a.id} className="help"><b>{a.device === "move" ? "Move" : "Air family"} · {a.id.replace(/_/g, " ")}:</b> {a.text}</p>)}
            </Panel>
          </div>
        </div>)}

      {tab === "robot" && (!robot ? <div className="empty">{dev ? `${dev.capabilities.label} has no motors. It guides you with LEDs instead — see “LED guidance”.` : "Connect a Chessnut Move (or the Move simulator) to use Robot Studio."}</div> : (
        <div className="col gap-lg">
          {dev.simulated && <div className="sim-banner">SIMULATED ROBOT — completion shown here is the simulator's, not a real device acknowledgement</div>}
          <Panel title="Application state" hint={robot.telemetry_note}>
            <div className="row">{(useStore.getState().meta?.robot_states || []).map((s: string) => (
              <span key={s} className={`state-chip ${robot.state === s ? "on" : ""} ${robot.state === s && ["error", "recovery_required", "interrupted"].includes(s) ? "bad" : ""}`}>{s.replace(/_/g, " ")}</span>))}</div>
            {robot.detail && <p style={{ marginTop: 10 }}>{robot.detail}</p>}
          </Panel>
          <div className="split">
            <div className="col">
              <div className="label">Target position preview</div>
              <Board fen={target} movable="both" tools={false} mode="2d" onMove={async (uci) => { const { tryMove } = await import("../chess/tree"); const r = tryMove(target, uci); if (r) setTarget(r.fen); }} />
              <Field label="Target FEN"><input type="text" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
              <div className="row"><button className="btn sm" onClick={() => setTarget(START_FEN)}>Start position</button>
                {boardFen && <button className="btn sm" onClick={() => setTarget(boardFen)}>Copy what is on the board</button>}</div>
            </div>
            <div className="col gap-lg">
              <Panel title="1 · Plan" actions={<button className="btn sm" disabled={robot.busy} onClick={() => run(() => api.post("/api/hw/robot/plan", { fen: target, reason: "Robot Studio" }))}>Plan this target</button>}>
                {robot.operation ? <>
                  <p>{robot.operation.feasible ? `${robot.operation.pieces_to_move} piece operation(s)${robot.operation.already_there ? " — the board already shows this position" : ""}.` : "This target cannot be set up:"}</p>
                  {robot.operation.problems?.map((p: string) => <div key={p} className="note bad">{p}</div>)}
                  <div className="scroll" style={{ maxHeight: 140 }}>{(robot.operation.manual_steps || robot.operation.steps || []).map((s: any, i: number) => (
                    <div key={i} className="mono muted">{s.action} {s.piece} {s.from || ""}{s.to ? ` → ${s.to}` : ""}</div>))}</div>
                  {robot.operation.mismatch && <div className="note warn">Board differs from the target on: {[...robot.operation.mismatch.missing, ...robot.operation.mismatch.extra, ...robot.operation.mismatch.wrong].join(", ") || "—"}</div>}
                </> : <p className="muted">Nothing is sent to the board while planning. The plan lists every piece that would move.</p>}
              </Panel>
              <Panel title="2 · Confirm and move">
                <div className="row">
                  <button className="btn primary" disabled={robot.state !== "awaiting_confirmation" || !robot.live_motion_unlocked} onClick={() => run(() => api.post("/api/hw/robot/confirm", { op_id: robot.operation.id }))}>Confirm — move the pieces</button>
                  <button className="btn" disabled={robot.state !== "awaiting_confirmation"} onClick={() => run(() => api.post("/api/hw/robot/cancel"))}>Discard plan</button>
                  <button className="btn danger big" onClick={() => run(() => api.post("/api/hw/robot/stop"), "STOP sent")}>STOP MOVEMENT</button>
                </div>
                {!robot.live_motion_unlocked && <div className="note warn" style={{ marginTop: 8 }}>Live motion is locked for this device until the verification checklist below is confirmed.</div>}
                {robot.operation?.sent_at && <p className="help" style={{ marginTop: 8 }}>Sent {ago(robot.operation.sent_at)} · {robot.operation.command_len}-byte command · {robot.operation.force ? "force" : "non-force (a touched piece halts motion)"} ·
                  expected about {robot.operation.expected_s}s{robot.operation.duration_s ? ` · took ${robot.operation.duration_s}s` : ""}{robot.operation.telemetry ? ` · ${robot.operation.telemetry.pieces_reported} pieces reporting, still for ${robot.operation.telemetry.still_polls} poll(s)` : ""}</p>}
                <p className="help">One target is sent at a time and never retried automatically. The board is not sending position reports while it moves, so “completed” is only shown after a fresh sensor report matches the target.</p>
              </Panel>
              {["recovery_required", "interrupted", "error"].includes(robot.state) && (
                <Panel title="3 · Recovery">
                  <p>The physical position is uncertain. Check the board, fix any piece left between squares, then:</p>
                  <div className="row">
                    <button className="btn" onClick={() => run(() => api.post("/api/hw/robot/recover", { action: "rescan" }))}>Re-read the sensors</button>
                    <button className="btn" onClick={() => run(() => api.post("/api/hw/robot/recover", { action: "accept" }))}>Accept the position that is on the board</button>
                  </div>
                </Panel>)}
              <Panel title="Movement settings">
                <div className="grid g2">
                  <Field label="Stop command variant" help="The documentation says “34 zeros” and “35 bytes”, which do not agree. Verify on your board.">
                    <Select value={dev.profile.stop_variant} onChange={(v) => run(() => api.put("/api/hw/profile", { stop_variant: v }))} options={[["len35", "35 bytes total (header + 33 zeros)"], ["len36", "36 bytes total (header + 34 zeros)"]]} /></Field>
                  <Check checked={dev.profile.force_moves} onChange={(v) => run(() => api.put("/api/hw/profile", { force_moves: v }))} label="Force moves" help="Documented flag 0: movement continues even if a piece is touched. Leave off unless you need it." />
                </div>
              </Panel>
              {!dev.simulated && (
                <Panel title="Hardware verification checklist" hint="required once per device before live motion">
                  {CHECKLIST.map((c, i) => <Check key={i} checked={checks[i]} onChange={(v) => setChecks(checks.map((x, k) => (k === i ? v : x)))} label={c} />)}
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="btn primary" disabled={!checks.every(Boolean) || dev.profile.robot_verified}
                      onClick={() => run(() => api.put("/api/hw/profile", { robot_verified: true, confirm_checklist: true }), "Live robotic motion unlocked for this device")}>
                      {dev.profile.robot_verified ? "Live motion unlocked" : "I verified all of this on my board — unlock live motion"}</button>
                    {dev.profile.robot_verified && <button className="btn" onClick={() => run(() => api.put("/api/hw/profile", { robot_verified: false }))}>Lock again</button>}
                  </div>
                </Panel>)}
              {dev.pieces && (
                <Panel title="Piece status" hint={`reported ${ago(dev.pieces_at)} · raw device values`}>
                  <div className="scroll" style={{ maxHeight: 180 }}><table className="t"><thead><tr><th>#</th><th>Piece</th><th>x</th><th>y</th><th>Battery</th></tr></thead>
                    <tbody>{dev.pieces.map((p: any) => <tr key={p.index}><td className="muted">{p.index + 1}</td><td>{p.symbol}</td><td className="mono">{p.x}</td><td className="mono">{p.y}</td><td>{p.battery}%</td></tr>)}</tbody></table></div>
                  <p className="help">Coordinates are shown as received (0–255). Their orientation is not documented, so the app does not convert them to squares.</p>
                </Panel>)}
            </div>
          </div>
        </div>))}

      {tab === "leds" && <LedTester dev={dev} boardFen={boardFen} reload={reload} />}

      {tab === "log" && (
        <Panel title="Bluetooth traffic" hint="every command sent and report received">
          <div className="scroll" style={{ maxHeight: "62vh" }}>
            <table className="t"><thead><tr><th>Time</th><th>Dir</th><th>Kind</th><th>Bytes</th><th>Note</th><th /></tr></thead>
              <tbody>{(log.data || []).map((r) => (
                <tr key={r.id}><td className="muted nowrap">{new Date(r.ts * 1000).toLocaleTimeString()}</td><td><span className={`pill ${r.direction === "tx" ? "brass" : r.direction === "rx" ? "sky" : ""}`}>{r.direction}</span></td>
                  <td>{r.kind.replace(/_/g, " ")}</td><td className="mono" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis" }}>{r.payload || ""}</td><td className="muted">{r.note}</td>
                  <td>{r.simulated ? <span className="pill sim">SIM</span> : null}</td></tr>))}</tbody></table>
            {!log.data?.length && <div className="empty">Nothing logged yet.</div>}
          </div>
        </Panel>)}
    </div>
  );
}

function LedTester({ dev, boardFen, reload }: { dev: any; boardFen: string | null; reload: () => void }) {
  const [leds, setLeds] = useState<Record<string, string>>({});
  const [color, setColor] = useState("green");
  if (!dev) return <div className="empty">Connect a board to test its LEDs.</div>;
  const rgb = dev.capabilities.led === "rgb";
  const send = (next: Record<string, string>) => act(async () => { await api.post("/api/hw/leds", Object.keys(next).length ? { leds: next } : { off: true }); reload(); });
  return (
    <div className="split">
      <div className="col">
        <Board fen={boardFen || "8/8/8/8/8/8/8/8 w - - 0 1"} tools={false} mode="2d" leds={dev.leds}
          editor={{ onSquare: (sq) => { const n = { ...leds }; if (n[sq]) delete n[sq]; else n[sq] = rgb ? color : "green"; setLeds(n); send(n); } }} />
      </div>
      <div className="col gap-lg">
        <Panel title="LED guidance" hint={rgb ? "colour LEDs: red, green, blue" : "single-colour LEDs"}>
          <p>Click squares to switch their LEDs. This sends the documented LED command and shows the board's state.</p>
          {rgb ? <div className="row">{["red", "green", "blue"].map((c) => <button key={c} className={`btn sm ${color === c ? "on" : ""}`} onClick={() => setColor(c)}>{c}</button>)}</div>
            : <div className="note">This board's LEDs have one colour. Instruction types (source, destination, danger) are shown as lit squares only — colours are not promised where the hardware has none.</div>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => { setLeds({}); send({}); }}>All off</button>
            <button className="btn" onClick={() => act(async () => { await api.post("/api/hw/leds", { source: ["e2"], dest: ["e4"] }); reload(); })}>Example: guide e2 → e4</button>
            <button className="btn" onClick={() => act(async () => { await api.post("/api/hw/leds", { source: ["e4"], dest: ["d5"], danger: ["d5"] }); reload(); })}>Example: capture e4×d5</button>
          </div>
          <p className="help" style={{ marginTop: 8 }}>In lessons and games: {rgb ? "blue = piece to move, green = destination, red = captured piece or danger." : "the squares of the move light up; arrows are shown on screen."}</p>
        </Panel>
      </div>
    </div>
  );
}
