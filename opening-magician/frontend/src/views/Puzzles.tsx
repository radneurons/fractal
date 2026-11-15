// Puzzle lab: solve, filter, and generate puzzles that an engine has verified to have one clearly best move.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, useApi } from "../api";
import Board, { Arrow } from "../chess/Board";
import { tryMove } from "../chess/tree";
import { act, title, useStore } from "../store";
import { BudgetEditor, EnginePicker, Field, Modal, Num, Panel, Select } from "../ui/ui";

export default function Puzzles() {
  const { engines, go, hw, toast } = useStore();
  const [theme, setTheme] = useState(""); const [level, setLevel] = useState(""); const [source, setSource] = useState("");
  const list = useApi<any>(`/api/puzzles?${new URLSearchParams(Object.entries({ theme, level, source }).filter(([, v]) => v) as any)}`);
  const [cur, setCur] = useState<any | null>(null);
  const [gen, setGen] = useState(false);
  const stats = list.data?.stats;
  return (
    <div className="view">
      <div className="view-head"><div><h1>Puzzles</h1><div className="sub">Mined from real games and research. A position only becomes a puzzle when one move is clearly best; near-equal alternatives are accepted.</div></div>
        <span className="spacer" /><button className="btn" onClick={() => setGen(true)}>Generate puzzles</button></div>
      {cur ? <Solver key={cur.id} id={cur.id} onBack={() => { setCur(null); list.reload(); }} onNext={() => { const all = list.data?.puzzles || []; const i = all.findIndex((p: any) => p.id === cur.id); setCur(all[(i + 1) % all.length] || null); }} /> : (
        <div className="col gap-lg">
          <Panel tight>
            <div className="row">
              <Field label="Theme"><select value={theme} onChange={(e) => setTheme(e.target.value)} style={{ minWidth: 180 }}><option value="">all themes</option>{Object.entries(stats?.themes || {}).sort().map(([t, n]) => <option key={t} value={t}>{title(t)} ({String(n)})</option>)}</select></Field>
              <Field label="Difficulty"><select value={level} onChange={(e) => setLevel(e.target.value)}><option value="">all levels</option>{Object.entries(stats?.levels || {}).map(([l, n]) => <option key={l} value={l}>{l} ({String(n)})</option>)}</select></Field>
              <Field label="Source"><Select value={source} onChange={setSource} options={[["", "all sources"], ["catalogue_trap", "Opening traps"], ["game", "Games & tournaments"], ["discovery_trap", "Discovery research"], ["position", "Custom positions"]]} /></Field>
              <span className="grow" />
              {stats && <><div className="kpi"><b>{stats.total}</b><span>Puzzles</span></div><div className="kpi"><b>{stats.attempts ? Math.round((stats.solved / stats.attempts) * 100) + "%" : "–"}</b><span>Solved</span></div></>}
            </div>
          </Panel>
          <div className="grid auto-fit">
            {(list.data?.puzzles || []).map((p: any) => (
              <button key={p.id} className="card" onClick={() => setCur(p)}>
                <div style={{ width: "100%", pointerEvents: "none" }}><Board fen={p.fen} tools={false} mode="2d" coords={false} orientation={p.fen.split(" ")[1] === "b" ? "black" : "white"} /></div>
                <b style={{ marginTop: 8 }}>{p.title}</b>
                <small>{p.difficulty} · {p.rating} · {p.moves} move(s){p.attempts ? ` · solved ${p.solved}/${p.attempts}` : ""}</small>
                <div className="row" style={{ marginTop: 6 }}>{p.themes.slice(0, 3).map((t: string) => <span key={t} className="pill">{title(t)}</span>)}{!p.engine_verified && <span className="pill warn" title="Authored line checked for legality; not yet engine-verified">authored</span>}</div>
              </button>))}
          </div>
          {list.data && !list.data.puzzles.length && <div className="empty">No puzzles match these filters.</div>}
        </div>)}
      {gen && <Generate onClose={() => { setGen(false); list.reload(); }} />}
    </div>
  );
}

