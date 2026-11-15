// Opening Training Academy: decks, spaced repetition, skill model, weakness correction, modes and mini-games.
import { Chess } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, useApi, useLive } from "../api";
import Board, { Arrow } from "../chess/Board";
import { GameTree, START_FEN, tryMove } from "../chess/tree";
import { act, title, useStore } from "../store";
import { EnginePicker, Field, Meter, Modal, Panel, Select, Tabs } from "../ui/ui";

type Launch = { kind: "cards" | "task" | "engine"; mode: string; label: string; params?: any };
const MODES: { id: string; name: string; text: string; launch: Launch | "play" | "puzzles" }[] = [
  { id: "guided", name: "Guided Opening Lesson", text: "Recall each move with hints available.", launch: { kind: "cards", mode: "guided", label: "Guided lesson" } },
  { id: "recall", name: "Move Recall", text: "The next move is hidden — play it.", launch: { kind: "cards", mode: "recall", label: "Move recall" } },
  { id: "repertoire", name: "Repertoire Trainer", text: "Due positions from all your decks.", launch: { kind: "cards", mode: "repertoire", label: "Repertoire" } },
  { id: "random_branch", name: "Random Branch Trainer", text: "Positions in random order.", launch: { kind: "cards", mode: "random_branch", label: "Random branches" } },
  { id: "move_order", name: "Move-Order Challenge", text: "Reach a position by another move order.", launch: { kind: "task", mode: "move_order", label: "Move order" } },
  { id: "transposition", name: "Transposition Challenge", text: "Recognise an opening reached unusually.", launch: { kind: "task", mode: "transposition", label: "Transposition" } },
  { id: "survival", name: "Opening Survival", text: "The engine picks sidelines; keep a sound position.", launch: "play" },
  { id: "trap", name: "Trap Recognition", text: "Avoid the move that loses at once.", launch: { kind: "task", mode: "trap", label: "Trap recognition", params: { variant: "avoid" } } },
  { id: "punish", name: "Punish the Mistake", text: "Find the refutation of an inaccuracy.", launch: { kind: "task", mode: "trap", label: "Punish the mistake", params: { variant: "punish" } } },
  { id: "blitz", name: "Opening Blitz", text: "Ten seconds per position.", launch: { kind: "cards", mode: "blitz", label: "Opening blitz" } },
  { id: "deep", name: "Deep Calculation", text: "Enter your line; compare it with the engine's.", launch: { kind: "engine", mode: "deep_calculation", label: "Deep calculation" } },
  { id: "plan", name: "Plan Recognition", text: "Which plan belongs to this opening?", launch: { kind: "task", mode: "plan", label: "Plan recognition" } },
  { id: "pawn", name: "Pawn-Structure Training", text: "Read the structure, not the moves.", launch: { kind: "task", mode: "pawn_structure", label: "Pawn structures" } },
  { id: "position", name: "Play From Position", text: "A real engine game from an opening.", launch: "play" },
  { id: "physical", name: "Physical Chessnut Training", text: "Answer on your connected board.", launch: { kind: "cards", mode: "physical", label: "Physical training" } },
];
const GAMES: { n: number; name: string; text: string; launch: Launch | "play" | "puzzles" }[] = [
  { n: 1, name: "Opening Labyrinth", text: "Find the door that stays in the book. Three lives.", launch: { kind: "task", mode: "labyrinth", label: "Opening Labyrinth" } },
  { n: 2, name: "Trap Hunter", text: "Spot the trap before you fall into it.", launch: { kind: "task", mode: "trap", label: "Trap Hunter", params: { variant: "avoid" } } },
  { n: 3, name: "Best Move Detective", text: "Four candidates — which does the engine prefer?", launch: { kind: "engine", mode: "best_move_detective", label: "Best Move Detective" } },
  { n: 4, name: "The Fifth Move Challenge", text: "Is the engine's fifth choice still viable?", launch: { kind: "engine", mode: "fifth_move", label: "The Fifth Move Challenge" } },
  { n: 5, name: "Move-Order Master", text: "Same position, different road.", launch: { kind: "task", mode: "move_order", label: "Move-Order Master" } },
  { n: 6, name: "Repertoire Defender", text: "The engine leaves the main line on purpose.", launch: "play" },
  { n: 7, name: "Tactical Ambush", text: "Tactics that grow out of the opening.", launch: "puzzles" },
  { n: 8, name: "Find the Refutation", text: "A suspicious move — find its rebuttal.", launch: { kind: "task", mode: "trap", label: "Find the Refutation", params: { variant: "punish" } } },
  { n: 9, name: "Engine Prediction", text: "Predict what a weaker engine will play.", launch: { kind: "engine", mode: "engine_prediction", label: "Engine Prediction" } },
  { n: 10, name: "Novelty Investigator", text: "Judge a discovered move before seeing the verdict.", launch: { kind: "engine", mode: "novelty_investigator", label: "Novelty Investigator" } },
];

