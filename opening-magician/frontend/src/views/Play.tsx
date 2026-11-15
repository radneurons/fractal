// Human versus engine: setup (opponent, strength, clock, assistance, physical board) and the live game.
import { useEffect, useMemo, useState } from "react";
import { api, saveText, useApi, useLive } from "../api";
import Board, { Arrow } from "../chess/Board";
import { ClockDesigner, ClockFace, DEFAULT_CLOCK, describeClock, EvalBar, EvalGraph, SanList } from "../chess/widgets";
import { act, title, useStore } from "../store";
import { Check, EnginePicker, Field, Modal, Num, Panel, Select } from "../ui/ui";

type Setup = { engine: any | null; color: "white" | "black" | "random"; mode: string; assistance: string; clock: any; strength: any; start_fen: string;
  opening_moves: string[]; book_id: string; book_plies: number; physical: { use_board: boolean; robot_moves: boolean }; sideline: any };

const LS = "om.play.setup";

export default function Play() {
  const { engines, meta, hw, takeHandoff, go } = useStore();
  const [session, setSession] = useState<any | null>(null);
  const [clockOpen, setClockOpen] = useState(false);
  const books = useApi<any[]>("/api/books");
  const list = useApi<any>("/api/play");
  const [setup, setSetup] = useState<Setup>(() => {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch { return null; } })();
    return { engine: null, color: "white", mode: "casual", assistance: "independent", clock: DEFAULT_CLOCK, strength: { mode: "full" }, start_fen: "", opening_moves: [],
      book_id: "", book_plies: 0, physical: { use_board: false, robot_moves: false }, sideline: { enabled: false, ranks: [2, 3], until_ply: 16, max_loss: 0.08 }, ...(saved || {}) };
  });
  const set = (p: Partial<Setup>) => setSetup((s) => { const n = { ...s, ...p }; localStorage.setItem(LS, JSON.stringify({ ...n, start_fen: "", opening_moves: [] })); return n; });

  useEffect(() => {
    const h = takeHandoff();
    if (h?.fen || h?.moves) setSetup((s) => ({ ...s, start_fen: h.startFen || (h.moves ? "" : h.fen || ""), opening_moves: h.moves || [], mode: h.moves ? "opening_practice" : "position_practice" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!setup.engine && engines.length) set({ engine: { engine_id: engines[0].id, options: {}, profile_id: null } }); }, [engines]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (list.data?.active?.length && !session) setSession(list.data.active[0]); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const boardOn = !!hw?.connected;
  const robotic = !!hw?.device?.capabilities?.robotic;
  const start = async () => {
    const body = { ...setup, start_fen: setup.start_fen || undefined, book_id: setup.book_id || undefined,
      physical: { use_board: setup.physical.use_board && boardOn, robot_moves: setup.physical.robot_moves && robotic } };
    const s = await act(() => api.post("/api/play", body));
    if (s) setSession(s);
  };

  if (session) return <Game initial={session} onExit={() => { setSession(null); list.reload(); }} />;

  const eng = engines.find((e) => e.id === setup.engine?.engine_id);
  const hasElo = eng && Object.keys(eng.options || {}).some((k) => k.toLowerCase() === "uci_elo");
  const hasSkill = eng && Object.keys(eng.options || {}).some((k) => k.toLowerCase() === "skill level");
  return (
    <div className="view">
      <div className="view-head"><div><h1>Play</h1><div className="sub">A real game against a native engine, with the clock and the board you choose.</div></div></div>
      {list.data?.recoverable?.length > 0 && (
        <div className="note warn" style={{ marginBottom: 12 }}>
          An unfinished game was saved when the bridge stopped ({list.data.recoverable[0].moves} moves vs {list.data.recoverable[0].engine_name}).{" "}
          <button className="btn xs" onClick={async () => { const s = await act(() => api.post(`/api/play/${list.data.recoverable[0].id}/recover`)); if (s) setSession(s); }}>Resume it</button>
        </div>)}
      <div className="grid g2">
        <Panel title="Opponent">
          <div className="col">
            <EnginePicker value={setup.engine} onChange={(engine) => set({ engine })} label="Engine" />
            <div className="grid g2">
              <Field label="Strength">
                <Select value={setup.strength.mode} onChange={(mode) => set({ strength: { ...setup.strength, mode } })}
                  options={[["full", "Full strength"], ["elo", "Approximate rating"], ["skill", "Skill level"], ["depth", "Fixed search depth"], ["time", "Fixed time per move"]]} />
              </Field>
              {setup.strength.mode === "elo" && <Field label="Target rating" help={hasElo ? "Uses the engine's own UCI_Elo calibration." : hasSkill ? "This engine has no Elo option: mapped roughly onto Skill Level." : "This engine has no strength option: a depth limit is used instead."}>
                <Num value={setup.strength.elo ?? 1500} min={400} max={3200} step={50} onChange={(v) => set({ strength: { ...setup.strength, elo: v } })} /></Field>}
              {setup.strength.mode === "skill" && <Field label="Skill level" help={hasSkill ? undefined : "Not offered by this engine — a depth limit is used instead."}>
                <Num value={setup.strength.skill ?? 10} min={0} max={20} onChange={(v) => set({ strength: { ...setup.strength, skill: v } })} /></Field>}
              {setup.strength.mode === "depth" && <Field label="Depth (plies)"><Num value={setup.strength.depth ?? 6} min={1} max={40} onChange={(v) => set({ strength: { ...setup.strength, depth: v } })} /></Field>}
              {setup.strength.mode === "time" && <Field label="Milliseconds per move"><Num value={setup.strength.movetime_ms ?? 500} min={20} step={50} onChange={(v) => set({ strength: { ...setup.strength, movetime_ms: v } })} /></Field>}
            </div>
            <div className="grid g2">
              <Field label="You play"><Select value={setup.color} onChange={(color) => set({ color })} options={[["white", "White"], ["black", "Black"], ["random", "Random"]]} /></Field>
              <Field label="Game type"><Select value={setup.mode} onChange={(mode) => set({ mode })} options={(meta?.play_modes || ["casual"]).map((m: string) => [m, title(m)])} /></Field>
            </div>
            <div className="grid g2">
              <Field label="Opening book for the engine"><select value={setup.book_id} onChange={(e) => set({ book_id: e.target.value, book_plies: e.target.value ? setup.book_plies || 12 : 0 })}>
                <option value="">none — engine thinks from move one</option>{(books.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              <Field label="Book depth (plies)"><Num value={setup.book_plies} min={0} max={60} onChange={(v) => set({ book_plies: v })} /></Field>
            </div>
            <Check checked={setup.sideline.enabled} onChange={(v) => set({ sideline: { ...setup.sideline, enabled: v } })} label="Opponent plays sidelines"
              help="In the opening the engine picks its 2nd or 3rd choice when that costs little — to test you off the main road." />
            {(setup.start_fen || setup.opening_moves.length > 0) && (
              <div className="note">Starting from {setup.opening_moves.length ? `the line ${setup.opening_moves.join(" ")}` : "a custom position"}.{" "}
                <button className="btn xs" onClick={() => set({ start_fen: "", opening_moves: [] })}>Use the normal start</button></div>)}
            <Field label="Start position (FEN, optional)"><input type="text" value={setup.start_fen} placeholder="leave empty for the standard starting position" onChange={(e) => set({ start_fen: e.target.value.trim() })} /></Field>
          </div>
        </Panel>
        <div className="col gap-lg">
          <Panel title="Clock" actions={<button className="btn sm" onClick={() => setClockOpen(true)}>Open Clock Designer</button>}>
            <div className="note"><b>{setup.clock.name || "Custom"}</b> — {describeClock(setup.clock)}</div>
            <div className="row" style={{ marginTop: 10 }}>
              {["Unlimited", "Blitz 5+3", "Rapid 10+5", "Rapid 15+10", "Classical 30+0", "Physical board 10+5 (+8 s hand-move allowance)"].map((n) => {
                const p = (meta?.clock_presets || []).find((x: any) => x.name === n);
                return p ? <button key={n} className={`btn sm ${setup.clock.name === n ? "on" : ""}`} onClick={() => set({ clock: { ...DEFAULT_CLOCK, ...p, physical: { ...DEFAULT_CLOCK.physical, ...(p.physical || {}) }, robot: setup.clock.robot } })}>{n.replace(" (+8 s hand-move allowance)", " + hand-move time")}</button> : null;
              })}
            </div>
          </Panel>
          <Panel title="Coaching">
            <div className="col">
              {Object.entries(meta?.assistance || {}).map(([k, v]) => (
                <label className="check" key={k}><input type="radio" name="assist" checked={setup.assistance === k} onChange={() => set({ assistance: k })} />
                  <span>{String(v).split(" — ")[0]}<small>{String(v).split(" — ")[1]}</small></span></label>))}
              <span className="help">Assistance is for training. Keep it off wherever fair-play rules forbid engine help.</span>
            </div>
          </Panel>
          <Panel title="Physical board" hint={boardOn ? hw.device.name : "not connected"}>
            {boardOn ? (
              <div className="col">
                {hw.device.simulated && <div className="sim-banner">SIMULATED BOARD — no real hardware is being driven</div>}
                <Check checked={setup.physical.use_board} onChange={(v) => set({ physical: { ...setup.physical, use_board: v } })} label="Play my moves on the board"
                  help="Your moves are read from the sensors and checked against the rules." />
                {robotic
                  ? <Check checked={setup.physical.robot_moves} disabled={!setup.physical.use_board} onChange={(v) => set({ physical: { ...setup.physical, robot_moves: v } })}
                      label="Chessnut Move makes the engine's moves" help={hw.robot?.live_motion_unlocked ? "Each move is sent as one verified target position." : "Live motion is locked until the hardware checklist is completed in Robot Studio."} />
                  : <div className="note">This board cannot move pieces. The engine's move is shown with LEDs and on screen; you place it, and the sensors confirm it.
                      Give yourself time for that with the <b>Human Physical Move Allowance</b> in the Clock Designer.</div>}
              </div>
            ) : <div className="row"><span className="muted grow">Connect a Chessnut board (or the simulator) to play over the board.</span><button className="btn sm" onClick={() => go("chessnut")}>Connect</button></div>}
          </Panel>
          <button className="btn primary big" disabled={!setup.engine} onClick={start}>Start game</button>
        </div>
      </div>
      {clockOpen && (
        <Modal title="Clock Designer" onClose={() => setClockOpen(false)} wide>
          <ClockDesigner value={setup.clock} onChange={(clock) => set({ clock })} physicalAvailable={setup.physical.use_board && boardOn} robotAvailable={robotic || !boardOn} />
          <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}><button className="btn primary" onClick={() => setClockOpen(false)}>Use this clock</button></div>
        </Modal>)}
    </div>
  );
}

function Game({ initial, onExit }: { initial: any; onExit: () => void }) {
  const { go, hw } = useStore();
  const [st, setSt] = useState<any>(initial);
  const [flip, setFlip] = useState(initial.human === "black");
  const [hint, setHint] = useState<any[] | null>(null);
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<any | null>(null);
  useLive(`play:${st.id}`, (m) => { setSt(m.data); setHint(null); setViewPly(null); });
  useEffect(() => { const id = setInterval(() => api.get(`/api/play/${st.id}`).then(setSt).catch(() => undefined), 5000); return () => clearInterval(id); }, [st.id]);
  const post = (action: string, body?: any) => act(async () => { const r = await api.post(`/api/play/${st.id}/${action}`, body); if (r?.id) setSt(r); return r; });

  const over = st.status === "finished";
  const myTurn = !over && st.turn === (st.human === "white" ? "w" : "b") && !st.thinking;
  const fens: string[] = useMemo(() => [st.start_fen, ...st.evals.map((e: any) => e.fen_after).filter(Boolean)], [st.evals, st.start_fen]);
  const shownFen = viewPly != null && fens[viewPly] ? fens[viewPly] : st.fen;
  const lastEval = [...st.evals].reverse().find((e: any) => e.text);
  const arrows: Arrow[] = [];
  if (hint) hint.slice(0, 3).forEach((l, i) => arrows.push({ from: l.move.slice(0, 2), to: l.move.slice(2, 4), color: ["#2fa37c", "#5aa7e0", "#e0a23a"][i], width: 1.1 - i * 0.2, label: l.score.text }));
  if (st.pending_sync) arrows.push({ from: st.pending_sync.slice(0, 2), to: st.pending_sync.slice(2, 4), color: "#5aa7e0", label: "place" });
  const top = flip ? "white" : "black", bottom = flip ? "black" : "white";
  const nameOf = (side: string) => (st.human === side ? "You" : st.engine_name);
  const labels: Record<number, string> = {};
  (analysis?.moves || []).forEach((m: any) => { labels[m.ply] = m.label; });

  return (
    <div className="view">
      <div className="split wideboard">
        <div className="col">
          <div className="row nowrap"><ClockFace snap={st.clock} side={top as any} name={nameOf(top)} /><span className="grow" />
            {st.thinking && <span className="pill brass">{st.engine_name} is thinking…</span>}</div>
          <div className="row nowrap" style={{ alignItems: "stretch" }}>
            {(st.assistance === "training" || over) && <EvalBar expected={lastEval?.expected_white} text={lastEval?.text} orientation={flip ? "black" : "white"} />}
            <div className="grow"><Board fen={shownFen} orientation={flip ? "black" : "white"} movable={viewPly == null && !over ? st.human : "none"} premove
              lastMove={viewPly == null ? st.last_move : st.moves[viewPly - 1]} arrows={viewPly == null ? arrows : []} onFlip={() => setFlip(!flip)}
              leds={st.physical && hw?.sim ? hw.sim.leds : undefined} onMove={(uci) => post("move", { move: uci })} /></div>
          </div>
          <div className="row nowrap"><ClockFace snap={st.clock} side={bottom as any} name={nameOf(bottom)} /><span className="grow" />
            {myTurn && <span className="pill good">your move</span>}</div>
        </div>
        <div className="col gap-lg">
          {st.physical && <div className={hw?.device?.simulated ? "sim-banner" : "note good"}>{hw?.device?.simulated ? "SIMULATED BOARD in use" : "Physical board in use"}{st.robot ? " — the robot executes the engine's moves" : " — you relay the engine's moves"}</div>}
          {st.notice && <div className="note warn">{st.notice}{st.pending_sync && !st.robot && <> <button className="btn xs" onClick={() => post("synced")}>I have placed it</button></>}</div>}
          {st.promotion_prompt && (
            <div className="note">A pawn reached the last rank on the board. Promote to:{" "}
              {st.promotion_prompt.options.map((o: string) => <button key={o} className="btn xs" onClick={() => post("move", { move: o })}>{({ q: "Queen", r: "Rook", b: "Bishop", n: "Knight" } as any)[o[4]]}</button>)}</div>)}
          {over && (
            <Panel title={`Game over — ${st.result}`}>
              <p>{title(st.termination)}{st.detail ? `: ${st.detail}` : ""}</p>
              <div className="row">
                <button className="btn primary" onClick={onExit}>New game</button>
                {st.game_id && <button className="btn" onClick={async () => { const r = await act(() => api.post(`/api/games/${st.game_id}/analyse`, { engine: { engine_id: useStore.getState().engines[0]?.id }, budget: { min_time: 0.2, max_time: 1.5, min_depth: 8, max_depth: 18 } })); if (r) pollAnalysis(st.game_id, setAnalysis); }}>Analyse the game</button>}
                {st.game_id && <button className="btn" onClick={() => api.download(`/api/games/${st.game_id}/pgn`, "game.pgn")}>Download PGN</button>}
                {st.game_id && <button className="btn" onClick={async () => { const s = await act(() => api.post("/api/studies", { game_id: st.game_id }), "Study created"); if (s) go("studies"); }}>Make a study</button>}
                <button className="btn" onClick={() => go("analysis", { moves: st.moves, startFen: st.start_fen })}>Open on the analysis board</button>
              </div>
              {analysis && <p className="help" style={{ marginTop: 8 }}>Accuracy — White {analysis.accuracy.w ?? "–"}%, Black {analysis.accuracy.b ?? "–"}%. {analysis.note}</p>}
            </Panel>)}
          <Panel title={st.opening ? `${st.opening.eco} · ${st.opening.name}` : "Moves"} hint={`${st.mode.replace(/_/g, " ")} · ${st.strength?.mechanism || ""}`}>
            <div style={{ maxHeight: 210, overflow: "auto" }}><SanList sans={st.sans} startFen={st.start_fen} current={viewPly ?? st.sans.length} onPick={(p) => setViewPly(p === st.sans.length ? null : p)} annotations={labels} /></div>
            {(st.assistance === "training" || over) && st.evals.some((e: any) => e.expected_white != null) &&
              <div style={{ marginTop: 10 }}><EvalGraph points={st.evals.map((e: any) => e.expected_white ?? null)} current={(viewPly ?? st.sans.length) - 1} onPick={(i) => setViewPly(i + 1)} /></div>}
          </Panel>
          {!over && (
            <Panel title="Controls">
              <div className="row">
                {st.assistance === "training" && <button className="btn" disabled={!myTurn} onClick={async () => { const r = await post("hint"); if (r?.lines) setHint(r.lines); }}>Hint</button>}
                <button className="btn" disabled={!st.can_undo || st.sans.length === 0} onClick={() => post("undo")} title={st.can_undo ? "" : "Take-backs are off in this mode"}>Take back</button>
                <button className="btn" onClick={() => post("offer_draw").then((r) => r && useStore.getState().toast(r.accepted ? "Draw agreed" : "Draw offer declined"))}>Offer draw</button>
                <button className="btn" disabled={!st.can_claim_threefold && !st.can_claim_fifty} onClick={() => post("claim_draw")}>Claim draw</button>
                {st.clock.kind !== "unlimited" && st.clock.label !== "official" && <button className="btn" onClick={() => post(st.clock.paused ? "resume" : "pause")}>{st.clock.paused ? "Resume clock" : "Pause clock"}</button>}
                {st.clock.kind !== "unlimited" && st.clock.label !== "official" && <>
                  <button className="btn sm" title="Add 30 seconds to your clock" onClick={() => post("adjust_clock", { side: st.human, delta_ms: 30000 })}>+30s me</button>
                  <button className="btn sm" title="Add 30 seconds to the engine's clock" onClick={() => post("adjust_clock", { side: st.human === "white" ? "black" : "white", delta_ms: 30000 })}>+30s engine</button></>}
                <span className="grow" />
                <button className="btn danger" onClick={() => confirm("Resign this game?") && post("resign")}>Resign</button>
                <button className="btn ghost" onClick={async () => { await post("abort"); onExit(); }}>Abort</button>
              </div>
              <p className="help" style={{ marginTop: 8 }}>{describeClock(st.config.clock)}{st.clock.physical_active && st.clock[st.human]?.allowance ? " — hand-move allowance active." : ""}</p>
            </Panel>)}
          {hint && <Panel title="Hint" hint="training assistance">{hint.map((l, i) => <div key={i} className="mono"><b>{l.san}</b> <span className="muted">{l.score.text} · depth {l.depth}</span> {l.pv_san.slice(1, 6).join(" ")}</div>)}</Panel>}
          {over && analysis && (
            <Panel title="Move review" hint="engine-backed classification">
              <div className="scroll" style={{ maxHeight: 240 }}>
                <table className="t"><tbody>{analysis.moves.filter((m: any) => ["inaccuracy", "mistake", "blunder"].includes(m.label)).map((m: any) => (
                  <tr key={m.ply} className="click" onClick={() => setViewPly(m.ply)}><td className="mono">{Math.ceil(m.ply / 2)}{m.side === "w" ? "." : "…"} {m.san}</td>
                    <td className={`cls-${m.label}`}>{m.label}{m.provisional ? " (provisional)" : ""}</td><td className="muted">best {m.best_san}</td><td className="mono muted">−{(m.expected_loss * 100).toFixed(0)}%</td></tr>))}</tbody></table>
              </div>
            </Panel>)}
        </div>
      </div>
    </div>
  );
}

async function pollAnalysis(gameId: string, done: (a: any) => void) {
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const g = await api.get(`/api/games/${gameId}`).catch(() => null);
    if (g?.meta?.analysis) { done(g.meta.analysis); useStore.getState().toast("Game analysis finished", "ok"); return; }
  }
}
// kept for PGN export from the setup screen
export const exportPgn = (pgn: string) => saveText(pgn, "game.pgn");