function Solver({ id, onBack, onNext }: { id: string; onBack: () => void; onNext: () => void }) {
  const { go, hw, toast } = useStore();
  const pz = useApi<any>(`/api/puzzles/${id}`);
  const [fen, setFen] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<"solving" | "solved" | "revealed">("solving");
  const [mistakes, setMistakes] = useState(0); const [hints, setHints] = useState(0);
  const [hintSq, setHintSq] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [full, setFull] = useState<any | null>(null);
  const [msg, setMsg] = useState("");
  const t0 = useRef(Date.now());
  useEffect(() => { if (pz.data) { setFen(pz.data.fen); t0.current = Date.now(); } }, [pz.data]);
  const finish = async (solved: boolean) => {
    await act(() => api.post(`/api/puzzles/${id}/record`, { solved, time_ms: Date.now() - t0.current, hints, mistakes }));
    setFull(await api.get(`/api/puzzles/${id}?reveal=true`).catch(() => null));
  };
  const move = async (uci: string) => {
    if (state !== "solving" || !fen) return;
    const r = await act(() => api.post(`/api/puzzles/${id}/check`, { index, move: uci }));
    if (!r) return;
    if (!r.correct) { setMistakes((m) => m + 1); setMsg("That is not the move. Try again."); setHintSq(r.hint_square && hints > 0 ? r.hint_square : null); return; }
    const a = tryMove(fen, uci);
    if (!a) return;
    setHintSq(null); setLast(a.uci);
    if (r.done) { setFen(a.fen); setState("solved"); setMsg(r.message || (r.also_mate ? "Also mate — accepted." : "Solved.")); finish(true); return; }
    setMsg("Correct — keep going.");
    setFen(a.fen);
    setTimeout(() => { const b = tryMove(a.fen, r.reply); if (b) { setFen(b.fen); setLast(b.uci); setIndex(r.next_index); } }, 450);
  };
  const p = pz.data;
  if (!p || !fen) return <div className="muted">{pz.error || "Loading…"}</div>;
  const arrows: Arrow[] = state === "revealed" && full ? [{ from: full.solution[0].slice(0, 2), to: full.solution[0].slice(2, 4), color: "#2fa37c" }] : [];
  return (
    <div className="split">
      <div><Board fen={fen} orientation={p.side} movable={state === "solving" ? p.side : "none"} onMove={move} lastMove={last} arrows={arrows} squares={hintSq ? { [hintSq]: "#e0a23a" } : {}} /></div>
      <div className="col gap-lg">
        <Panel title={p.title} hint={`${p.difficulty} · ${p.rating}`} actions={<button className="btn sm" onClick={onBack}>All puzzles</button>}>
          <p style={{ fontSize: 15 }}>{p.side === "white" ? "White" : "Black"} to move — find the best continuation ({Math.ceil(p.length / 2)} move{p.length > 2 ? "s" : ""}).</p>
          <div className="row">{p.themes.map((t: string) => state === "solving" ? null : <span key={t} className="pill">{title(t)}</span>)}{state === "solving" && <span className="muted">Themes are shown after you solve it.</span>}</div>
          {msg && <div className={`note ${state === "solved" ? "good" : msg.startsWith("That") ? "bad" : ""}`} style={{ marginTop: 10 }}>{msg}</div>}
          <div className="row" style={{ marginTop: 10 }}>
            {state === "solving" && <>
              <button className="btn" onClick={async () => { setHints((h) => h + 1); const r = await api.post(`/api/puzzles/${id}/check`, { index, move: "a1a1" }).catch(() => null); const f = await api.get(`/api/puzzles/${id}?reveal=true`); setHintSq(f.solution[index].slice(0, 2)); void r; }}>Hint</button>
              <button className="btn" onClick={() => { setFen(p.fen); setIndex(0); setLast(null); setMsg(""); }}>Retry</button>
              <button className="btn ghost" onClick={() => { setState("revealed"); finish(false); }}>Show the solution</button></>}
            {state !== "solving" && <><button className="btn primary" onClick={onNext}>Next puzzle</button>
              <button className="btn" onClick={() => go("analysis", { fen: p.fen })}>Analyse</button></>}
            {hw?.connected && <button className="btn" onClick={() => go("chessnut", { fen: p.fen })}>Set up on Chessnut</button>}
          </div>
          <p className="help" style={{ marginTop: 8 }}>{mistakes} wrong attempt(s) · {hints} hint(s). Only clean solves count as solved when the puzzle's rating is updated.</p>
        </Panel>
        {full && state !== "solving" && (
          <Panel title="Solution and explanation">
            <p className="mono" style={{ fontSize: 15 }}>{full.solution_san.join(" ")}</p>
            <p>{full.explanation}</p>
            <p className="help">{full.verification.engine_verified ? `Verified by ${full.verification.engine} at depth ${full.verification.depth} (gap to the second-best move: ${(full.verification.gap * 100).toFixed(0)} points of expected score).` : `Verification: ${full.verification.method || "authored"}.`}
              {" "}Source: {title(full.source.kind)}{full.source.opening ? ` · ${full.source.opening}` : ""}.</p>
            <div className="row">{full.source.kind === "catalogue_trap" && <button className="btn sm" onClick={() => go("openings")}>Study the opening</button>}
              <button className="btn sm ghost" onClick={() => confirm("Delete this puzzle?") && act(async () => { await api.del(`/api/puzzles/${id}`); onBack(); })}>Delete puzzle</button></div>
          </Panel>)}
      </div>
    </div>
  );
}

