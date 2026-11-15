// Preparation: the grandmaster's toolkit — opponent dossiers, your own leaks, coverage, practical
// scoring, move orders, structures, the preparation file, goal repertoires, drills and endgames.
import { Chess } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, useApi, useLive } from "../api";
import Board, { MiniBoard } from "../chess/Board";
import { GameTree, START_FEN, tryMove } from "../chess/tree";
import { EvalGraph } from "../chess/widgets";
import { act, title, useStore } from "../store";
import { BudgetEditor, Check, EnginePicker, Field, Meter, Num, Panel, Select, Tabs } from "../ui/ui";

type Tab = "opponent" | "leaks" | "coverage" | "practical" | "orders" | "structures" | "file" | "goal" | "drills" | "endgames";
const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const DEFAULT_BUDGET = { min_time: 0.3, max_time: 2.5, min_depth: 8, max_depth: 22 };

/** Run an engine-backed preparation job and wait for its stored result. */
function useJob() {
  const [state, setState] = useState<{ busy: boolean; progress: number; result: any; error: string | null }>({ busy: false, progress: 0, result: null, error: null });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = async (body: any): Promise<any> => {
    setState({ busy: true, progress: 0, result: null, error: null });
    try {
      const { job_id } = await api.post("/api/prep/job", body);
      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        if (!alive.current) return null;
        const j = await api.get(`/api/jobs/${job_id}`);
        if (j.status === "completed") { setState({ busy: false, progress: 1, result: j.result, error: null }); return j.result; }
        if (["failed", "canceled"].includes(j.status)) throw new Error(j.error || `Job ${j.status}`);
        setState((s) => ({ ...s, progress: j.progress || 0 }));
      }
    } catch (e) { const m = (e as Error).message; setState({ busy: false, progress: 0, result: null, error: m }); useStore.getState().toast(m, "err"); return null; }
  };
  return { ...state, run };
}

function BookSelect({ value, onChange, books, none, filter }: { value: string; onChange: (v: string) => void; books: any[]; none?: string; filter?: (b: any) => boolean }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)}>{none !== undefined && <option value="">{none}</option>}
    {books.filter(filter || (() => true)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>;
}
const ColorSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <Select value={value} onChange={onChange} options={[["white", "I play White"], ["black", "I play Black"]]} />;
const JobBar = ({ job }: { job: { busy: boolean; progress: number } }) => job.busy ? <div className="row nowrap"><span className="muted nowrap">Engine working…</span><div className="grow"><Meter value={job.progress} kind="brass" /></div></div> : null;

export default function Prep() {
  const { engines } = useStore();
  const [tab, setTab] = useState<Tab>("opponent");
  const books = useApi<any[]>("/api/books");
  const cols = useApi<any[]>("/api/prep/collections");
  const [engine, setEngine] = useState<any>(null);
  const [budget, setBudget] = useState(DEFAULT_BUDGET);
  useEffect(() => { if (engines.length && !engine) setEngine({ engine_id: (engines.find((e) => e.kind === "native") || engines[0]).id, options: {}, profile_id: null }); }, [engines]); // eslint-disable-line react-hooks/exhaustive-deps
  const shared = { books: books.data || [], cols: cols.data || [], engine, budget, reloadBooks: books.reload, reloadCols: cols.reload };
  const repertoire = (b: any) => !["opponent", "games"].includes(b.profile);
  return (
    <div className="view">
      <div className="view-head"><div><h1>Preparation</h1><div className="sub">What a strong player does before a game: know the opponent, know your own leaks, and know which lines are practical — not just correct.</div></div>
        <span className="spacer" />
        <div style={{ width: 400 }}><EnginePicker value={engine} onChange={setEngine} label="Engine for checks" /></div>
        <div style={{ width: 330 }}><BudgetEditor label="Budget per position" value={budget} onChange={setBudget} /></div>
      </div>
      <Tabs value={tab} onChange={setTab} items={[["opponent", "Opponent dossier"], ["leaks", "My leaks"], ["coverage", "Coverage audit"], ["practical", "Practical score"], ["orders", "Move orders"],
        ["structures", "Structures"], ["file", "Prep file & alerts"], ["goal", "Draw / must-win"], ["drills", "Drills"], ["endgames", "Endgames"]]} />
      {tab === "opponent" && <Opponent {...shared} repertoire={repertoire} />}
      {tab === "leaks" && <Leaks {...shared} repertoire={repertoire} />}
      {tab === "coverage" && <Coverage {...shared} repertoire={repertoire} />}
      {tab === "practical" && <Practical {...shared} />}
      {tab === "orders" && <Orders {...shared} />}
      {tab === "structures" && <Structures {...shared} repertoire={repertoire} />}
      {tab === "file" && <PrepFile {...shared} repertoire={repertoire} />}
      {tab === "goal" && <Goal {...shared} repertoire={repertoire} />}
      {tab === "drills" && <Drills {...shared} repertoire={repertoire} />}
      {tab === "endgames" && <Endgames {...shared} />}
    </div>
  );
}
type P = { books: any[]; cols: any[]; engine: any; budget: any; reloadBooks: () => void; reloadCols: () => void; repertoire?: (b: any) => boolean };

// ---------------------------------------------------------------------------------------------- import
function ImportGames({ kind, onDone }: { kind: "opponent" | "me"; onDone: (c: any) => void }) {
  const [mode, setMode] = useState<"pgn" | "online">("pgn");
  const [pgn, setPgn] = useState(""); const [player, setPlayer] = useState(""); const [site, setSite] = useState("lichess"); const [user, setUser] = useState(""); const [max, setMax] = useState(300);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const body = mode === "pgn" ? { pgn, player: player || undefined, name: player || undefined, kind } : { site, username: user, max_games: max, kind };
    const c = await act(() => api.post("/api/prep/collections", body), "Games imported");
    setBusy(false);
    if (c) { setPgn(""); onDone(c); }
  };
  return (
    <Panel title={kind === "me" ? "Import my games" : "Import an opponent's games"} tight>
      <div className="row"><button className={`btn sm ${mode === "pgn" ? "on" : ""}`} onClick={() => setMode("pgn")}>From a PGN</button>
        <button className={`btn sm ${mode === "online" ? "on" : ""}`} onClick={() => setMode("online")}>By username (online, optional)</button></div>
      {mode === "pgn" ? <div className="col" style={{ marginTop: 8 }}>
        <textarea rows={4} value={pgn} onChange={(e) => setPgn(e.target.value)} placeholder="Paste games, or open a file" />
        <div className="row nowrap"><label className="btn sm">Open file…<input type="file" accept=".pgn,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPgn(await f.text()); }} /></label>
          <input type="text" value={player} onChange={(e) => setPlayer(e.target.value)} placeholder={kind === "me" ? "my name in these games (optional)" : "player name (optional — detected if empty)"} /></div>
      </div> : <div className="col" style={{ marginTop: 8 }}>
        <div className="row nowrap"><Select value={site} onChange={setSite} options={[["lichess", "Lichess"], ["chesscom", "Chess.com"]]} style={{ width: 130 }} />
          <input type="text" value={user} onChange={(e) => setUser(e.target.value)} placeholder="username" /><Num value={max} min={20} max={2000} step={50} style={{ width: 90 }} onChange={setMax} /></div>
        <div className="help">This is the only feature that uses the internet: the bridge downloads that player's public games from the site you choose. Everything else works offline.</div>
      </div>}
      <div style={{ marginTop: 8 }}><button className="btn primary sm" disabled={busy || (mode === "pgn" ? !pgn.trim() : !user.trim())} onClick={go}>{busy ? "Importing…" : "Import"}</button></div>
    </Panel>
  );
}

