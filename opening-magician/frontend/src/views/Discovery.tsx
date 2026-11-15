// Opening Discovery Laboratory: experiment builder, live pipeline, findings review and reports.
import { useEffect, useState } from "react";
import { api, useApi, useLive } from "../api";
import Board, { MiniBoard } from "../chess/Board";
import { START_FEN, tryMove } from "../chess/tree";
import { act, ago, title, useStore } from "../store";
import { BudgetEditor, Check, EnginePicker, Field, Meter, Modal, Num, Panel, Select, Tabs } from "../ui/ui";

const SCORE_LABEL: Record<string, string> = { objective_viability: "Objective viability", practical_difficulty: "Practical difficulty", novelty_in_database: "Novelty in this database",
  tactical_potential: "Tactical potential", strategic_coherence: "Strategic coherence", training_value: "Training value", research_confidence: "Research confidence" };
const STAGE_LABEL: Record<string, string> = { candidate_selection: "Candidate selection", initial_analysis: "Initial analysis", tournament_exploration: "Tournament exploration",
  critical_positions: "Critical positions", deep_verification: "Deep verification", candidate_comparison: "Candidate comparison", results_review: "Results review",
  book_proposal: "Book proposal", human_approval: "Human approval", follow_up: "Follow-up research" };

const blank = () => ({ name: "", goal: "", strategy: "second_best", color: "both", ranks: [2, 3, 4, 5], rank_weights: { 2: 4, 3: 3, 4: 2, 5: 1 } as Record<number, number>, ply_window: [0, 14], explore_depth: 1, max_candidates: 6,
  games_per_candidate: 2, extra_games: 2, adaptive_allocation: true, concurrency: 1, start: { moves: "" } as any, explorer_a: null as any, explorer_b: null as any, observer: null as any, validator: null as any,
  rank_budget: { min_time: 0.2, max_time: 1.5, min_depth: 4, max_depth: 16 }, game_budget: { min_time: 0.05, max_time: 0.4, min_depth: 2, max_depth: 12 },
  verify_budget: { min_time: 0.5, max_time: 5, min_depth: 8, max_depth: 26 }, filters: { max_expected_loss: 0.1, max_cp_loss: 150, min_expected: 0.25, exclude_mate_risk: true, min_complexity: 0 },
  explorer_policy: { mode: "best", rank: 2, until_ply: 14 }, reference_book_id: "", export_book_id: "", adjudication: { max_plies: 160 } });