function Generate({ onClose }: { onClose: () => void }) {
  const { engines } = useStore();
  const tours = useApi<any[]>("/api/tournaments"); const exps = useApi<any[]>("/api/experiments");
  const [engine, setEngine] = useState<any>(engines[0] ? { engine_id: engines[engines.length - 1].id, options: {}, profile_id: null } : null);
  const [budget, setBudget] = useState({ min_time: 0.2, max_time: 2, min_depth: 8, max_depth: 20 });
  const [src, setSrc] = useState("pgn"); const [ref, setRef] = useState(""); const [pgn, setPgn] = useState(""); const [max, setMax] = useState(20);
  return (
    <Modal title="Generate puzzles" onClose={onClose}>
      <div className="col">
        <Field label="Mine positions from"><Select value={src} onChange={(v) => { setSrc(v); setRef(""); }} options={[["pgn", "Pasted PGN (your games, studies, books)"], ["tournament", "A tournament's games"], ["experiment", "A discovery experiment's games"]]} /></Field>
        {src === "pgn" && <Field label="PGN"><textarea rows={6} value={pgn} onChange={(e) => setPgn(e.target.value)} /></Field>}
        {src === "tournament" && <Field label="Tournament"><select value={ref} onChange={(e) => setRef(e.target.value)}><option value="">choose…</option>{(tours.data || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
        {src === "experiment" && <Field label="Experiment"><select value={ref} onChange={(e) => setRef(e.target.value)}><option value="">choose…</option>{(exps.data || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
        <EnginePicker value={engine} onChange={setEngine} label="Verifying engine (use your strongest)" />
        <BudgetEditor label="Budget per position" value={budget} onChange={setBudget} />
        <Field label="Stop after this many puzzles"><Num value={max} min={1} max={200} onChange={setMax} /></Field>
        <div className="note">Each candidate position is searched with several lines. It is rejected when two or more moves are about equally good, so no puzzle demands one move where several work.</div>
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" disabled={!engine || (src === "pgn" ? !pgn.trim() : !ref)}
          onClick={() => act(async () => { await api.post("/api/puzzles/mine", { engine, budget, max_puzzles: max, ...(src === "pgn" ? { pgn } : src === "tournament" ? { tournament_id: ref } : { experiment_id: ref }) }); onClose(); }, "Mining started — it runs as a background job; new puzzles appear here when it finishes")}>Start mining</button></div>
      </div>
    </Modal>
  );
}