export default function Training() {
  const { go } = useStore();
  const ov = useApi<any>("/api/training/overview");
  const cat = useApi<any>("/api/openings");
  const books = useApi<any[]>("/api/books");
  const [tab, setTab] = useState<"today" | "modes" | "games" | "weak">("today");
  const [deck, setDeck] = useState<string>("");
  const [run, setRun] = useState<Launch | null>(null);
  const [newDeck, setNewDeck] = useState<{ kind: string; id: string; color: string }>({ kind: "opening", id: "", color: "white" });
  const start = (l: Launch | "play" | "puzzles", extra?: any) => {
    if (l === "puzzles") return go("puzzles");
    if (l === "play") { const o = cat.data?.openings?.filter((x: any) => x.plies >= 4 && x.plies <= 8); const pick = o?.[Math.floor(Math.random() * o.length)]; return go("play", pick ? { moves: pick.uci } : null); }
    setRun({ ...l, params: { ...(l.params || {}), ...(extra || {}) } });
  };
  if (run) return <Session launch={run} deck={deck} openings={cat.data?.openings || []} onExit={() => { setRun(null); ov.reload(); }} />;
  const d = ov.data;
  const dims = d ? Object.entries(d.skills) as [string, any][] : [];
  return (
    <div className="view">
      <div className="view-head"><div><h1>Training Academy</h1><div className="sub">Scores come only from what you actually answer — correct moves, time, hints and repeated errors.</div></div></div>
      <Tabs value={tab} onChange={setTab} items={[["today", "Today"], ["modes", "Training modes"], ["games", "Mini-games"], ["weak", `Weaknesses${d?.weaknesses?.length ? ` (${d.weaknesses.length})` : ""}`]]} />
      {tab === "today" && d && (
        <div className="grid g2">
          <Panel title="Your decks" hint="spaced repetition">
            {d.decks.map((k: any) => (
              <div key={k.deck} className={`tree-node ${deck === k.deck ? "sel" : ""}`} style={{ padding: "6px 8px" }} onClick={() => setDeck(deck === k.deck ? "" : k.deck)}>
                <div className="grow"><b>{k.title}</b><div className="muted" style={{ fontSize: 12 }}>{k.n} positions · {k.fresh} new · {k.lapses} misses</div></div>
                <span className={`pill ${k.due ? "brass" : "good"}`}>{k.due ? `${k.due} due` : "up to date"}</span>
                <button className="btn xs ghost" onClick={(e) => { e.stopPropagation(); confirm("Delete this deck and its review history?") && act(async () => { await api.del(`/api/training/decks?deck=${encodeURIComponent(k.deck)}`); ov.reload(); }); }}>✕</button>
              </div>))}
            {!d.decks.length && <div className="empty">No decks yet. Build one from an opening or a book below.</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={!d.decks.length} onClick={() => start({ kind: "cards", mode: "repertoire", label: deck ? "Review" : "Review all decks" })}>{d.progress.due ? `Review ${d.progress.due} due` : "Practise ahead"}</button>
              <span className="muted">{deck ? "selected deck" : "all decks"}</span>
            </div>
            <div className="label" style={{ marginTop: 14 }}>Build a deck</div>
            <div className="row nowrap">
              <Select value={newDeck.kind} onChange={(kind) => setNewDeck({ ...newDeck, kind, id: "" })} options={[["opening", "Opening"], ["book", "Book"]]} style={{ width: 110 }} />
              <select value={newDeck.id} onChange={(e) => setNewDeck({ ...newDeck, id: e.target.value })}><option value="">choose…</option>
                {newDeck.kind === "opening" ? (cat.data?.openings || []).map((o: any) => <option key={o.id} value={o.id}>{o.eco} {o.name}</option>) : (books.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              <Select value={newDeck.color} onChange={(color) => setNewDeck({ ...newDeck, color })} options={[["white", "as White"], ["black", "as Black"]]} style={{ width: 110 }} />
              <button className="btn" disabled={!newDeck.id} onClick={() => act(async () => { const r = await api.post("/api/training/decks", { [newDeck.kind === "opening" ? "opening_id" : "book_id"]: newDeck.id, color: newDeck.color }); ov.reload(); setDeck(r.deck); return r; }, "Deck ready")}>Build</button>
            </div>
          </Panel>
          <Panel title="Skill estimates" hint="recent answers weigh more">
            <Radar dims={dims} />
            {dims.map(([k, s]) => (
              <div key={k} className="row nowrap" style={{ fontSize: 12.5, padding: "2px 0" }} title={`${s.n} answer(s); confidence ${(s.confidence * 100).toFixed(0)}%`}>
                <span style={{ width: 210 }}>{s.label}</span><div className="grow"><Meter value={s.value ?? 0} kind={s.value == null ? "" : s.value < 0.5 ? "bad" : ""} /></div>
                <span className="mono" style={{ width: 86, textAlign: "right" }}>{s.value == null ? "no data" : `${(s.value * 100).toFixed(0)}%`}{s.trend != null && s.trend !== 0 ? (s.trend > 0 ? " ↑" : " ↓") : ""}</span></div>))}
          </Panel>
          <Panel title="Progress">
            <div className="grid g4">
              <div className="kpi"><b>{d.progress.cards}</b><span>Positions</span></div><div className="kpi"><b>{d.progress.mature}</b><span>Learned</span></div>
              <div className="kpi"><b>{d.progress.due}</b><span>Due now</span></div><div className="kpi"><b>{d.progress.streak_days}</b><span>Day streak</span></div></div>
            <div className="row nowrap" style={{ alignItems: "flex-end", height: 70, marginTop: 12, gap: 4 }}>{Array.from({ length: 15 }, (_, i) => { const day = d.progress.daily.find((x: any) => x.d === i); const h = day ? Math.min(60, 6 + day.n * 3) : 2;
              return <div key={i} title={day ? `${day.n} answers, ${day.c} correct` : "no training"} style={{ flex: 1, height: h, borderRadius: 3, background: day ? `color-mix(in srgb, var(--emerald) ${Math.round((day.c / day.n) * 100)}%, var(--ruby))` : "var(--line)" }} />; })}</div>
            <div className="help">Last 15 days — bar height is the number of answers, colour is accuracy.</div>
          </Panel>
          <Panel title="By mode">{d.progress.by_mode.length ? <table className="t"><thead><tr><th>Mode</th><th>Answers</th><th>Correct</th><th>Avg time</th></tr></thead><tbody>{d.progress.by_mode.map((m: any) => (
            <tr key={m.mode}><td>{title(m.mode)}</td><td>{m.n}</td><td>{m.n ? ((m.c / m.n) * 100).toFixed(0) : 0}%</td><td>{m.t ? (m.t / 1000).toFixed(1) + "s" : "–"}</td></tr>))}</tbody></table> : <span className="muted">Nothing recorded yet.</span>}</Panel>
        </div>)}
      {tab === "modes" && <div className="grid auto-fit">{MODES.map((m) => <button key={m.id} className="card" onClick={() => start(m.launch)}><b>{m.name}</b><small>{m.text}</small></button>)}</div>}
      {tab === "games" && <div className="grid auto-fit">{GAMES.map((g) => <button key={g.n} className="card" onClick={() => start(g.launch)}><span className="pill brass">Game {g.n}</span><b style={{ marginTop: 6 }}>{g.name}</b><small>{g.text}</small></button>)}</div>}
      {tab === "weak" && d && (d.weaknesses.length ? <div className="col gap-lg">{d.weaknesses.map((w: any) => (
        <Panel key={w.card_id} title={<>{w.opening || "Line"} — you keep missing <span className="mono">{w.san}</span></>} hint={`${w.lapses} misses${w.accuracy != null ? ` · ${(w.accuracy * 100).toFixed(0)}% correct` : ""}`}>
          <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
            <div style={{ width: 230 }}><Board fen={w.fen} orientation={w.fen.split(" ")[1] === "b" ? "black" : "white"} tools={false} mode="2d"
              arrows={w.plan.arrows.map((a: any) => ({ from: a.from, to: a.to, color: a.kind === "best" ? "#2fa37c" : "#d2584f", dashed: a.kind !== "best" }))} squares={Object.fromEntries(w.plan.key_squares.map((s: string) => [s, "#c9a45c"]))} /></div>
            <div className="col grow">
              <div><b>1 · The problem.</b> {w.plan.identify}{w.usually_played_san ? ` You usually play ${w.usually_played_san} instead.` : ""}</div>
              <div><b>2 · Why the move works.</b> {w.plan.explain}</div>
              <div><b>3 · Plans to remember.</b> {w.plan.plans.join(" · ")}</div>
              <div><b>4 · Review.</b> {w.plan.review}</div>
              <div className="row"><button className="btn primary" onClick={() => start({ kind: "cards", mode: "guided", label: "Guided correction", params: { only: w.card_id, deck: w.deck } })}>Guided exercise</button>
                {w.plan.similar_position && <button className="btn" onClick={() => start({ kind: "cards", mode: "recall", label: "Similar position", params: { only: w.plan.similar_position.id, deck: w.deck } })}>Test a similar position</button>}</div>
            </div>
          </div>
        </Panel>))}</div> : <div className="empty">No recurring weaknesses detected. They appear here once you miss the same position repeatedly.</div>)}
    </div>
  );
}

function Radar({ dims }: { dims: [string, any][] }) {
  const n = dims.length || 1; const R = 62, cx = 90, cy = 78;
  const pt = (i: number, v: number) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return `${cx + Math.cos(a) * R * v},${cy + Math.sin(a) * R * v}`; };
  return <svg viewBox="0 0 180 156" style={{ width: 200, display: "block", margin: "0 auto 8px" }}>
    {[0.33, 0.66, 1].map((r) => <polygon key={r} points={dims.map((_, i) => pt(i, r)).join(" ")} fill="none" stroke="var(--line)" />)}
    {dims.map((_, i) => <line key={i} x1={cx} y1={cy} x2={pt(i, 1).split(",")[0]} y2={pt(i, 1).split(",")[1]} stroke="var(--line-soft)" />)}
    <polygon points={dims.map(([, s], i) => pt(i, s.value ?? 0)).join(" ")} fill="color-mix(in srgb, var(--emerald) 35%, transparent)" stroke="var(--emerald-2)" strokeWidth="1.5" />
  </svg>;
}

// ---------------------------------------------------------------------------------------------- session runner
function Session({ launch, deck, openings, onExit }: { launch: Launch; deck: string; openings: any[]; onExit: () => void }) {
  const [score, setScore] = useState({ right: 0, wrong: 0, streak: 0, best: 0, lives: launch.mode === "labyrinth" ? 3 : -1 });
  const mark = (ok: boolean) => setScore((s) => ({ right: s.right + (ok ? 1 : 0), wrong: s.wrong + (ok ? 0 : 1), streak: ok ? s.streak + 1 : 0, best: Math.max(s.best, ok ? s.streak + 1 : s.streak), lives: ok || s.lives < 0 ? s.lives : s.lives - 1 }));
  const dead = score.lives === 0;
  return (
    <div className="view">
      <div className="view-head"><div><h1>{launch.label}</h1></div><span className="spacer" />
        <span className="pill good">{score.right} correct</span><span className="pill bad">{score.wrong} missed</span><span className="pill brass">streak {score.streak} · best {score.best}</span>
        {score.lives >= 0 && <span className="pill">{"♥".repeat(score.lives) || "no lives"}</span>}
        <button className="btn" onClick={onExit}>Finish</button></div>
      {dead ? <div className="empty"><h2>Out of lives</h2><p>You went {score.right} room(s) deep. Best streak {score.best}.</p><button className="btn primary" onClick={onExit}>Back to training</button></div>
        : launch.kind === "cards" ? <Cards launch={launch} deck={launch.params?.deck || deck} mark={mark} onExit={onExit} />
        : launch.kind === "task" ? <Tasks launch={launch} mark={mark} />
        : <EngineGames launch={launch} openings={openings} mark={mark} />}
    </div>
  );
}

function Feedback({ fb, onNext }: { fb: { ok: boolean; text: string; extra?: string } | null; onNext: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (fb) ref.current?.focus(); }, [fb]);
  if (!fb) return null;
  return <div className={`note ${fb.ok ? "good" : "bad"}`}><b>{fb.ok ? "Correct." : "Not quite."}</b> {fb.text}{fb.extra && <div className="help" style={{ marginTop: 4 }}>{fb.extra}</div>}
    <div style={{ marginTop: 8 }}><button ref={ref} className="btn primary sm" onClick={onNext}>Next (Enter)</button></div></div>;
}

function Cards({ launch, deck, mark, onExit }: { launch: Launch; deck: string; mark: (ok: boolean) => void; onExit: () => void }) {
  const { hw, toast } = useStore();
  const [cards, setCards] = useState<any[] | null>(null);
  const [i, setI] = useState(0);
  const [fb, setFb] = useState<any>(null);
  const [hints, setHints] = useState(0);
  const [left, setLeft] = useState(10);
  const [steps, setSteps] = useState<any[] | null>(null);
  const [hintFrom, setHintFrom] = useState<string | null>(null);
  const t0 = useRef(Date.now());
  const blitz = launch.mode === "blitz", physical = launch.mode === "physical";
  useEffect(() => { api.get(`/api/training/cards?n=${launch.params?.only ? 60 : 12}&mode=${launch.mode}${deck ? `&deck=${encodeURIComponent(deck)}` : ""}`).then((c) => setCards(launch.params?.only ? c.filter((x: any) => x.id === launch.params.only) : c)).catch(() => setCards([])); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const card = cards?.[i];
  useEffect(() => { t0.current = Date.now(); setHints(0); setLeft(10); setSteps(null); setHintFrom(null); }, [i, cards]);
  const answer = async (move: string) => {
    if (fb || !card) return;
    const r = await act(() => api.post("/api/training/answer", { card_id: card.id, move, time_ms: Date.now() - t0.current, hints, mode: launch.mode }));
    if (!r) return;
    if (r.legal === false) { toast(r.message); return; }
    const ok = r.correct || r.alternative;
    mark(ok);
    setFb({ ok, text: r.message, extra: [r.note, ok ? `Next review in ${r.interval_days ? r.interval_days + " day(s)" : "10 minutes"}.` : "It comes back in 10 minutes."].filter(Boolean).join(" "), expected: r.expected });
  };
  useEffect(() => { if (!blitz || fb || !card) return; if (left <= 0) { answer("0000"); return; } const id = setTimeout(() => setLeft((l) => l - 1), 1000); return () => clearTimeout(id); }, [left, blitz, fb, card]); // eslint-disable-line react-hooks/exhaustive-deps
  // physical training: the move made on the Chessnut board is recognised by matching the sensed placement against every legal move
  useLive(physical ? "hw" : null, (m) => {
    if (m.type !== "position" || !card || fb) return;
    const c = new Chess(card.fen);
    for (const mv of c.moves({ verbose: true })) { const r = tryMove(card.fen, mv.from + mv.to + (mv.promotion || "")); if (r && r.fen.split(" ")[0] === m.data.board_fen) { answer(mv.from + mv.to + (mv.promotion || "")); return; } }
  });
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Enter" && fb) next(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });
  const next = () => { setFb(null); setI((x) => x + 1); };
  if (!cards) return <div className="muted">Loading…</div>;
  if (!cards.length) return <div className="empty">Nothing to review here. Build a deck from an opening or a book on the Today tab.<br /><button className="btn" style={{ marginTop: 10 }} onClick={onExit}>Back</button></div>;
  if (!card) return <div className="empty"><h2>Session complete</h2><p>{cards.length} position(s) reviewed.</p><button className="btn primary" onClick={onExit}>Done</button></div>;
  const arrows: Arrow[] = fb?.expected ? [{ from: fb.expected.slice(0, 2), to: fb.expected.slice(2, 4), color: "#2fa37c" }] : [];
  const hintSq: Record<string, string> = {};
  if (hintFrom && !fb) hintSq[hintFrom] = "#e0a23a";
  const onBoard = physical && hw?.device?.board_fen;
  const inSync = onBoard && hw.device.board_fen === card.fen.split(" ")[0];
  return (
    <div className="split">
      <div className="col"><Board fen={card.fen} orientation={card.color} movable={fb ? "none" : card.color} onMove={answer} arrows={arrows} squares={hintSq} lastMove={card.history[card.history.length - 1] || null} />
        {blitz && !fb && <div className="meter brass"><i style={{ width: `${left * 10}%` }} /></div>}</div>
      <div className="col gap-lg">
        <Panel title={card.opening || "Your repertoire"} hint={`${i + 1} / ${cards.length}${card.is_new ? " · new" : ` · seen ${card.reps}×`}`}>
          <p style={{ fontSize: 15 }}>{card.color === "white" ? "White" : "Black"} to move. What is your repertoire move?</p>
          <p className="mono muted">{card.history.length ? GameTree.fromMoves(null, card.history).sans().join(" ") : "Starting position"}</p>
          {physical && (hw?.connected ? <div className={`note ${inSync ? "good" : "warn"}`}>
            {inSync ? "The board shows this position — make your move on the board." : "Set this position up on your board first."}{" "}
            {!inSync && <button className="btn xs" onClick={async () => { if (hw.robot) { const p = await act(() => api.post("/api/hw/robot/plan", { fen: card.fen, reason: "training position" })); if (p?.operation?.feasible) await act(() => api.post("/api/hw/robot/confirm", { op_id: p.operation.id })); } else { const r = await act(() => api.post("/api/hw/setup-steps", { fen: card.fen })); if (r) setSteps(r.steps); } }}>{hw.robot ? "Let the robot set it up" : "Show me the steps"}</button>}
            {steps && <div className="mono" style={{ marginTop: 6 }}>{steps.map((s, k) => <div key={k}>{s.action} {s.piece} {s.from || ""}{s.to ? " → " + s.to : ""}</div>)}{!steps.length && "Nothing to change."}</div>}
          </div> : <div className="note warn">No board is connected — answer on screen, or connect one in the Chessnut view.</div>)}
          {!fb && launch.mode !== "blitz" && <div className="row"><button className="btn sm" disabled={hints > 0} onClick={async () => { const h = await act(() => api.get(`/api/training/hint?card_id=${card.id}`)); if (h) { setHints(1); setHintFrom(h.from); } }}>{hints === 0 ? "Hint: which piece?" : "Hint used"}</button>
            <button className="btn sm ghost" onClick={() => answer("0000")}>I don't know</button><span className="help">Hints and slow answers shorten the next interval.</span></div>}
          <Feedback fb={fb} onNext={next} />
        </Panel>
      </div>
    </div>
  );
}
function Tasks({ launch, mark }: { launch: Launch; mark: (ok: boolean) => void }) {
  const [task, setTask] = useState<any>(null);
  const [fb, setFb] = useState<any>(null);
  const [played, setPlayed] = useState<string[]>([]);
  const [fen, setFen] = useState(START_FEN);
  const [room, setRoom] = useState<string | null>(null);
  const t0 = useRef(Date.now());
  const load = async (roomFen?: string | null) => {
    setFb(null); setPlayed([]);
    const t = await act(() => api.post("/api/training/task", { kind: launch.mode, params: { ...(launch.params || {}), ...(roomFen ? { fen: roomFen } : {}) } }));
    if (t) { setTask(t); setFen(t.fen || t.start_fen || START_FEN); t0.current = Date.now(); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Enter" && fb) load(room); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });
  const submit = async (response: any) => {
    const r = await act(() => api.post("/api/training/check", { task_id: task.id, response: { ...response, time_ms: Date.now() - t0.current } }));
    if (!r) return;
    mark(r.correct);
    let text = r.explain || "";
    if (task.kind === "trap") text = (task.variant === "avoid" ? (r.correct ? "You avoided it. " : `${r.trap_move} was the trap. `) : (r.correct ? "" : `The refutation was ${r.answer_san}. `)) + text;
    if (task.kind === "move_order" && !r.correct) text = (r.same_as_main ? "That is the main move order — find another one. " : r.reached ? "" : "That does not reach the target position. ") + text;
    if (r.answer && typeof r.answer === "string" && task.options && !r.correct) text = `Answer: ${r.answer}. ` + text;
    setFb({ ok: r.correct, text, line: r.line });
    if (task.kind === "labyrinth") setRoom(r.correct ? tryMove(task.fen, response.move)?.fen || null : task.fen);
  };
  if (!task) return <div className="muted">Loading…</div>;
  if (task.exit) return <div className="empty"><h2>You reached the end of the book here</h2><p>{task.opening || "Unnamed line"}</p><button className="btn primary" onClick={() => { setRoom(null); load(null); }}>Enter the labyrinth again</button></div>;
  const side = task.side || (fen.split(" ")[1] === "b" ? "black" : "white");
  const squares: Record<string, string> = {};
  (task.key_squares || []).forEach((s: string) => (squares[s] = "#c9a45c"));
  return (
    <div className="split">
      <div className="col">
        <Board fen={fen} orientation={side} squares={squares} movable={fb ? "none" : task.kind === "trap" ? side : task.kind === "move_order" ? "both" : "none"}
          onMove={(u) => { if (task.kind === "trap") submit({ move: u }); else { const r = tryMove(fen, u); if (r) { setFen(r.fen); setPlayed([...played, r.uci]); } } }} />
        {task.kind === "move_order" && <div className="row"><span className="muted">Target:</span><div style={{ width: 150 }}><Board fen={task.target_fen} tools={false} mode="2d" coords={false} /></div>
          <div className="col"><span className="mono">{played.length} / {task.max_plies} plies</span><button className="btn sm" onClick={() => { setFen(START_FEN); setPlayed([]); }}>Start over</button>
            <button className="btn sm primary" disabled={!!fb || !played.length} onClick={() => submit({ moves: played })}>Check</button></div></div>}
      </div>
      <div className="col gap-lg">
        <Panel title={task.name || task.opening || title(task.kind)}>
          <p style={{ fontSize: 15 }}>{task.prompt}</p>
          {task.moves && <p className="mono muted">{task.moves.join(" ")}</p>}
          {task.history && <p className="mono muted">{task.history.join(" ")}</p>}
          {task.canonical && <p className="help">Main move order: <span className="mono">{task.canonical.join(" ")}</span></p>}
          {task.options && !fb && <div className="col">{task.options.map((o: any) => typeof o === "string"
            ? <button key={o} className="btn" style={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }} onClick={() => submit({ value: o })}>{o}</button>
            : <button key={o.uci} className="btn" onClick={() => submit({ move: o.uci })}><span className="mono">{o.san}</span></button>)}</div>}
          <Feedback fb={fb} onNext={() => load(room)} />
          {fb?.line && <p className="mono muted" style={{ marginTop: 8 }}>{fb.line.join(" ")}</p>}
        </Panel>
      </div>
    </div>
  );
}

function EngineGames({ launch, openings, mark }: { launch: Launch; openings: any[]; mark: (ok: boolean) => void }) {
  const { engines } = useStore();
  const [engine, setEngine] = useState<any>(null);
  const [pos, setPos] = useState<any>(null);
  const [ranked, setRanked] = useState<any>(null);
  const [fb, setFb] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ fen: string; ucis: string[]; sans: string[] }>({ fen: START_FEN, ucis: [], sans: [] });
  const [finding, setFinding] = useState<any>(null);
  const t0 = useRef(Date.now());
  const mode = launch.mode;
  useEffect(() => { if (engines.length && !engine) setEngine({ engine_id: engines[0].id, options: {}, profile_id: null }); }, [engines]); // eslint-disable-line react-hooks/exhaustive-deps
  const budget = mode === "engine_prediction" ? { min_time: 0.05, max_time: 0.4, min_depth: 2, max_depth: 4 } : { min_time: 0.3, max_time: 2.5, min_depth: 6, max_depth: 18 };
  const load = async () => {
    setFb(null); setRanked(null);
    if (mode === "novelty_investigator") {
      const all = await act(() => api.get("/api/findings"));
      const done = (all || []).filter((f: any) => f.scores?.objective_viability && f.evidence?.verification);
      setFinding(done.length ? done[Math.floor(Math.random() * done.length)] : false);
      return;
    }
    const pool = openings.filter((o) => o.plies >= 4 && o.plies <= 14);
    if (!pool.length || !engine) return;
    const o = pool[Math.floor(Math.random() * pool.length)];
    setPos(o); setLine({ fen: o.fen, ucis: [], sans: [] }); setBusy(true);
    const n = mode === "fifth_move" ? 5 : mode === "deep_calculation" ? 1 : 4;
    const r = await act(() => api.post("/api/analysis/ranked", { engine, fen: o.fen, n, budget }));
    setBusy(false);
    if (r) { setRanked({ ...r, shuffled: [...r.candidates].sort(() => Math.random() - 0.5) }); t0.current = Date.now(); }
  };
  useEffect(() => { if (engine) load(); }, [engine?.engine_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Enter" && fb) load(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });
  const log = (ok: boolean, detail: any) => { mark(ok); api.post("/api/training/log", { mode, correct: ok, time_ms: Date.now() - t0.current, detail }).catch(() => undefined); };

  if (mode === "novelty_investigator") {
    if (finding === null) return <div className="muted">Loading…</div>;
    if (finding === false) return <div className="empty">This game needs verified findings from the Discovery Lab. Run an experiment first.</div>;
    const f = finding; const via = f.scores.objective_viability.value;
    const truth = via >= 0.6 ? "promising" : via >= 0.25 ? "dubious" : "refuted";
    return <div className="split"><div><Board fen={f.fen} arrows={[{ from: f.move_uci.slice(0, 2), to: f.move_uci.slice(2, 4), color: "#9b82e6" }]} orientation={f.fen.split(" ")[1] === "b" ? "black" : "white"} /></div>
      <Panel title="Novelty Investigator"><p style={{ fontSize: 15 }}>An explorer engine proposed <b className="mono">{f.move_san}</b> here (its #{f.ranking.original_rank} choice). Line: <span className="mono">{f.line_san}</span></p>
        <p>Does it deserve further research?</p>
        {!fb && <div className="row">{["promising", "dubious", "refuted"].map((v) => <button key={v} className="btn" onClick={() => { const ok = v === truth; log(ok, { finding: f.id, guess: v }); setFb({ ok, text: `The verifier's verdict: ${truth} (objective viability ${via.toFixed(2)}). ${f.scores.objective_viability.explanation}`, extra: `Category: ${title(f.category)}. ${f.scores.research_confidence.explanation}` }); }}>{title(v)}</button>)}</div>}
        <Feedback fb={fb} onNext={load} /></Panel></div>;
  }
  if (!engine) return <div className="empty">Register an engine first — these games are judged by real analysis.</div>;
  const cands: any[] = ranked?.candidates || [];
  const best = cands[0];
  const letters = "ABCD";
  const arrows: Arrow[] = [];
  if (ranked && (mode === "best_move_detective" || mode === "engine_prediction")) ranked.shuffled.forEach((c: any, i: number) => arrows.push({ from: c.move.slice(0, 2), to: c.move.slice(2, 4), color: fb ? (c.rank === 1 ? "#2fa37c" : "#85786a") : "#5aa7e0", label: fb ? `#${c.rank}` : letters[i], width: 0.9 }));
  if (ranked && mode === "fifth_move" && cands.length) { const c = cands[cands.length - 1]; arrows.push({ from: c.move.slice(0, 2), to: c.move.slice(2, 4), color: "#9b82e6", label: `#${c.rank}` }); }
  if (fb && mode === "deep_calculation" && best) arrows.push({ from: best.move.slice(0, 2), to: best.move.slice(2, 4), color: "#2fa37c" });
  const choose = (c: any) => { const ok = c.rank === 1; log(ok, { opening: pos?.name, guess: c.san }); setFb({ ok, text: `${ranked.engine} ranks ${best.san} first (${best.score.text}, depth ${ranked.depth}).`, extra: ranked.shuffled.map((x: any) => `#${x.rank} ${x.san} ${x.score.text}`).sort().join(" · ") + (mode === "best_move_detective" ? ` — ${best.pv_san.slice(0, 6).join(" ")}` : "") }); };
  return (
    <div className="split">
      <div className="col"><Board fen={mode === "deep_calculation" ? line.fen : pos?.fen || START_FEN} arrows={arrows} orientation={pos?.fen?.split(" ")[1] === "b" ? "black" : "white"}
        movable={mode === "deep_calculation" && !fb && line.ucis.length < 3 ? "both" : "none"} onMove={(u) => { const r = tryMove(line.fen, u); if (r) setLine({ fen: r.fen, ucis: [...line.ucis, r.uci], sans: [...line.sans, r.san] }); }} /></div>
      <div className="col gap-lg">
        <Panel title={pos ? `${pos.eco} · ${pos.name}` : launch.label} hint={ranked ? `${ranked.engine} · depth ${ranked.depth}` : ""}>
          <EnginePicker value={engine} onChange={setEngine} label={mode === "engine_prediction" ? "Engine to predict (try a low skill level)" : "Judge"} />
          {busy && <p className="muted" style={{ marginTop: 10 }}>The engine is analysing…</p>}
          {ranked && mode === "best_move_detective" && <><p style={{ fontSize: 15, marginTop: 10 }}>Four candidate moves. Which one is best — and why?</p>
            {!fb && <div className="row">{ranked.shuffled.map((c: any, i: number) => <button key={c.move} className="btn" onClick={() => choose(c)}>{letters[i]} · <span className="mono">{c.san}</span></button>)}</div>}</>}
          {ranked && mode === "engine_prediction" && <><p style={{ fontSize: 15, marginTop: 10 }}>This engine searched only to depth {ranked.depth}. Which move will it choose?</p>
            {!fb && <div className="row">{ranked.shuffled.map((c: any, i: number) => <button key={c.move} className="btn" onClick={() => choose(c)}>{letters[i]} · <span className="mono">{c.san}</span></button>)}</div>}</>}
          {ranked && mode === "fifth_move" && (cands.length >= 5 ? <><p style={{ fontSize: 15, marginTop: 10 }}>The engine's fifth choice here is <b className="mono">{cands[4].san}</b>. Is it still viable (within 6 points of expected score of the best move)?</p>
            {!fb && <div className="row">{[["viable", true], ["not viable", false]].map(([l, v]) => <button key={String(l)} className="btn" onClick={() => { const truth = cands[4].loss.expected_loss <= 0.06 && !cands[4].loss.walks_into_mate; const ok = v === truth; log(ok, { opening: pos?.name, move: cands[4].san });
              setFb({ ok, text: `${cands[4].san} is ${truth ? "viable" : "not viable"}: ${cands[4].score.text} against ${best.score.text} for ${best.san} (loss ${(cands[4].loss.expected_loss * 100).toFixed(1)} points).`, extra: `Evidence at depth ${ranked.depth}; a deeper search could reorder the candidates. Continuation: ${cands[4].pv_san.slice(0, 6).join(" ")}` }); }}>{title(String(l))}</button>)}</div>}</>
            : <p className="muted">Fewer than five legal candidates here. <button className="btn xs" onClick={load}>Another position</button></p>)}
          {ranked && mode === "deep_calculation" && <><p style={{ fontSize: 15, marginTop: 10 }}>Calculate: play the best move and the two moves you expect to follow (3 plies) on the board.</p>
            <p className="mono">{line.sans.join(" ") || "…"}</p>
            {!fb && <div className="row"><button className="btn sm" onClick={() => setLine({ fen: pos.fen, ucis: [], sans: [] })}>Start over</button>
              <button className="btn primary sm" disabled={!line.ucis.length} onClick={() => { let m = 0; while (m < line.ucis.length && best.pv[m] === line.ucis[m]) m++; const ok = m >= 1; log(ok && m >= 2, { opening: pos?.name, matched: m });
                setFb({ ok, text: `${m} of your ${line.ucis.length} plies match the engine's line.`, extra: `Engine: ${best.pv_san.slice(0, 6).join(" ")} (${best.score.text}, depth ${ranked.depth}).` }); }}>Compare with the engine</button></div>}</>}
          <Feedback fb={fb} onNext={load} />
        </Panel>
      </div>
    </div>
  );
}