function CollectionPicker({ cols, kind, value, onChange, reload }: { cols: any[]; kind: "opponent" | "me"; value: string; onChange: (v: string) => void; reload: () => void }) {
  const mine = cols.filter((c) => c.kind === kind);
  useEffect(() => { if (!value && mine.length) onChange(mine[0].id); }, [cols]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="col">
      <Panel title={kind === "me" ? "My game collections" : "Opponents"} tight>
        {mine.map((c) => (
          <div key={c.id} className={`tree-node ${value === c.id ? "sel" : ""}`} style={{ whiteSpace: "normal", padding: "6px 8px" }} onClick={() => onChange(c.id)}>
            <div className="grow"><b>{c.player}</b><div className="muted" style={{ fontSize: 12 }}>{c.stats.games} games{c.stats.from ? ` · ${c.stats.from.slice(0, 4)}–${(c.stats.to || "").slice(0, 4)}` : ""} · {c.source}</div></div>
            <button className="btn xs ghost" onClick={(e) => { e.stopPropagation(); confirm(`Delete the games and books of ${c.player}?`) && act(async () => { await api.del(`/api/prep/collections/${c.id}`); onChange(""); reload(); }); }}>✕</button></div>))}
        {!mine.length && <div className="muted" style={{ padding: 6 }}>Nothing imported yet.</div>}
      </Panel>
      <ImportGames kind={kind} onDone={(c) => { reload(); onChange(c.id); }} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 1 · opponent dossier
function Opponent({ books, cols, engine, budget, reloadCols, reloadBooks, repertoire }: P) {
  const { go } = useStore();
  const [cid, setCid] = useState("");
  const [color, setColor] = useState("white");
  const [mine, setMine] = useState("");
  const d = useApi<any>(cid ? `/api/prep/dossier/${cid}` : null);
  const [sheet, setSheet] = useState<any>(null);
  const job = useJob();
  useEffect(() => { setSheet(null); }, [cid]);
  const side = d.data?.sides?.[color === "white" ? "black" : "white"];
  const list = (rows: any[], render: (r: any) => React.ReactNode, empty: string) => rows?.length ? rows.map((r, i) => (
    <div key={i} className="row nowrap" style={{ padding: "2px 0", fontSize: 13 }}><span className="mono grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.line} <b>{r.san}</b></span>{render(r)}
      <button className="btn xs" onClick={() => go("analysis", { fen: r.fen })}>Look</button></div>)) : <span className="muted">{empty}</span>;
  return (
    <div className="side-list">
      <CollectionPicker cols={cols} kind="opponent" value={cid} onChange={setCid} reload={() => { reloadCols(); reloadBooks(); }} />
      {!cid ? <div className="empty">Import an opponent's games to build their dossier.</div> : !d.data ? <div className="muted">{d.error || "Reading the games…"}</div> : (
        <div className="col gap-lg">
          <Panel title={`Prep sheet against ${d.data.player}`} actions={<div className="row nowrap"><ColorSelect value={color} onChange={(c) => { setColor(c); setSheet(null); }} />
            <BookSelect value={mine} onChange={setMine} books={books} none="no repertoire book" filter={repertoire} />
            <button className="btn primary sm" onClick={async () => setSheet(await act(() => api.post("/api/prep/sheet", { collection_id: cid, my_color: color, my_book_id: mine })))}>Build</button></div>}>
            {sheet ? <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
              <MiniBoard fen={sheet.final_fen} size={210} orientation={color as any} />
              <div className="col grow">
                <p style={{ fontSize: 15 }}>{sheet.summary}</p>
                {sheet.steps.map((s: any) => <div key={s.ply} style={{ fontSize: 13 }}><span className={`pill ${s.who === "you" ? "good" : "brass"}`}>{s.who}</span> <b className="mono">{s.san || "—"}</b> <span className="muted">{s.why}</span></div>)}
                {sheet.targets.length > 0 && <div className="note good"><b>Aim at:</b> {sheet.targets.join(" ")}</div>}
                <div className="row"><button className="btn sm" onClick={() => go("analysis", { moves: sheet.uci })}>Analyse the line</button>
                  <button className="btn sm" onClick={() => go("openings", { playbackMoves: sheet.uci, title: `Prep vs ${sheet.player}` })}>Replay / send to board</button>
                  <button className="btn sm" onClick={() => act(() => api.post("/api/training/decks", { title: `Prep vs ${sheet.player}`, moves: sheet.uci, color }), "Training deck built")}>Drill it</button>
                  <button className="btn sm" onClick={() => go("play", { moves: sheet.uci })}>Play it out against an engine</button></div>
                <div className="help">Based on {sheet.based_on_games} games. {sheet.used_repertoire ? "Your moves come from your repertoire book." : "No repertoire book chosen: your moves are the ones that scored best against them."}</div>
              </div></div> : <span className="muted">Choose your colour (and your repertoire book, if you have one) and build the plan for this game.</span>}
          </Panel>
          <div className="grid g2">
            <Panel title={`What they play as ${color === "white" ? "Black" : "White"}`} hint={`${side.games} games · +${side.record.wins} =${side.record.draws} −${side.record.losses}`}>
              {side.first_moves.map((f: any, i: number) => f.replies ? <div key={i}>vs <b className="mono">{f.against}</b> ({f.games}): {f.replies.map((r: any) => `${r.san} ${pct(r.share)}`).join(" · ")}</div>
                : <div key={i}><b className="mono">{f.san}</b> {pct(f.share)} of games · scores {pct(f.score)}</div>)}
              <div className="label" style={{ marginTop: 8 }}>Main lines</div>
              {side.main_lines.map((l: any, i: number) => <div key={i} className="mono" style={{ fontSize: 12.5 }}>{l.line} <span className="muted">({l.games}){l.opening ? ` · ${l.opening}` : ""}</span></div>)}
            </Panel>
            <Panel title="Habits" hint="plays the same move 80%+ of the time">{list(side.habits, (r) => <span className="muted nowrap">{r.games} games</span>, "No fixed habits with enough games.")}</Panel>
            <Panel title="Where they score badly" hint="their own moves">{list(side.weak_moves, (r) => <span className="pill bad">{pct(r.score)} in {r.games}</span>, "Nothing stands out.")}</Panel>
            <Panel title="What works against them" hint="opponents' moves">{list(side.struggles_against, (r) => <span className="pill good">{pct(r.score)} in {r.games}</span>, "Nothing stands out.")}</Panel>
            <Panel title="Where they leave the book">{list(side.leaves_theory, (r) => <span className="muted nowrap">{r.games}×</span>, "They stay inside the reference book.")}</Panel>
            <Panel title="Engine check of their favourite moves" actions={<button className="btn sm" disabled={!engine || job.busy} onClick={async () => { await job.run({ task: "dossier", collection_id: cid, engine, budget }); d.reload(); }}>Check with engine</button>}>
              <JobBar job={job} />
              {d.data.engine_flags.length ? d.data.engine_flags.map((f: any, i: number) => (
                <div key={i} style={{ fontSize: 13 }}><span className="pill">{f.side}</span> <b className="mono">{f.san}</b> played {f.games}× — loses {Math.round(f.expected_loss * 100)} points; {f.engine} prefers <b className="mono">{f.best_san}</b> ({f.best_score} vs {f.score}, depth {f.depth})
                  {" "}<button className="btn xs" onClick={() => go("analysis", { fen: f.fen })}>Look</button></div>))
                : <span className="muted">{d.data.collection.stats.engine_checked ? "The engine found nothing clearly wrong with their most frequent moves." : "Not checked yet."}</span>}
            </Panel>
          </div>
          <div className="help">{d.data.note}</div>
        </div>)}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 2 · leaks
function Leaks({ books, cols, engine, budget, reloadCols, reloadBooks, repertoire }: P) {
  const { go } = useStore();
  const [cid, setCid] = useState(""); const [book, setBook] = useState("");
  const [data, setData] = useState<any>(null);
  const job = useJob();
  const load = async () => setData(await act(() => api.post("/api/prep/leaks", { collection_id: cid, book_id: book })));
  useEffect(() => { if (cid && book) load(); else setData(null); }, [cid, book]); // eslint-disable-line react-hooks/exhaustive-deps
  const table = (rows: any[], mine: boolean) => (
    <table className="t"><thead><tr><th>After</th><th>{mine ? "You played" : "They played"}</th>{mine && <th>Repertoire</th>}<th>Games</th><th>Your score</th>{mine && <th>Engine</th>}<th /></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td className="mono">{r.line || "start"}</td><td className="mono"><b>{r.played}</b></td>{mine && <td className="mono good-t">{r.expected}</td>}<td>{r.count}</td>
        <td>{pct(r.score)}</td>{mine && <td className="muted">{r.engine ? `${r.engine.verdict} (${r.engine.played} vs ${r.engine.repertoire})` : "–"}</td>}
        <td className="right"><button className="btn xs" onClick={() => go("analysis", { fen: r.fen })}>Look</button></td></tr>)}</tbody></table>);
  return (
    <div className="side-list">
      <CollectionPicker cols={cols} kind="me" value={cid} onChange={setCid} reload={() => { reloadCols(); reloadBooks(); }} />
      <div className="col gap-lg">
        <Panel title="Compare my games with my repertoire" actions={<div style={{ width: 280 }}><BookSelect value={book} onChange={setBook} books={books} none="choose my repertoire book…" filter={repertoire} /></div>}>
          {!cid || !book ? <span className="muted">Import your games and choose the book that holds your repertoire.</span> : !data ? <span className="muted">Working…</span> : <>
            <div className="grid g4"><div className="kpi"><b>{data.games}</b><span>Games checked</span></div><div className="kpi"><b>{data.leaks.length}</b><span>Leaks</span></div>
              <div className="kpi"><b>{data.surprises.length}</b><span>Surprises</span></div><div className="kpi"><b>{data.avg_book_depth}</b><span>Plies in book (avg)</span></div></div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" disabled={!data.leaks.length} onClick={() => act(async () => { const r = await api.post("/api/prep/leaks", { collection_id: cid, book_id: book, to_cards: true }); useStore.getState().toast(`${r.added} new card(s) in the “My leaks” deck`, "ok"); })}>Turn every leak into a training card</button>
              <button className="btn" disabled={!engine || job.busy || !data.leaks.length} onClick={async () => { await job.run({ task: "leak_costs", collection_id: cid, book_id: book, engine, budget }); load(); }}>What did each one cost? (engine)</button></div>
            <JobBar job={job} /></>}
        </Panel>
        {data && <>
          <Panel title="Leaks — where you left your own repertoire" hint="sorted by games × points lost">{data.leaks.length ? table(data.leaks, true) : <span className="muted">You followed your repertoire wherever it had a move. </span>}</Panel>
          <Panel title="Surprises — opponent moves your book has no answer to">{data.surprises.length ? table(data.surprises, false) : <span className="muted">None.</span>}
            {data.surprises.length > 0 && <p className="help" style={{ marginTop: 6 }}>Add replies to these in the Book Forge, or research them in the Discovery Lab.</p>}</Panel>
          <div className="help">{data.note}</div></>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 4 · coverage
function Coverage({ books, repertoire }: P) {
  const { go } = useStore();
  const [book, setBook] = useState(""); const [color, setColor] = useState("white"); const [src, setSrc] = useState(""); const [ply, setPly] = useState(16);
  const [out, setOut] = useState<any>(null);
  return (
    <div className="col gap-lg">
      <Panel title="Audit my repertoire against what opponents play">
        <div className="grid g4" style={{ alignItems: "end" }}>
          <Field label="My repertoire"><BookSelect value={book} onChange={setBook} books={books} none="choose…" filter={repertoire} /></Field>
          <Field label="Colour"><ColorSelect value={color} onChange={setColor} /></Field>
          <Field label="Opponents' moves come from" help="A games book weights by games played."><BookSelect value={src} onChange={setSrc} books={books} none="built-in reference catalogue" /></Field>
          <div className="row nowrap"><Field label="Depth (plies)"><Num value={ply} min={4} max={40} onChange={setPly} /></Field>
            <button className="btn primary" disabled={!book} onClick={async () => setOut(await act(() => api.post("/api/prep/coverage", { book_id: book, color, source_book_id: src, max_ply: ply })))}>Audit</button></div>
        </div>
      </Panel>
      {out && <>
        <Panel title={`Coverage ${pct(out.coverage)}`} hint={`${out.hole_count} hole(s) within ${out.max_ply} plies`}>
          <Meter value={out.coverage} kind={out.coverage < 0.7 ? "bad" : ""} />
          <p className="help" style={{ marginTop: 6 }}>Families you play: {out.families.join(", ") || "none named yet"}. {out.note}</p>
        </Panel>
        <Panel title="Holes, most frequent first">
          <table className="t"><thead><tr><th>Reached by</th><th>Share of games</th><th>Opening</th><th>Theory continues with</th><th /></tr></thead>
            <tbody>{out.holes.map((h: any, i: number) => <tr key={i}><td className="mono">{h.line}</td><td><div className="row nowrap"><div style={{ width: 70 }}><Meter value={Math.min(1, h.mass * 4)} kind="bad" /></div><b>{(h.mass * 100).toFixed(1)}%</b></div></td>
              <td>{h.opening || "–"} {h.outside_repertoire && <span className="pill warn" title="An opening family you do not otherwise play — typically reached by transposition">outside repertoire</span>}</td>
              <td className="mono muted">{h.common_replies.join(", ")}</td>
              <td className="right nowrap"><button className="btn xs" onClick={() => go("analysis", { fen: h.fen })}>Look</button>{" "}<button className="btn xs" onClick={() => go("discovery", { fen: h.fen })}>Research</button></td></tr>)}</tbody></table>
          {!out.holes.length && <div className="muted">No holes at this depth.</div>}
        </Panel></>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 3 · practical score
function Practical({ books, engine, budget }: P) {
  const { takeHandoff, go } = useStore();
  const [moves, setMoves] = useState("1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7"); const [color, setColor] = useState("white"); const [human, setHuman] = useState("");
  const job = useJob();
  useEffect(() => { const h = takeHandoff(); if (h?.moves?.length) setMoves(GameTree.fromMoves(h.startFen, h.moves).sans().join(" ")); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const r = job.result;
  return (
    <div className="col gap-lg">
      <Panel title="How hard is this line for a human?">
        <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1.4fr auto", alignItems: "end" }}>
          <Field label="Line"><input type="text" value={moves} onChange={(e) => setMoves(e.target.value)} /></Field>
          <Field label="Colour"><ColorSelect value={color} onChange={setColor} /></Field>
          <Field label="Human games for “findability”" help="A games book with 20+ games per position; otherwise a heuristic."><BookSelect value={human} onChange={setHuman} books={books} none="none — use the heuristic" /></Field>
          <button className="btn primary" disabled={!engine || job.busy} onClick={() => job.run({ task: "practical", moves, my_color: color, engine, budget, human_book_id: human || undefined })}>Score it</button>
        </div>
        <JobBar job={job} />
      </Panel>
      {r && <>
        <Panel title={`Practical score ${pct(r.practical_score)}`} hint="50% = equally demanding for both sides">
          <Meter value={r.practical_score} kind={r.practical_score < 0.4 ? "bad" : ""} />
          <p style={{ marginTop: 8, fontSize: 15 }}>{r.summary}</p>
          <div className="grid g4"><div className="kpi"><b>{r.only_moves[r.my_color]}</b><span>Only-moves for you</span></div><div className="kpi"><b>{r.only_moves[r.my_color === "white" ? "black" : "white"]}</b><span>For the opponent</span></div>
            <div className="kpi"><b>{r.burden[r.my_color]}</b><span>Your burden</span></div><div className="kpi"><b>{pct(r.engine_expected_for_me)}</b><span>Engine expectation</span></div></div>
          <p className="help" style={{ marginTop: 6 }}>{r.note}</p>
        </Panel>
        <Panel title="Move by move">
          <table className="t"><thead><tr><th>#</th><th>Played</th><th>Engine's best</th><th>Eval</th><th>Gap to 2nd</th><th>Only move?</th><th>Findability</th><th /></tr></thead>
            <tbody>{r.rows.map((x: any) => <tr key={x.ply}><td>{Math.ceil(x.ply / 2)}{x.side === "white" ? "." : "…"}</td><td className="mono"><b>{x.san}</b>{!x.is_best && <span className="muted"> (#{x.played_rank ?? "4+"})</span>}</td>
              <td className="mono">{x.best_san}</td><td className="mono">{x.eval_white}</td><td>{Math.round(x.gap * 100)} pts</td><td>{x.only_move ? <span className="pill warn">only move</span> : ""}</td>
              <td title={x.findability_source}><div className="row nowrap"><div style={{ width: 60 }}><Meter value={x.findability} /></div><span className="muted">{x.findability_source === "heuristic" ? "est." : x.findability_source}</span></div></td>
              <td className="right"><button className="btn xs" onClick={() => go("analysis", { fen: x.fen })}>Look</button></td></tr>)}</tbody></table>
        </Panel></>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 5 · move orders
function Orders({ books }: P) {
  const { go, takeHandoff } = useStore();
  const [moves, setMoves] = useState("1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Nf3 Be7"); const [me, setMe] = useState("white"); const [freq, setFreq] = useState("");
  const [out, setOut] = useState<any>(null);
  useEffect(() => { const h = takeHandoff(); if (h?.moves?.length) setMoves(GameTree.fromMoves(h.startFen, h.moves).sans().join(" ")); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const row = (o: any, canon = false) => (
    <tr key={o.line} className={canon ? "sel" : ""}><td className="mono">{o.line}{canon && <span className="pill" style={{ marginLeft: 6 }}>main order</span>}</td>
      <td><div className="row nowrap"><div style={{ width: 70 }}><Meter value={o.stays_on_course} /></div><b>{(o.stays_on_course * 100).toFixed(1)}%</b></div></td>
      <td className="mono good-t">{o.dodges?.join(", ") || (canon ? "" : "–")}</td><td className="mono bad-t">{o.allows?.join(", ") || (canon ? "" : "–")}</td>
      <td>{o.opponent_out_of_book ? <span className="pill good">{o.opponent_out_of_book} ply out of their book</span> : ""}</td>
      <td className="right"><button className="btn xs" onClick={() => go("analysis", { moves: o.uci })}>Open</button></td></tr>);
  return (
    <div className="col gap-lg">
      <Panel title="Find the move order that leaves the opponent the fewest options">
        <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1.4fr auto", alignItems: "end" }}>
          <Field label="Line that reaches the position you want"><input type="text" value={moves} onChange={(e) => setMoves(e.target.value)} /></Field>
          <Field label="Colour"><ColorSelect value={me} onChange={setMe} /></Field>
          <Field label="Opponent's habits come from" help="Use an opponent's games book to trick them out of their own repertoire."><BookSelect value={freq} onChange={setFreq} books={books} none="built-in reference catalogue" /></Field>
          <button className="btn primary" onClick={async () => setOut(await act(() => api.post("/api/prep/move-orders", { moves, me, freq_book_id: freq })))}>Search</button>
        </div>
      </Panel>
      {out && <Panel title={out.opening || "Target position"} hint={`${out.found} other order(s)${out.search_complete ? "" : " — search cut short"}`}>
        <div className="row" style={{ alignItems: "flex-start", gap: 16 }}><MiniBoard fen={out.target_fen} size={190} orientation={me as any} />
          <div className="grow scroll"><table className="t"><thead><tr><th>Order</th><th>Stays on course</th><th>Dodges</th><th>Allows instead</th><th /><th /></tr></thead>
            <tbody>{row(out.canonical, true)}{out.orders.map((o: any) => row(o))}</tbody></table>
            {!out.orders.length && <div className="muted">These moves can only be played in this order.</div>}</div></div>
        <p className="help" style={{ marginTop: 8 }}>{out.note}</p></Panel>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 6 · structures
function Structures({ books, repertoire }: P) {
  const { go } = useStore();
  const [book, setBook] = useState(""); const [color, setColor] = useState("white");
  const data = useApi<any>(book ? `/api/prep/structures?book_id=${book}&color=${color}` : null);
  const [sel, setSel] = useState<any>(null);
  const [games, setGames] = useState<any[]>([]);
  const [task, setTask] = useState<any>(null); const [fb, setFb] = useState<any>(null);
  const [guess, setGuess] = useState<any>(null);
  useEffect(() => { if (!book) { const b = books.find((x) => x.name.includes("Reference")) || books[0]; if (b) setBook(b.id); } }, [books]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSel(null); }, [book, color]);
  useEffect(() => { if (sel) api.get(`/api/prep/model-games?structure=${sel.id}`).then(setGames).catch(() => setGames([])); setTask(null); setFb(null); setGuess(null); }, [sel]);
  const quiz = async () => { setFb(null); setTask(await act(() => api.post("/api/prep/plan-task", { structure: sel?.id }))); };
  if (guess) return <GuessTheMove game={guess} onExit={() => setGuess(null)} />;
  return (
    <div className="side-list">
      <div className="col">
        <Panel title="My repertoire by structure" tight>
          <div className="col"><BookSelect value={book} onChange={setBook} books={books} filter={repertoire} /><ColorSelect value={color} onChange={setColor} /></div>
          <div style={{ marginTop: 8 }}>{[...(data.data?.structures || [])].sort((x: any, y: any) => Number(x.id === "other") - Number(y.id === "other")).map((s: any) => (
            <div key={s.id} className={`tree-node ${sel?.id === s.id ? "sel" : ""}`} onClick={() => setSel(s)}><span className="grow">{s.name}</span><span className="pill">{s.count}</span></div>))}</div>
        </Panel>
      </div>
      {!sel ? <div className="empty">Choose a structure. Openings are learned by their middlegames: the same plans return whenever the pawns stand the same way.</div> : (
        <div className="col gap-lg">
          <Panel title={sel.name} hint={`${sel.count} of your lines`}>
            <div className="row" style={{ alignItems: "flex-start", gap: 16 }}><MiniBoard fen={sel.lines[0].fen} size={200} />
              <div className="grid g2 grow"><div><div className="label">Plans for White</div><ul style={{ margin: "4px 0", paddingLeft: 18 }}>{sel.white.map((p: string) => <li key={p}>{p}</li>)}</ul></div>
                <div><div className="label">Plans for Black</div><ul style={{ margin: "4px 0", paddingLeft: 18 }}>{sel.black.map((p: string) => <li key={p}>{p}</li>)}</ul></div>
                <div style={{ gridColumn: "1 / 3" }}><div className="label">Your lines that reach it</div>{sel.lines.map((l: any) => <div key={l.line} className="mono" style={{ fontSize: 12.5, cursor: "pointer" }} onClick={() => go("analysis", { fen: l.fen })}>{l.line}</div>)}</div></div></div>
          </Panel>
          <Panel title="Guess the plan" actions={<button className="btn sm primary" onClick={quiz}>{task ? "Another position" : "Start"}</button>}>
            {task ? <div className="row" style={{ alignItems: "flex-start", gap: 16 }}><MiniBoard fen={task.fen} size={200} />
              <div className="col grow"><p style={{ fontSize: 15 }}>{task.prompt}</p><span className="muted">From: {task.origin}</span>
                {!fb ? task.options.map((o: string) => <button key={o} className="btn" style={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }}
                  onClick={async () => setFb(await act(() => api.post("/api/training/check", { task_id: task.id, response: { value: o } })))}>{o}</button>)
                  : <div className={`note ${fb.correct ? "good" : "bad"}`}><b>{fb.correct ? "Correct." : `Not quite — ${fb.answer}.`}</b> {fb.explain}</div>}</div></div>
              : <span className="muted">A position with this structure and four plans — pick the one that belongs.</span>}
          </Panel>
          <Panel title="Model games" hint="decisive games in your database with this structure at move 12">
            {games.length ? <table className="t"><tbody>{games.map((g) => <tr key={g.id}><td>{g.white} – {g.black}</td><td className="mono">{g.result}</td><td className="muted">{g.opening}</td><td>{Math.ceil(g.plies / 2)} moves</td>
              <td className="right nowrap"><button className="btn xs" onClick={async () => { const full = await act(() => api.get(`/api/games/${g.id}`)); if (full) setGuess({ ...g, tree: full.tree }); }}>Guess the moves</button>{" "}
                <button className="btn xs" onClick={async () => { const full = await act(() => api.get(`/api/games/${g.id}`)); if (full) go("analysis", { pgn: full.pgn }); }}>Open</button></td></tr>)}</tbody></table>
              : <span className="muted">No model games yet. Import a collection of master games (Studies → Import PGN → “Only store the games”, or an opponent/own collection here) and they will appear by structure.</span>}
          </Panel>
        </div>)}
    </div>
  );
}

/** Solitaire chess on a model game: play the winner's moves from the structure position onward. */
function GuessTheMove({ game, onExit }: { game: any; onExit: () => void }) {
  const line: any[] = []; let n = game.tree.root; while (n.children[0]) { n = n.children[0]; line.push(n); }
  const winnerWhite = game.result === "1-0";
  const [i, setI] = useState(Math.max(0, game.ply)); const [score, setScore] = useState({ hit: 0, miss: 0 }); const [msg, setMsg] = useState("");
  const fen = i === 0 ? game.tree.root.fen : line[i - 1].fen;
  const whiteToMove = fen.split(" ")[1] === "w";
  const done = i >= line.length || i >= game.ply + 40;
  useEffect(() => { if (!done && whiteToMove !== winnerWhite) { const t = setTimeout(() => setI((x) => x + 1), 500); return () => clearTimeout(t); } }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (done) api.post("/api/training/log", { mode: "play_from_position", correct: score.hit >= score.miss, detail: { game: game.id, ...score } }).catch(() => undefined); }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="split"><div><Board fen={fen} orientation={winnerWhite ? "white" : "black"} movable={done || whiteToMove !== winnerWhite ? "none" : winnerWhite ? "white" : "black"} lastMove={i ? line[i - 1].uci : null}
      onMove={(u) => { const ok = line[i].uci === u || line[i].uci.slice(0, 4) === u.slice(0, 4); setScore((s) => ({ hit: s.hit + (ok ? 1 : 0), miss: s.miss + (ok ? 0 : 1) })); setMsg(ok ? `Yes — ${line[i].san}.` : `The game went ${line[i].san}.`); setI(i + 1); }} /></div>
      <Panel title={`${game.white} – ${game.black}`} hint={game.opening} actions={<button className="btn sm" onClick={onExit}>Back</button>}>
        <p style={{ fontSize: 15 }}>{done ? "Finished." : `You are ${winnerWhite ? "White" : "Black"} — the side that won. Play the moves you would choose.`}</p>
        <div className="row"><span className="pill good">{score.hit} matched</span><span className="pill bad">{score.miss} different</span></div>
        {msg && <div className="note" style={{ marginTop: 8 }}>{msg}</div>}
        <p className="help" style={{ marginTop: 8 }}>A different move is not necessarily worse than the game move — check it on the analysis board afterwards.</p>
      </Panel></div>
  );
}

// ---------------------------------------------------------------------------------------------- 7 · prep file
function PrepFile({ books, engine, budget, repertoire }: P) {
  const { go } = useStore();
  const events = useApi<any[]>("/api/prep/events"); const ov = useApi<any>("/api/training/overview"); const alerts = useApi<any[]>("/api/prep/alerts");
  const [name, setName] = useState(""); const [date, setDate] = useState(""); const [decks, setDecks] = useState<string[]>([]);
  const [book, setBook] = useState(""); const [color, setColor] = useState("white");
  const job = useJob();
  const flagged = (alerts.data || []).filter((a) => a.alert);
  return (
    <div className="grid g2">
      <Panel title="Events" hint="lines marked critical are reviewed more often as the date approaches">
        {(events.data || []).map((e) => (
          <div key={e.id} className="panel tight" style={{ marginBottom: 8, opacity: e.past ? 0.55 : 1 }}>
            <div className="row nowrap"><b className="grow">{e.name}</b><span className={`pill ${e.past ? "" : e.days_left < 7 ? "warn" : "brass"}`}>{e.past ? "past" : `${Math.ceil(e.days_left)} day(s) left`}</span>
              <button className="btn xs ghost" onClick={() => act(async () => { await api.del(`/api/prep/events/${e.id}`); events.reload(); })}>✕</button></div>
            {e.readiness != null && <><Meter value={e.readiness} /><div className="help">{pct(e.readiness)} of {e.decks_status.reduce((a: number, d: any) => a + d.cards, 0)} positions solid · {e.decks_status.reduce((a: number, d: any) => a + d.due, 0)} due now
              {e.interval_cap_days != null && ` · reviews at most ${e.interval_cap_days} day(s) apart`}</div></>}
          </div>))}
        {!events.data?.length && <div className="muted">No events yet.</div>}
        <div className="label" style={{ marginTop: 10 }}>New event</div>
        <div className="row nowrap"><input type="text" placeholder="e.g. Club championship, round 3" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ background: "var(--bg-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 8, padding: "6px 8px" }} /></div>
        <div className="col" style={{ margin: "8px 0" }}>{(ov.data?.decks || []).map((d: any) => <Check key={d.deck} checked={decks.includes(d.deck)} onChange={(v) => setDecks(v ? [...decks, d.deck] : decks.filter((x) => x !== d.deck))} label={`${d.title} (${d.n})`} />)}
          {!ov.data?.decks?.length && <span className="muted">Build training decks first (Training → Today).</span>}</div>
        <button className="btn primary sm" disabled={!date || !decks.length} onClick={() => act(async () => { await api.post("/api/prep/events", { name, date: new Date(date + "T12:00:00").getTime() / 1000, decks }); setName(""); setDecks([]); events.reload(); }, "Event saved")}>Save event</button>
        <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => go("training")}>Go to training</button>
      </Panel>
      <Panel title="Refutation watch" hint="re-verify your repertoire and be told when an evaluation moves">
        <div className="row nowrap"><BookSelect value={book} onChange={setBook} books={books} none="choose a repertoire…" filter={repertoire} /><ColorSelect value={color} onChange={setColor} />
          <button className="btn primary sm" disabled={!book || !engine || job.busy} onClick={async () => { const r = await job.run({ task: "watch", book_id: book, color, engine, budget }); if (r) useStore.getState().toast(`${r.checked} move(s) checked, ${r.alerts} alert(s)`, r.alerts ? "info" : "ok"); alerts.reload(); }}>Check now</button></div>
        <JobBar job={job} />
        <p className="help">The first check records a baseline. Run it again after registering a stronger engine or raising the budget; a move whose expected score shifts by five points or more is flagged.</p>
        {flagged.map((a) => <div key={a.id} className="note warn" style={{ marginTop: 6 }}><b className="mono">{a.line} {a.san}</b> {a.alert}.
          <div className="row" style={{ marginTop: 4 }}><button className="btn xs" onClick={() => go("analysis", { fen: a.fen })}>Look</button><button className="btn xs" onClick={() => go("discovery", { fen: a.fen })}>Find a replacement</button>
            <button className="btn xs" onClick={() => act(async () => { await api.post(`/api/prep/alerts/${a.id}/accept`); alerts.reload(); })}>Accept as the new baseline</button></div></div>)}
        {alerts.data && !flagged.length && <div className="muted" style={{ marginTop: 6 }}>{alerts.data.length ? `${alerts.data.length} move(s) under watch — no alerts.` : "Nothing is being watched yet."}</div>}
        {alerts.data && alerts.data.length > 0 && <div className="scroll" style={{ maxHeight: 220, marginTop: 8 }}><table className="t"><thead><tr><th>Move</th><th>Baseline</th><th>Latest</th><th>Checks</th></tr></thead>
          <tbody>{alerts.data.map((a) => <tr key={a.id}><td className="mono">{a.line} <b>{a.san}</b></td><td className="mono">{a.baseline.score.text} <span className="muted">d{a.baseline.depth}</span></td>
            <td className="mono">{a.latest.score.text} <span className="muted">d{a.latest.depth} · {a.latest.engine}</span></td><td>{a.history.length}</td></tr>)}</tbody></table></div>}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 8 · goal repertoires
function Goal({ books, engine, budget, reloadBooks, repertoire }: P) {
  const { go } = useStore();
  const [book, setBook] = useState(""); const [color, setColor] = useState("white"); const [out, setOut] = useState<any>(null);
  const job = useJob();
  const build = async (goal: string) => { const r = await act(() => api.post("/api/prep/goal-book", { book_id: book, color, goal }), goal === "draw" ? "Drawing repertoire built" : "Must-win repertoire built"); if (r) { setOut(r); reloadBooks(); } };
  return (
    <div className="grid g2">
      <Panel title="Build a repertoire for the result you need">
        <div className="col">
          <div className="grid g2"><Field label="Source repertoire"><BookSelect value={book} onChange={setBook} books={books} none="choose…" filter={repertoire} /></Field><Field label="Colour"><ColorSelect value={color} onChange={setColor} /></Field></div>
          <div className="note">For each of your moves the app looks at the stored evidence: the engine's win/draw/loss estimate if the book was annotated, otherwise results from games, otherwise the evaluation.
            A <b>drawing weapon</b> picks the highest draw rate among sound moves; a <b>must-win</b> repertoire picks the highest win rate that does not fall below a soundness floor.</div>
          <div className="row"><button className="btn" disabled={!book || !engine || job.busy} onClick={async () => { const r = await job.run({ task: "annotate", book_id: book, color, engine, budget }); if (r) { useStore.getState().toast(`${r.annotated} move(s) annotated${r.with_wdl ? " with win/draw/loss" : ""}`, "ok"); reloadBooks(); } }}>1 · Annotate with engine</button>
            <button className="btn primary" disabled={!book} onClick={() => build("draw")}>2 · Drawing weapon</button><button className="btn primary" disabled={!book} onClick={() => build("win")}>2 · Must-win</button></div>
          <JobBar job={job} />
          {job.result?.note && <div className="help">{job.result.note}</div>}
        </div>
      </Panel>
      <Panel title="Result">
        {out ? <div className="col"><b style={{ fontFamily: "var(--serif)", fontSize: 16 }}>{out.book.name}</b>
          <div>{out.evidence.choices} choices: {out.evidence.engine_wdl} from engine win/draw/loss · {out.evidence.results} from game results · {out.evidence.evaluation} from evaluation · {out.evidence.fallback} without data</div>
          {out.warning && <div className="note warn">{out.warning}</div>}
          <div className="row"><button className="btn" onClick={() => go("books")}>Open in the Book Forge</button>
            <button className="btn" onClick={() => act(async () => { await api.post("/api/training/decks", { book_id: out.book.id, color }); go("training"); }, "Deck built")}>Drill it</button></div>
          <p className="help">Every chosen move carries a note such as “[draw] draw 61% · win 22% (results)”, so you can see why it was picked.</p></div>
          : <span className="muted">The new repertoire is saved as its own book; the source is not changed.</span>}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 9 · drills
function Drills({ books, engine, repertoire }: P) {
  const [mode, setMode] = useState<null | "blind" | "survive">(null);
  const [book, setBook] = useState(""); const [color, setColor] = useState("white");
  const [data, setData] = useState<any>(null);
  useEffect(() => { if (!book) { const b = books.find((x) => x.name.includes("Reference")) || books[0]; if (b) setBook(b.id); } }, [books]); // eslint-disable-line react-hooks/exhaustive-deps
  if (mode === "blind" && data) return <Blindfold line={data} onExit={() => { setMode(null); setData(null); }} onAgain={async () => setData(await act(() => api.post("/api/prep/recital", { book_id: book, color })))} />;
  if (mode === "survive" && data) return <Survival start={data} engine={engine} onExit={() => { setMode(null); setData(null); }} />;
  return (
    <div className="col gap-lg">
      <Panel title="Material" tight><div className="row"><div style={{ width: 280 }}><BookSelect value={book} onChange={setBook} books={books} filter={repertoire} /></div><div style={{ width: 160 }}><ColorSelect value={color} onChange={setColor} /></div></div></Panel>
      <div className="grid g2">
        <button className="card" disabled={!book} onClick={async () => { const d = await act(() => api.post("/api/prep/recital", { book_id: book, color })); if (d) { setData(d); setMode("blind"); } }}>
          <b>Blindfold recital</b><small>The board is hidden. The opponent's moves are announced; you supply yours from memory — typed, or played on your Chessnut board with the screen out of sight.</small></button>
        <button className="card" disabled={!book || !engine} onClick={async () => { const d = await act(() => api.post("/api/prep/survival", { book_id: book, color })); if (d) { setData(d); setMode("survive"); } }}>
          <b>Out-of-book survival</b><small>You start where your preparation ends and the engine leaves the main road. Hold the position for ten moves; you are scored on the evaluation you keep.</small></button>
      </div>
    </div>
  );
}

function Blindfold({ line, onExit, onAgain }: { line: any; onExit: () => void; onAgain: () => void }) {
  const { hw } = useStore();
  const [i, setI] = useState(0); const [text, setText] = useState(""); const [miss, setMiss] = useState(0); const [msg, setMsg] = useState(""); const [peek, setPeek] = useState(false);
  const fens = { current: useMemo(() => { let f: string = line.start_fen || START_FEN; const out = [f]; for (const u of line.uci) { f = tryMove(f, u)!.fen; out.push(f); } return out; }, [line]) };
  const myTurn = (k: number) => (fens.current[Math.min(k, fens.current.length - 1)].split(" ")[1] === "w") === (line.color === "white");
  const done = i >= line.uci.length;
  useEffect(() => { setI(0); setMiss(0); setMsg(""); setText(""); }, [line]);
  useEffect(() => { if (!done && !myTurn(i)) { const t = setTimeout(() => setI((x) => x + 1), 900); return () => clearTimeout(t); } }, [i, line]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (done) api.post("/api/training/log", { mode: "recall", correct: miss === 0, detail: { drill: "blindfold", line: line.name, mistakes: miss } }).catch(() => undefined); }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = (uci: string | null) => {
    if (done || !myTurn(i)) return;
    if (uci && (uci === line.uci[i] || uci.slice(0, 4) === line.uci[i].slice(0, 4))) { setMsg(""); setText(""); setI(i + 1); }
    else { setMiss((m) => m + 1); setMsg(uci ? "That is not the repertoire move." : "Not a legal move here — write it like Nf3, exd5 or O-O."); }
  };
  const typed = () => { try { const c = new Chess(fens.current[i]); const m = c.move(text.trim()); submit(m ? m.from + m.to + (m.promotion || "") : null); } catch { submit(null); } };
  useLive(hw?.connected ? "hw" : null, (m) => {      // moves made on the physical board count too
    if (m.type !== "position" || done || !myTurn(i)) return;
    const c = new Chess(fens.current[i]);
    for (const mv of c.moves({ verbose: true })) { const r = tryMove(fens.current[i], mv.from + mv.to + (mv.promotion || "")); if (r && r.fen.split(" ")[0] === m.data.board_fen) { submit(r.uci); return; } }
  });
  const announced = line.sans.slice(0, i).map((s: string, k: number) => (k % 2 === 0 ? `${k / 2 + 1}.${s}` : s)).join(" ");
  return (
    <div className="split">
      <div>{peek ? <Board fen={fens.current[Math.min(i, fens.current.length - 1)]} orientation={line.color} tools={false} /> :
        <div className="board-wrap"><div className="board2d" style={{ display: "grid", placeItems: "center", background: "var(--panel-2)" }}><div className="center"><div style={{ fontFamily: "var(--serif)", fontSize: 26, color: "var(--brass-2)" }}>Blindfold</div><div className="muted">The board is hidden.</div></div></div></div>}
        <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onPointerDown={() => { setPeek(true); if (!done) setMiss((m) => m + 1); }} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)}>Hold to peek (counts as a miss)</button></div></div>
      <Panel title={line.name} hint={`you are ${line.color}`} actions={<button className="btn sm" onClick={onExit}>Finish</button>}>
        <p className="mono" style={{ fontSize: 15, minHeight: 44 }}>{announced || "…"}</p>
        {done ? <div className={`note ${miss ? "warn" : "good"}`}><b>{miss ? `Recited with ${miss} slip(s).` : "Recited without a slip."}</b>
          <div style={{ marginTop: 8 }}><button className="btn primary sm" onClick={onAgain}>Another line</button></div></div>
          : myTurn(i) ? <div className="row nowrap"><input type="text" autoFocus value={text} placeholder="your move, e.g. Nf3" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && typed()} />
            <button className="btn primary" onClick={typed}>Play</button><button className="btn ghost" onClick={() => { setMiss((m) => m + 1); setMsg(`It was ${line.sans[i]}.`); setI(i + 1); }}>I don't know</button></div>
            : <span className="muted">Opponent plays {line.sans[i]}…</span>}
        {msg && <div className="note bad" style={{ marginTop: 8 }}>{msg}</div>}
        <p className="help" style={{ marginTop: 10 }}>{hw?.connected ? `${hw.device.name} is connected: set up the start position and play your moves on it — they are read from the sensors.` : "Connect a Chessnut board to play the moves physically with the screen turned away."} Mistakes so far: {miss}.</p>
      </Panel>
    </div>
  );
}

function Survival({ start, engine, onExit }: { start: any; engine: any; onExit: () => void }) {
  const [st, setSt] = useState<any>(null); const [verdict, setVerdict] = useState<any>(null);
  const begun = useRef(false);
  useEffect(() => {
    if (begun.current) return; begun.current = true;
    act(() => api.post("/api/play", { engine, color: start.color, mode: "thematic", assistance: "training", clock: { kind: "unlimited" }, opening_moves: start.moves,
      strength: { mode: "time", movetime_ms: 700 }, sideline: { enabled: true, ranks: [2, 3], until_ply: start.moves.length + 4, max_loss: 0.1 } })).then((s) => s && setSt(s));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLive(st ? `play:${st.id}` : null, (m) => setSt(m.data));
  const mine = st ? st.sans.length - start.moves.length : 0;
  const myMoves = st ? Math.floor((mine + (st.human === (st.turn === "w" ? "white" : "black") ? 0 : 1)) / 2) : 0;
  const pts: number[] = st ? st.evals.filter((e: any) => e.expected_white != null).map((e: any) => (start.color === "white" ? e.expected_white : 1 - e.expected_white)) : [];
  useEffect(() => {
    if (!st || verdict || (myMoves < 10 && st.status !== "finished")) return;
    const first = pts[0] ?? 0.5, last = pts[pts.length - 1] ?? 0.5;
    const held = last >= first - 0.1 && !(st.status === "finished" && ((st.result === "1-0") !== (start.color === "white")) && st.result !== "1/2-1/2");
    setVerdict({ held, first, last });
    api.post("/api/training/log", { mode: "survival", correct: held, detail: { opening: start.opening, from: first, to: last, moves: myMoves } }).catch(() => undefined);
    if (st.status !== "finished") api.post(`/api/play/${st.id}/abort`).catch(() => undefined);
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return <div className="muted">Starting the engine…</div>;
  return (
    <div className="split">
      <div><Board fen={st.fen} orientation={start.color} movable={verdict ? "none" : st.human} lastMove={st.last_move} onMove={(u) => act(async () => setSt(await api.post(`/api/play/${st.id}/move`, { move: u })))} /></div>
      <Panel title={start.opening || "Out of book"} hint={`${Math.min(myMoves, 10)} / 10 moves`} actions={<button className="btn sm" onClick={() => { if (st.status !== "finished") api.post(`/api/play/${st.id}/abort`).catch(() => undefined); onExit(); }}>Finish</button>}>
        <p>Your book ended after <span className="mono">{start.sans.join(" ")}</span>. The engine now picks its second or third choice where that costs little. Keep the position.</p>
        <Meter value={Math.min(1, myMoves / 10)} kind="brass" />
        {pts.length > 1 && <div style={{ marginTop: 10 }}><EvalGraph points={pts} height={60} /><div className="help">Engine's estimate of your chances after each of its moves.</div></div>}
        <p className="mono muted" style={{ marginTop: 8 }}>{st.sans.slice(start.moves.length).join(" ")}</p>
        {verdict && <div className={`note ${verdict.held ? "good" : "bad"}`}><b>{verdict.held ? "Held." : "The position slipped."}</b> Your expected score went from {pct(verdict.first)} to {pct(verdict.last)} over {Math.min(myMoves, 10)} moves.
          {" "}{verdict.held ? "You found a sound plan without preparation." : "Look at where the graph drops and add that position to your book."}</div>}
        {st.thinking && !verdict && <span className="pill brass">engine is thinking…</span>}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 10 · endgames
function Endgames({ cols }: P) {
  const { go } = useStore();
  const [cid, setCid] = useState("");
  const data = useApi<any>(`/api/prep/endgames${cid ? `?collection_id=${cid}` : ""}`);
  const d = data.data;
  return (
    <div className="col gap-lg">
      <Panel title="Which endgames do my openings lead to?" actions={<div style={{ width: 300 }}><select value={cid} onChange={(e) => setCid(e.target.value)}><option value="">all stored games</option>{cols.map((c) => <option key={c.id} value={c.id}>{c.player} ({c.stats.games} games)</option>)}</select></div>}>
        {d ? <p>{d.reached_endgame} of {d.games} games reached an endgame. <span className="muted">{d.note}</span></p> : <span className="muted">{data.error || "Reading the games…"}</span>}
        {d && !d.reached_endgame && <div className="muted">No endgames found yet — import your games in “My leaks”, or play some here.</div>}
      </Panel>
      {d && d.reached_endgame > 0 && <div className="grid g2">
        <Panel title="By opening">
          <table className="t"><thead><tr><th>Opening</th><th>Endgame</th><th>Games</th><th>Score</th><th /></tr></thead><tbody>{d.by_opening.map((r: any, i: number) => (
            <tr key={i}><td>{r.opening}</td><td>{r.name}</td><td>{r.games}</td><td className={r.score != null && r.score < 0.45 ? "bad-t" : ""}>{pct(r.score)}</td>
              <td className="right"><button className="btn xs" onClick={() => go("play", { fen: r.examples[0].fen })}>Practise</button></td></tr>))}</tbody></table>
        </Panel>
        <Panel title="By endgame type" hint="practise the ones you score worst in">
          {d.by_type.map((t: any) => (
            <div key={t.type} className="panel tight" style={{ marginBottom: 8 }}>
              <div className="row nowrap"><b className="grow">{t.name}</b><span className="pill">{t.games} game(s)</span><span className={`pill ${t.score != null && t.score < 0.45 ? "bad" : "good"}`}>{pct(t.score)}</span></div>
              {t.tips.map((x: string) => <div key={x} className="help">• {x}</div>)}
              <div className="row" style={{ marginTop: 6 }}>{t.examples.map((e: any, k: number) => (
                <div key={k} style={{ cursor: "pointer" }} title={`${e.white} – ${e.black} ${e.result} · click to play this ending against an engine`} onClick={() => go("play", { fen: e.fen })}><MiniBoard fen={e.fen} size={92} orientation={e.player_color === "black" ? "black" : "white"} /></div>))}</div>
            </div>))}
        </Panel>
      </div>}
    </div>
  );
}