export default function Discovery() {
  const { engines, meta, takeHandoff } = useStore();
  const list = useApi<any[]>("/api/experiments", { interval: 5000 });
  const [sel, setSel] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [cfg, setCfg] = useState(blank());
  useEffect(() => {
    const h = takeHandoff();
    if (h) { setCfg((c) => ({ ...c, start: h.openingId ? { opening_id: h.openingId } : h.moves?.length ? { moves: h.moves.join(" "), start_fen: h.startFen } : h.fen ? { fen: h.fen } : c.start })); setBuilding(true); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!engines.length) return;
    const spec = (e: any, o: any = {}) => ({ engine_id: e.id, options: o, profile_id: null });
    const strongest = engines.find((e) => e.kind === "native") || engines[0];
    const weak = engines[0];
    const skill = Object.keys(weak.options || {}).find((k) => k.toLowerCase() === "skill level");
    setCfg((c) => ({ ...c, explorer_a: c.explorer_a || spec(weak, skill ? { [skill]: 10 } : {}), explorer_b: c.explorer_b || spec(weak, skill ? { [skill]: 6 } : {}), observer: c.observer || spec(strongest) }));
  }, [engines]);
  useEffect(() => { if (!sel && !building && list.data?.length) setSel(list.data[0].id); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="view">
      <div className="view-head">
        <div><h1>Opening Discovery Lab</h1><div className="sub">Explorer engines try the moves a top engine would not choose; a stronger observer decides whether they survive.</div></div>
        <span className="spacer" /><button className="btn primary" onClick={() => { setBuilding(true); setSel(null); }}>New experiment</button>
      </div>
      <div className="side-list">
        <Panel title="Experiments" tight>
          {(list.data || []).map((e) => (
            <div key={e.id} className={`tree-node ${sel === e.id && !building ? "sel" : ""}`} style={{ whiteSpace: "normal", padding: "6px 8px" }} onClick={() => { setSel(e.id); setBuilding(false); }}>
              <div className="grow"><b>{e.name}</b><div className="muted" style={{ fontSize: 12 }}>{title(e.strategy)} · {e.findings} finding(s) · {ago(e.created_at)}</div></div>
              <span className={`pill ${e.status === "completed" ? "good" : e.status === "running" ? "brass" : e.status === "failed" ? "bad" : ""}`}>{e.status}</span>
            </div>))}
          {!list.data?.length && <div className="muted" style={{ padding: 8 }}>No experiments yet.</div>}
          <FindingsQueue onOpen={(eid) => { setSel(eid); setBuilding(false); }} />
        </Panel>
        {building ? <Builder cfg={cfg} setCfg={setCfg} strategies={meta?.strategies || {}} onCreated={(id) => { setBuilding(false); setSel(id); list.reload(); }} />
          : sel ? <Experiment key={sel} id={sel} onDeleted={() => { setSel(null); list.reload(); }} onFollowUp={(patch) => { setCfg((c) => ({ ...c, ...patch, start: patch.start || c.start })); setBuilding(true); }} />
          : <div className="empty">Create an experiment to start discovering.<br />Automated games run virtually at computer speed; a promising line can be shown on your Chessnut board afterwards.</div>}
      </div>
    </div>
  );
}

function FindingsQueue({ onOpen }: { onOpen: (eid: string) => void }) {
  const q = useApi<any[]>("/api/findings?status=promising", { interval: 8000 });
  const r = useApi<any[]>("/api/findings?status=repertoire_candidate", { interval: 8000 });
  const all = [...(r.data || []), ...(q.data || [])];
  if (!all.length) return null;
  return <><div className="label" style={{ margin: "12px 0 4px" }}>Review queue</div>
    {all.slice(0, 8).map((f) => <div key={f.id} className="tree-node" onClick={() => f.experiment_id && onOpen(f.experiment_id)}><span className="mono">{f.line_san}</span><span className="pill brass">{title(f.status)}</span></div>)}</>;
}

function Builder({ cfg, setCfg, strategies, onCreated }: { cfg: any; setCfg: (f: (c: any) => any) => void; strategies: Record<string, string>; onCreated: (id: string) => void }) {
  const books = useApi<any[]>("/api/books");
  const cat = useApi<any>("/api/openings");
  const [preview, setPreview] = useState<any | null>(null);
  const [startKind, setStartKind] = useState<"moves" | "opening" | "fen" | "book">(cfg.start.opening_id ? "opening" : cfg.start.fen ? "fen" : cfg.start.book_id ? "book" : "moves");
  const set = (p: any) => setCfg((c: any) => ({ ...c, ...p }));
  const fixed = ["second_best", "third_best", "fourth_best", "fifth_best", "deep_alternative"].includes(cfg.strategy);
  const payload = () => ({ ...cfg, reference_book_id: cfg.reference_book_id || null, export_book_id: cfg.export_book_id || null, validator: cfg.validator || null });
  useEffect(() => {
    const t = setTimeout(() => { if (cfg.explorer_a && cfg.observer) api.post("/api/experiments/preview", payload()).then(setPreview).catch((e) => setPreview({ error: e.message })); }, 400);
    return () => clearTimeout(t);
  }, [JSON.stringify(cfg.start), cfg.color, cfg.ply_window, cfg.explorer_a, cfg.observer]); // eslint-disable-line react-hooks/exhaustive-deps
  const seedFen = preview?.seeds?.[0]?.fen || START_FEN;
  return (
    <div className="col gap-lg">
      <Panel title="1 · Research goal and starting material">
        <div className="grid g2">
          <div className="col">
            <Field label="Experiment name"><input type="text" value={cfg.name} placeholder="e.g. Viable uncommon replies to 1.d4" onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Start from">
              <Select value={startKind} onChange={(v) => { setStartKind(v); set({ start: v === "moves" ? { moves: "" } : v === "fen" ? { fen: START_FEN } : v === "opening" ? { opening_id: cat.data?.openings?.[0]?.id } : { book_id: books.data?.[0]?.id, max_positions: 8 } }); }}
                options={[["moves", "A move sequence or PGN main line"], ["opening", "A catalogued opening"], ["fen", "A position (FEN)"], ["book", "Positions from an opening book"]]} />
            </Field>
            {startKind === "moves" && <Field label="Moves" help="SAN or UCI, e.g. 1.e4 c5 2.Nf3 d6. Leave empty for the starting position."><textarea rows={2} value={cfg.start.moves || ""} onChange={(e) => set({ start: { ...cfg.start, moves: e.target.value } })} /></Field>}
            {startKind === "fen" && <Field label="FEN"><input type="text" value={cfg.start.fen || ""} onChange={(e) => set({ start: { fen: e.target.value } })} /></Field>}
            {startKind === "opening" && <Field label="Opening"><select value={cfg.start.opening_id || ""} onChange={(e) => set({ start: { opening_id: e.target.value } })}>{(cat.data?.openings || []).map((o: any) => <option key={o.id} value={o.id}>{o.eco} {o.name}</option>)}</select></Field>}
            {startKind === "book" && <div className="grid g2"><Field label="Book"><select value={cfg.start.book_id || ""} onChange={(e) => set({ start: { ...cfg.start, book_id: e.target.value } })}>{(books.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              <Field label="Max positions"><Num value={cfg.start.max_positions || 8} min={1} max={40} onChange={(v) => set({ start: { ...cfg.start, max_positions: v } })} /></Field></div>}
            <div className="grid g2">
              <Field label="Explore alternatives for"><Select value={cfg.color} onChange={(v) => set({ color: v })} options={[["both", "Whoever is to move"], ["white", "White"], ["black", "Black"]]} /></Field>
              <Field label="Opening window (plies)" help="Alternative moves are only forced inside this range — never in the endgame."><div className="row nowrap"><Num value={cfg.ply_window[0]} min={0} onChange={(v) => set({ ply_window: [v, cfg.ply_window[1]] })} /><span className="muted">to</span><Num value={cfg.ply_window[1]} min={1} onChange={(v) => set({ ply_window: [cfg.ply_window[0], v] })} /></div></Field>
            </div>
          </div>
          <div className="col">
            <MiniBoard fen={seedFen} size={210} />
            {preview?.error ? <div className="note bad">{preview.error}</div> : <div className="help">{preview?.seeds?.length || 0} seed position(s){preview?.seeds?.[0] ? ` · first: ${preview.seeds[0].label} (${preview.seeds[0].line_san.join(" ") || "start"})` : ""}</div>}
          </div>
        </div>
      </Panel>
      <Panel title="2 · Discovery strategy">
        <div className="grid auto-fit">
          {Object.entries(strategies).map(([k, v]) => (
            <button key={k} className="card" style={cfg.strategy === k ? { borderColor: "var(--brass)", background: "color-mix(in srgb, var(--brass) 12%, var(--panel))" } : undefined} onClick={() => set({ strategy: k })}>
              <b>{v.split(" — ")[0]}</b><small>{v.split(" — ")[1]}</small></button>))}
        </div>
        <div className="grid g4" style={{ marginTop: 12 }}>
          {cfg.strategy === "mixed" && <Field label="Ranks and weights" help="Chance of each rank being sampled (seeded, reproducible).">
            <div className="col">{[2, 3, 4, 5, 6].map((r) => (
              <label key={r} className="row nowrap"><input type="checkbox" checked={cfg.ranks.includes(r)} onChange={(e) => set({ ranks: e.target.checked ? [...cfg.ranks, r].sort() : cfg.ranks.filter((x: number) => x !== r) })} />
                <span style={{ width: 54 }}>rank {r}</span><Num value={cfg.rank_weights[r] ?? 1} min={0} step={0.5} style={{ width: 70 }} onChange={(v) => set({ rank_weights: { ...cfg.rank_weights, [r]: v } })} /></label>))}</div></Field>}
          <Field label="Max candidates"><Num value={cfg.max_candidates} min={1} max={60} onChange={(v) => set({ max_candidates: v })} /></Field>
          <Field label="Exploration depth" help="1 = alternatives at the seed only; 2+ continues after the best reply."><Num value={cfg.explore_depth} min={1} max={5} onChange={(v) => set({ explore_depth: v })} /></Field>
          <Field label="Reference book" help="Needed for novelty, surprise, counter-repertoire, transposition and anti-preparation."><select value={cfg.reference_book_id} onChange={(e) => set({ reference_book_id: e.target.value })}><option value="">none</option>{(books.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Scheduler seed" help="Recorded with the results."><Num value={cfg.seed ?? 0} min={0} onChange={(v) => set({ seed: v || undefined })} /></Field>
        </div>
        {!fixed && !cfg.reference_book_id && ["novelty", "surprise", "counter_repertoire", "transposition", "anti_preparation"].includes(cfg.strategy) &&
          <div className="note warn" style={{ marginTop: 8 }}>This strategy compares moves with a reference book. Without one it has little to work with.</div>}
        <div className="label" style={{ marginTop: 12 }}>Viability filters</div>
        <div className="grid g4">
          <Field label="Max loss vs best (expected score)" help="0.10 = at most ten percentage points worse."><Num value={cfg.filters.max_expected_loss} min={0.005} max={0.6} step={0.01} onChange={(v) => set({ filters: { ...cfg.filters, max_expected_loss: v } })} /></Field>
          <Field label="Max loss (centipawns)"><Num value={cfg.filters.max_cp_loss} min={0} step={10} onChange={(v) => set({ filters: { ...cfg.filters, max_cp_loss: v } })} /></Field>
          <Field label="Minimum evaluation (expected)"><Num value={cfg.filters.min_expected} min={0} max={1} step={0.05} onChange={(v) => set({ filters: { ...cfg.filters, min_expected: v } })} /></Field>
          <Field label="Min tactical complexity"><Num value={cfg.filters.min_complexity} min={0} max={1} step={0.05} onChange={(v) => set({ filters: { ...cfg.filters, min_complexity: v } })} /></Field>
        </div>
        <Check checked={cfg.filters.exclude_mate_risk} onChange={(v) => set({ filters: { ...cfg.filters, exclude_mate_risk: v } })} label="Exclude moves that allow a forced mate" />
      </Panel>
      <Panel title="3 · Engines — explorers generate, the observer judges">
        <div className="grid g2">
          <EnginePicker label="Explorer A (candidate ranking + games)" value={cfg.explorer_a} onChange={(v) => set({ explorer_a: v })} />
          <EnginePicker label="Explorer B (opponent + reply probe)" value={cfg.explorer_b} onChange={(v) => set({ explorer_b: v })} />
          <EnginePicker label="Observer (stronger verifier)" value={cfg.observer} onChange={(v) => set({ observer: v })} />
          <EnginePicker label="Validator (optional second opinion)" value={cfg.validator} onChange={(v) => set({ validator: v })} allowNone />
          <BudgetEditor label="Candidate ranking budget" value={cfg.rank_budget} onChange={(v) => set({ rank_budget: v })} />
          <BudgetEditor label="Per-move budget in test games (no clock, no time forfeits)" value={cfg.game_budget} onChange={(v) => set({ game_budget: v })} />
          <BudgetEditor label="Verification budget" value={cfg.verify_budget} onChange={(v) => set({ verify_budget: v })} />
          <Field label="Explorer move policy in test games">
            <div className="row nowrap"><Select value={cfg.explorer_policy.mode} onChange={(v) => set({ explorer_policy: { ...cfg.explorer_policy, mode: v } })} options={[["best", "Play their own best move"], ["rank", "Keep forcing rank…"]]} />
              {cfg.explorer_policy.mode === "rank" && <><Num value={cfg.explorer_policy.rank} min={2} max={8} style={{ width: 64 }} onChange={(v) => set({ explorer_policy: { ...cfg.explorer_policy, rank: v } })} /><span className="muted nowrap">until ply</span>
                <Num value={cfg.explorer_policy.until_ply} min={2} style={{ width: 64 }} onChange={(v) => set({ explorer_policy: { ...cfg.explorer_policy, until_ply: v } })} /></>}</div></Field>
        </div>
        {cfg.observer && cfg.explorer_a && cfg.observer.engine_id === cfg.explorer_a.engine_id && !Object.keys(cfg.explorer_a.options || {}).length &&
          <div className="note warn" style={{ marginTop: 8 }}>The observer is the same engine at the same settings as an explorer. Verification is only meaningful when the observer is stronger — register a strong engine or weaken the explorers.</div>}
      </Panel>
      <Panel title="4 · Testing and output">
        <div className="grid g4">
          <Field label="Games per candidate" help="Played in mirrored pairs: both explorers try the idea."><Num value={cfg.games_per_candidate} min={0} max={40} onChange={(v) => set({ games_per_candidate: v })} /></Field>
          <Field label="Extra games (adaptive)" help="Spent on the most uncertain plausible candidates."><Num value={cfg.extra_games} min={0} max={100} onChange={(v) => set({ extra_games: v })} /></Field>
          <Field label="Games in parallel"><Num value={cfg.concurrency} min={1} max={8} onChange={(v) => set({ concurrency: v })} /></Field>
          <Field label="Proposals go to book"><select value={cfg.export_book_id} onChange={(e) => set({ export_book_id: e.target.value })}><option value="">none (research database only)</option>{(books.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <span className="help grow">Nothing is added to a book without your approval. Every finding stays traceable to its games and engine analysis.</span>
          <button className="btn primary big" disabled={!cfg.explorer_a || !cfg.observer || !!preview?.error} onClick={async () => { const r = await act(() => api.post("/api/experiments", payload()), "Experiment started"); if (r) onCreated(r.id); }}>Start experiment</button>
        </div>
      </Panel>
    </div>
  );
}

function ScoreBars({ scores }: { scores: any }) {
  return <div className="col" style={{ gap: 5 }}>{Object.entries(SCORE_LABEL).map(([k, l]) => scores?.[k] ? (
    <div key={k} title={scores[k].explanation}><div className="row nowrap" style={{ fontSize: 12 }}><span className="grow">{l}</span><b className="mono">{scores[k].value.toFixed(2)}</b></div>
      <Meter value={scores[k].value} kind={k === "research_confidence" ? "brass" : ""} /></div>) : null)}</div>;
}

function Experiment({ id, onDeleted, onFollowUp }: { id: string; onDeleted: () => void; onFollowUp: (patch: any) => void }) {
  const { go, toast } = useStore();
  const exp = useApi<any>(`/api/experiments/${id}`, { interval: 4000 });
  const books = useApi<any[]>("/api/books");
  const [tab, setTab] = useState<"findings" | "report" | "games" | "config">("findings");
  const [liveGame, setLiveGame] = useState<any | null>(null);
  const [open, setOpen] = useState<any | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  useLive(`experiment:${id}`, (m) => { if (m.type === "move") setLiveGame(m.data); else exp.reload(); });
  const e = exp.data;
  if (!e) return <div className="muted">{exp.error || "Loading…"}</div>;
  const run = (action: string, body?: any) => act(async () => { await api.post(`/api/experiments/${id}/${action}`, body); exp.reload(); });
  const running = e.job && ["running", "scheduled", "pending"].includes(e.job.status);
  const setStatus = (f: any, status: string) => act(async () => { await api.patch(`/api/findings/${f.id}`, { status }); exp.reload(); }, `Marked ${title(status)}`);
  return (
    <div className="col gap-lg">
      <Panel title={e.name} hint={`${title(e.config.strategy)} · ${ago(e.created_at)}`} actions={<div className="row">
        {running ? <button className="btn sm" onClick={() => run("pause")}>Pause</button> : e.status !== "completed" && <button className="btn sm primary" onClick={() => run("resume")}>{e.status === "pending" ? "Start" : "Resume"}</button>}
        {running && <button className="btn sm danger" onClick={() => run("cancel")}>Cancel</button>}
        <button className="btn sm ghost" onClick={() => confirm("Delete this experiment with its games and findings?") && act(async () => { await api.del(`/api/experiments/${id}`); onDeleted(); })}>Delete</button></div>}>
        <div className="flow">
          {(useStore.getState().meta?.stages || Object.keys(e.stages)).map((s: string, i: number) => (
            <div key={s} className={`node ${e.stages[s].status}`} onClick={() => setStage(s)} title="Click to inspect this stage's input and output">
              <span className="n">{i + 1}</span><b>{STAGE_LABEL[s]}</b><small>{e.stages[s].summary || e.stages[s].status}</small></div>))}
        </div>
        {e.job?.error && <div className="note bad" style={{ marginTop: 8 }}>{e.job.error}</div>}
        {running && liveGame && (
          <div className="row" style={{ marginTop: 12, alignItems: "flex-start" }}>
            <MiniBoard fen={liveGame.fen} lastMove={liveGame.uci} size={180} />
            <div><div className="label">Live test game</div><b>{liveGame.white}</b> <span className="muted">vs</span> <b>{liveGame.black}</b><div className="mono">{liveGame.line}</div>
              <div className="mono muted">… {liveGame.san} {liveGame.text || ""}</div><div className="help">No-flag research budgets: bounded search per move, no clock forfeits.</div></div>
          </div>)}
      </Panel>
      <Tabs value={tab} onChange={setTab} items={[["findings", `Findings (${e.findings.length})`], ["report", "Report"], ["games", `Games (${e.games.length})`], ["config", "Method"]]} />
      {tab === "findings" && (e.findings.length ? e.findings.map((f: any) => {
        const r = f.ranking, ev = f.evidence;
        const pts = (ev.games || []).map((g: any) => g.points).filter((x: any) => x != null);
        return (
          <Panel key={f.id} title={<span className="mono">{f.line_san}</span>} hint={ev.opening?.name}
            actions={<div className="row"><span className="pill">{title(f.category)}</span><span className={`pill ${["promising", "repertoire_candidate", "approved"].includes(f.status) ? "good" : f.status === "rejected" ? "bad" : "brass"}`}>{title(f.status)}</span></div>}>
            <div className="grid" style={{ gridTemplateColumns: "190px minmax(0,1fr) minmax(0,1fr)" }}>
              <div><MiniBoard fen={afterFen(f)} lastMove={f.move_uci} size={186} /></div>
              <div className="col">
                <div><span className="label">Ranking evidence</span>
                  <div>Ranked <b>#{r.original_rank}</b> by {r.ranking_engine} at depth {r.ranking_depth} <span className="mono muted">({r.original_score.text})</span></div>
                  {r.verification_rank != null ? <div>Verified <b>#{r.verification_rank}{r.verification_rank_exact ? "" : "+"}</b> by {r.verification_engine} at depth {r.verification_depth} <span className="mono muted">({r.verification_score.text})</span>
                    {r.rank_stability !== 0 && <span className="pill warn" style={{ marginLeft: 6 }}>rank moved {r.rank_stability > 0 ? "+" : ""}{r.rank_stability}</span>}</div> : <div className="muted">Not yet verified independently.</div>}
                  {r.evaluation_change && <div className="muted">Evaluation {r.evaluation_change.from} → {r.evaluation_change.to}</div>}
                  <div className="help">Method: {r.ranking_method}. {r.legal_moves} legal moves. Ranks are evidence at these depths, not permanent truths.</div></div>
                {ev.verification?.top && <div><span className="label">Verifier's top moves</span><div className="mono">{ev.verification.top.map((t: any) => `${t.rank}. ${t.san} ${t.score}`).join("   ")}</div></div>}
                {ev.replies?.lines && <div><span className="label">Opponent's best replies</span><div className="mono">{ev.replies.lines.map((l: any) => `${l.san} ${l.score.text}`).join("   ")}</div></div>}
                {ev.trap && <div className="note warn"><b>Trap:</b> the natural {ev.trap.tempting_san} (the weak engine's #{ev.trap.weak_rank}) loses {(ev.trap.loss * 100).toFixed(0)} points of expected score to <b>{ev.trap.punish_san}</b>
                  <span className="mono"> {ev.trap.punish_pv.slice(1, 5).join(" ")}</span>. Best defence: {ev.trap.best_defence}. It works only if the opponent errs.</div>}
                <div><span className="label">Test games</span> {pts.length ? <span>{pts.filter((p: number) => p === 1).length} wins · {pts.filter((p: number) => p === 0.5).length} draws · {pts.filter((p: number) => p === 0).length} losses <span className="muted">(far too few to prove anything)</span></span> : <span className="muted">none</span>}</div>
                {ev.critical?.length > 0 && <div><span className="label">Critical moments</span>{ev.critical.slice(0, 3).map((c: any, i: number) => <div key={i} className="muted">ply {c.ply}: {c.played_san} played, observer prefers {c.observer_best} ({c.kind.replace(/_/g, " ")})</div>)}</div>}
                {ev.category_reasons?.length > 0 && <div className="help">Why this category: {ev.category_reasons.join("; ")}.</div>}
              </div>
              <div className="col"><ScoreBars scores={f.scores} />
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn xs good" onClick={() => setStatus(f, "approved")}>Approve</button>
                  <button className="btn xs" onClick={() => setStatus(f, "revisit_later")}>Revisit later</button>
                  <button className="btn xs danger" onClick={() => setStatus(f, "rejected")}>Reject</button>
                  <button className="btn xs" onClick={() => setOpen(f)}>More…</button>
                </div>
              </div>
            </div>
          </Panel>);
      }) : <div className="empty">{running ? "Candidates will appear here as they are found." : "No findings. Loosen the viability filters or choose another strategy."}</div>)}
      {tab === "report" && (e.report ? <Report report={e.report} onFollowUp={onFollowUp} run={run} /> : <div className="empty">The report is written when the pipeline reaches “Results review”.</div>)}
      {tab === "games" && (
        <Panel title="Test games" actions={<button className="btn sm" onClick={() => run("mine_puzzles").then(() => toast("Puzzle mining queued", "ok"))}>Mine puzzles from these games</button>}>
          <table className="t"><thead><tr><th>White</th><th>Black</th><th>Result</th><th>End</th><th>Line</th><th>Plies</th><th /></tr></thead>
            <tbody>{e.games.map((g: any) => <tr key={g.id}><td>{g.white}</td><td>{g.black}</td><td className="mono">{g.result}</td><td className="muted">{title(g.termination)}</td><td className="mono">{g.opening}</td><td>{g.plies}</td>
              <td className="right"><button className="btn xs" onClick={async () => { const full = await act(() => api.get(`/api/games/${g.id}`)); if (full) go("analysis", { pgn: full.pgn }); }}>Open</button></td></tr>)}</tbody></table>
        </Panel>)}
      {tab === "config" && <Panel title="Method"><pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(e.config, null, 2)}</pre></Panel>}
      {stage && (
        <Modal title={STAGE_LABEL[stage]} onClose={() => setStage(null)} wide>
          <p><span className={`pill ${e.stages[stage].status === "completed" ? "good" : ""}`}>{e.stages[stage].status}</span> {e.stages[stage].summary}</p>
          <pre className="mono scroll" style={{ whiteSpace: "pre-wrap", maxHeight: "52vh", background: "var(--bg-2)", padding: 10, borderRadius: 8 }}>{JSON.stringify(e.stages[stage].output, null, 2)}</pre>
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={running} onClick={() => { run("rerun", { stage }); setStage(null); }}>Rerun from this stage</button></div>
        </Modal>)}
      {open && (
        <Modal title={open.line_san} onClose={() => setOpen(null)}>
          <div className="col">
            <button className="btn" onClick={() => act(async () => { await api.post(`/api/findings/${open.id}/to_study`); setOpen(null); go("studies"); }, "Study created")}>Create an annotated study</button>
            <button className="btn" onClick={() => act(async () => { const r = await api.post(`/api/findings/${open.id}/to_puzzles`); toast(r.created.length ? `${r.created.length} puzzle(s) created` : "No verified trap in this finding to make a puzzle from"); })}>Create puzzles from its trap</button>
            <button className="btn" onClick={() => act(() => api.post(`/api/findings/${open.id}/to_cards`), "Training deck created")}>Add the line to my training</button>
            <Field label="Propose for a book (pending until you approve it in the Book Forge)"><div className="row nowrap">
              <select id="propbook">{(books.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              <button className="btn" onClick={() => act(() => api.post(`/api/findings/${open.id}/propose`, { book_id: (document.getElementById("propbook") as HTMLSelectElement).value }), "Proposal added")}>Propose</button></div></Field>
            <button className="btn" onClick={() => go("analysis", { moves: [...open.evidence.seed.moves, open.move_uci], startFen: open.evidence.seed.start_fen })}>Open on the analysis board</button>
            <button className="btn" onClick={() => go("openings", { playbackMoves: [...open.evidence.seed.moves, open.move_uci], startFen: open.evidence.seed.start_fen, title: open.line_san })}>Show it on screen or on the Chessnut board</button>
            <button className="btn" onClick={() => { onFollowUp({ start: { moves: [...open.evidence.seed.moves, open.move_uci].join(" "), start_fen: open.evidence.seed.start_fen } }); setOpen(null); }}>Start a follow-up experiment from here</button>
          </div>
        </Modal>)}
    </div>
  );
}

function afterFen(f: any): string { return tryMove(f.fen, f.move_uci)?.fen || f.fen; }

function Report({ report, onFollowUp, run }: { report: any; onFollowUp: (p: any) => void; run: (a: string, b?: any) => Promise<any> }) {
  const sec = (t: string, items: any[], extra?: (x: any) => React.ReactNode) => items?.length ? (
    <Panel title={t}><table className="t"><thead><tr><th>Line</th><th>Category</th><th>Rank</th><th>Eval</th><th>Viability</th><th>Confidence</th><th>Games</th></tr></thead>
      <tbody>{items.map((x) => <tr key={x.id + t}><td className="mono">{x.line}{extra?.(x)}</td><td>{title(x.category)}</td><td>#{x.original_rank}{x.verification_rank ? ` → #${x.verification_rank}` : ""}</td><td className="mono">{x.evaluation}</td>
        <td>{x.scores.objective_viability?.toFixed(2) ?? "–"}</td><td>{x.scores.research_confidence?.toFixed(2) ?? "–"}</td><td>{x.games ? `${x.games.wins}/${x.games.draws}/${x.games.losses}` : "–"}</td></tr>)}</tbody></table></Panel>) : null;
  return (
    <div className="col gap-lg">
      <Panel title="Summary" actions={<button className="btn sm" onClick={() => run("to_study")}>Save as research study</button>}><p style={{ fontSize: 15 }}>{report.headline}</p>
        {report.caveats.map((c: string) => <div key={c} className="help">• {c}</div>)}</Panel>
      {sec("Most promising candidates", report.most_promising)}
      {sec("Strongest independent verification", report.strongest_verification)}
      {sec("Highest practical surprise potential", report.highest_surprise)}
      {sec("Most instructive traps", report.instructive_traps, (x) => <div className="help">trap: {x.trap.tempting_san}? {x.trap.punish_san}!</div>)}
      {sec("Refuted candidates", report.refuted)}
      {sec("Uncertain — needs more work", report.uncertain)}
      {report.next_experiments?.length > 0 && <Panel title="Suggested next experiments">{report.next_experiments.map((n: any, i: number) => (
        <div key={i} className="row" style={{ padding: "3px 0" }}><span className="grow">{n.text}</span>{n.config_patch && <button className="btn xs" onClick={() => onFollowUp(n.config_patch)}>Set up</button>}</div>))}</Panel>}
    </div>
  );
}
