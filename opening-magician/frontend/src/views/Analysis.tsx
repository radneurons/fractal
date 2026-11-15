// Analysis board: free move tree, several independent engines, ranked alternatives, tactical overlays.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, saveText, useApi, useLive } from "../api";
import Board, { Arrow, Shapes } from "../chess/Board";
import { boardInsight, GameTree, START_FEN, TNode, useTree } from "../chess/tree";
import { EvalBar, TreeMoves } from "../chess/widgets";
import { act, AnnotationPreset, fmtNum, title, useStore } from "../store";
import { BudgetEditor, Check, ContextMenu, EnginePicker, Field, MenuItem, Modal, Num, Panel, Tabs } from "../ui/ui";

const PANEL_COLORS = ["#2fa37c", "#5aa7e0", "#e0a23a", "#9b82e6", "#d2584f", "#55c7c0"];
type PanelDef = { id: string; engine: any; multipv: number; on: boolean };
let panelSeq = 1;

function EnginePanel({ def, color, fen, moves, rootFen, onLines, onClose, onPlay, onChange }: { def: PanelDef; color: string; fen: string; moves: string[]; rootFen: string;
  onLines: (id: string, lines: any[]) => void; onClose: () => void; onPlay: (ucis: string[]) => void; onChange: (d: PanelDef) => void }) {
  const [info, setInfo] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const opened = useRef(false);
  useLive(`analysis:${def.id}`, (m) => {
    if (m.type === "error") setErr(m.data.message);
    else if (m.data.fen === fen || !m.data.fen) { setInfo(m.data); onLines(def.id, m.data.lines || []); }
  });
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        if (!opened.current) { setStatus(await api.post(`/api/analysis/${def.id}/open`, { engine: def.engine })); opened.current = true; }
        if (dead) return;
        if (def.on) { setErr(null); await api.post(`/api/analysis/${def.id}/go`, { fen: rootFen, moves, multipv: def.multipv }); }
        else await api.post(`/api/analysis/${def.id}/stop`);
      } catch (e) { if (!dead) setErr((e as Error).message); }
    })();
    return () => { dead = true; };
  }, [fen, def.on, def.multipv]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { api.del(`/api/analysis/${def.id}`).catch(() => undefined); }, [def.id]);
  const lines: any[] = info?.fen === fen ? info.lines || [] : [];
  const top = lines[0];
  return (
    <div className="panel tight" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="row nowrap">
        <b className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status?.engine || "Starting…"}</b>
        {top && <span className="mono" style={{ fontSize: 16, color }}>{top.score_white.text}</span>}
        <button className={`btn xs ${def.on ? "on" : ""}`} onClick={() => onChange({ ...def, on: !def.on })}>{def.on ? "Stop" : "Go"}</button>
        <input type="number" title="Lines (MultiPV)" min={1} max={status?.max_multipv || 1} value={def.multipv} style={{ width: 52, padding: "2px 5px" }}
          onChange={(e) => onChange({ ...def, multipv: Math.max(1, Math.min(status?.max_multipv || 1, parseInt(e.target.value, 10) || 1)) })} />
        <button className="btn xs ghost" onClick={onClose} aria-label="Close engine">✕</button>
      </div>
      {err && <div className="note bad" style={{ marginTop: 6 }}>{err}</div>}
      {top && <div className="muted mono" style={{ fontSize: 11.5, margin: "4px 0" }}>
        depth {top.depth}{top.seldepth ? `/${top.seldepth}` : ""} · {fmtNum(top.nodes)} nodes · {fmtNum(top.nps)} n/s{top.hashfull != null ? ` · hash ${(top.hashfull / 10).toFixed(0)}%` : ""}
        {info?.elapsed != null ? ` · ${info.elapsed}s` : ""}{info?.running ? "" : " · stopped"}{top.score.wdl ? ` · W/D/L ${top.score.wdl.join("/")}` : ""}</div>}
      {lines.map((l) => (
        <div key={l.multipv} className="mono" style={{ fontSize: 12.5, padding: "2px 0", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          title="Click to play this line on the board" onClick={() => onPlay(l.pv.slice(0, 1))} onDoubleClick={() => onPlay(l.pv.slice(0, 8))}>
          <span className="pill" style={{ marginRight: 6 }}>{l.multipv}</span><b style={{ color }}>{l.score_white.mate != null ? l.score_white.text : l.score_white.text}</b>{" "}
          <span>{l.pv_san.slice(0, 10).join(" ")}</span>
        </div>))}
      {!lines.length && !err && <div className="muted" style={{ fontSize: 12.5 }}>{def.on ? "Searching…" : "Stopped. Press Go to analyse this position."}</div>}
      {status && status.max_multipv <= 1 && <div className="help">This engine does not offer MultiPV; ranked alternatives use restricted-root searches instead.</div>}
    </div>
  );
}

export default function Analysis() {
  const { engines, takeHandoff, go, prefs, setPrefs, toast } = useStore();
  const { tree, apply, replace, version } = useTree();
  const [flip, setFlip] = useState(false);
  const [panels, setPanels] = useState<PanelDef[]>([]);
  const [lines, setLines] = useState<Record<string, any[]>>({});
  const [shapes, setShapes] = useState<Record<number, Shapes>>({});
  const [overlays, setOverlays] = useState({ best: true, hanging: false, attacked: false, defended: false, king: false, outposts: false });
  const [side, setSide] = useState<"engines" | "alternatives" | "knowledge" | "annotate">("engines");
  const [io, setIo] = useState<null | "pgn" | "fen">(null);
  const [ioText, setIoText] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [rank, setRank] = useState<{ n: number; engine: any; budget: any; result: any | null; busy: boolean }>({ n: 5, engine: null, budget: { min_time: 0.3, max_time: 2.5, min_depth: 6, max_depth: 22 }, result: null, busy: false });
  const [newEngine, setNewEngine] = useState<any>(null);
  const cur = tree.current;
  const moves = useMemo(() => tree.moves(), [version, cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const know = useApi<any>(side === "knowledge" ? `/api/knowledge?fen=${encodeURIComponent(cur.fen)}` : null, { deps: [cur.fen] });
  const state = useApi<any>(null);
  const [opening, setOpening] = useState<any>(null);

  useEffect(() => {
    const h = takeHandoff();
    if (h?.pgn) loadPgn(h.pgn);
    else if (h?.moves) replace(GameTree.fromMoves(h.startFen, h.moves));
    else if (h?.fen) replace(new GameTree(h.fen));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (engines.length && !rank.engine) setRank((r) => ({ ...r, engine: { engine_id: engines[0].id, options: {}, profile_id: null } })); if (engines.length && !newEngine) setNewEngine({ engine_id: engines[engines.length - 1].id, options: {}, profile_id: null }); }, [engines]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => { api.post("/api/openings/identify", { moves, start_fen: tree.root.fen === START_FEN ? null : tree.root.fen }).then((r) => setOpening(r.opening)).catch(() => undefined); }, 250);
    return () => clearTimeout(t);
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      if (e.key === "ArrowLeft") apply((t) => t.back()); else if (e.key === "ArrowRight") apply((t) => t.forward());
      else if (e.key === "Home") apply((t) => t.start()); else if (e.key === "End") apply((t) => t.end());
      else if (e.key === "f") setFlip((f) => !f); else return;
      e.preventDefault();
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  void state;

  const loadPgn = async (pgn: string) => {
    const r = await act(() => api.post("/api/pgn/parse", { pgn }));
    if (r) { replace(GameTree.fromServer(r.first.root)); toast(r.count > 1 ? `Loaded game 1 of ${r.count}. Import all of them as a study from the Studies view.` : "PGN loaded", "ok"); }
  };
  const play = (ucis: string[]) => apply((t) => { for (const u of ucis) if (!t.play(u)) break; });
  const insight = useMemo(() => { try { return boardInsight(cur.fen); } catch { return null; } }, [cur.fen]);

  const arrows: Arrow[] = [];
  if (overlays.best) panels.forEach((p, pi) => (lines[p.id] || []).slice(0, 3).forEach((l, i) => {
    if (l.pv?.[0]) arrows.push({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), color: PANEL_COLORS[pi % PANEL_COLORS.length], width: [1.15, 0.8, 0.55][i], opacity: [0.9, 0.6, 0.45][i], label: i === 0 ? l.score_white.text : undefined });
  }));
  if (side === "alternatives" && rank.result) rank.result.candidates.forEach((c: any) => arrows.push({ from: c.move.slice(0, 2), to: c.move.slice(2, 4), color: c.rank === 1 ? "#2fa37c" : "#9b82e6", width: Math.max(0.45, 1.1 - c.rank * 0.13), label: `#${c.rank}`, dashed: c.rank > 1 }));
  const squares: Record<string, string> = {};
  if (insight && prefs.annotation.tactical) {
    if (overlays.attacked) insight.attacked.forEach((s) => (squares[s] = "#e0a23a"));
    if (overlays.defended) insight.defended.forEach((s) => (squares[s] = "#5aa7e0"));
    if (overlays.outposts) insight.outposts.forEach((s) => (squares[s] = "#9b82e6"));
    if (overlays.king) insight.kingZone.forEach((s) => (squares[s] = "#d2584f"));
    if (overlays.hanging) insight.hanging.forEach((s) => (squares[s] = "#ff3b2f"));
  }
  const firstTop = panels.map((p) => lines[p.id]?.[0]).find(Boolean);

  const sendMenu = (e: React.MouseEvent) => setMenu({ x: e.clientX, y: e.clientY, items: [
    { label: "Play against an engine from here", onClick: () => go("play", { fen: cur.fen }) },
    { label: "Explore alternatives in the Discovery Lab", onClick: () => go("discovery", { fen: cur.fen, moves, startFen: tree.root.fen }) },
    { label: "Assess this line as a gambit (last move is the offer)", onClick: () => go("gambit", { moves, startFen: tree.root.fen === START_FEN ? undefined : tree.root.fen }) },
    { label: "Create a puzzle from this position", onClick: () => act(async () => { const r = await api.post("/api/puzzles/from-position", { fen: cur.fen, engine: rank.engine, budget: rank.budget }); toast(r.created ? "Puzzle created" : r.reason, r.created ? "ok" : "info"); }) },
    { label: "Save this line as a study", onClick: () => act(async () => { await api.post("/api/studies", { pgn: tree.toPgn(), title: opening?.name || "Analysis" }); go("studies"); }) },
    { label: "Make training cards from this line", onClick: () => act(() => api.post("/api/training/decks", { title: opening?.name || "Analysis line", start_fen: tree.root.fen === START_FEN ? null : tree.root.fen, moves, color: tree.root.fen.split(" ")[1] === "b" ? "black" : "white" }), "Deck created") },
    "sep",
    { label: "Send this position to Chessnut", onClick: () => go("chessnut", { fen: cur.fen }) },
    { label: "Replay this line (playback)", onClick: () => go("openings", { playbackMoves: moves, startFen: tree.root.fen, title: opening?.name || "Analysis line" }) },
    { label: "Test this position in a tournament", onClick: () => go("tournaments", { fen: cur.fen, title: opening?.name }) },
  ] });
  const nodeMenu = (n: TNode, e: React.MouseEvent) => setMenu({ x: e.clientX, y: e.clientY, items: [
    { label: "Promote variation", onClick: () => apply((t) => t.promote(n)) },
    { label: "Delete from here", onClick: () => apply((t) => t.remove(n)) },
    { label: "Add / edit comment", onClick: () => { const c = prompt("Comment:", n.comment); if (c !== null) apply(() => { n.comment = c; }); } },
    "sep",
    ...([[1, "! good move"], [2, "? mistake"], [3, "!! brilliant"], [4, "?? blunder"], [5, "!? interesting"], [6, "?! dubious"]] as [number, string][]).map(([g, l]) => ({ label: l, onClick: () => apply(() => { n.nags = n.nags.includes(g) ? [] : [g]; }) })),
  ] });

  const an = prefs.annotation;
  const setAn = (p: Partial<AnnotationPreset>) => setPrefs({ annotation: { ...an, ...p } });
  return (
    <div className="view">
      <div className="split wideboard">
        <div className="col">
          <div className="row nowrap" style={{ alignItems: "stretch" }}>
            <EvalBar expected={firstTop?.score_white.expected} text={firstTop?.score_white.text} orientation={flip ? "black" : "white"} />
            <div className="grow"><Board fen={cur.fen} orientation={flip ? "black" : "white"} movable="both" onMove={(u) => play([u])} lastMove={cur.uci} arrows={arrows} squares={squares}
              drawable userShapes={shapes[cur.id] || { arrows: cur.arrows as any, squares: {} }} onUserShapes={(s) => { setShapes({ ...shapes, [cur.id]: s }); cur.arrows = s.arrows.map((a) => ({ from: a.from, to: a.to, color: a.color === "#d2584f" ? "red" : a.color === "#5aa7e0" ? "blue" : a.color === "#e0a23a" ? "yellow" : "green" })); }}
              onFlip={() => setFlip(!flip)} /></div>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => apply((t) => t.start())} title="Start (Home)">⏮</button>
            <button className="btn sm" onClick={() => apply((t) => t.back())} title="Back (←)">◀</button>
            <button className="btn sm" onClick={() => apply((t) => t.forward())} title="Forward (→)">▶</button>
            <button className="btn sm" onClick={() => apply((t) => t.end())} title="End">⏭</button>
            <span className="grow" />
            <button className="btn sm" onClick={() => { setIoText(""); setIo("pgn"); }}>Load PGN</button>
            <button className="btn sm" onClick={() => { setIoText(cur.fen); setIo("fen"); }}>FEN</button>
            <button className="btn sm" onClick={() => saveText(tree.toPgn(opening ? { Opening: opening.name, ECO: opening.eco } : {}), "analysis.pgn")}>Save PGN</button>
            <button className="btn sm" onClick={() => replace(new GameTree())}>New</button>
            <button className="btn sm primary" onClick={sendMenu}>Send to…</button>
          </div>
          <div className="help">Right-drag draws arrows, right-click marks squares (Shift red · Alt blue · Ctrl yellow). Keys: ← → Home End, F flips.</div>
        </div>
        <div className="col gap-lg">
          <Panel title={opening ? `${opening.eco} · ${opening.name}` : "Moves"} hint={insight ? `${insight.legalCount} legal move(s)${insight.inCheck ? " · check" : ""}` : ""}>
            <div style={{ maxHeight: 190, overflow: "auto" }}><TreeMoves tree={tree} onGoto={(n) => apply((t) => t.goto(n))} onContext={nodeMenu} /></div>
          </Panel>
          <Tabs value={side} onChange={setSide} items={[["engines", `Engines (${panels.length})`], ["alternatives", "Ranked alternatives"], ["knowledge", "Knowledge"], ["annotate", "Overlays"]]} />
          {side === "engines" && (
            <div className="col">
              {panels.map((p, i) => <EnginePanel key={p.id} def={p} color={PANEL_COLORS[i % PANEL_COLORS.length]} fen={cur.fen} rootFen={tree.root.fen} moves={moves}
                onLines={(id, l) => setLines((x) => ({ ...x, [id]: l }))} onPlay={play} onChange={(d) => setPanels(panels.map((x) => (x.id === d.id ? d : x)))}
                onClose={() => { setPanels(panels.filter((x) => x.id !== p.id)); setLines((x) => { const n = { ...x }; delete n[p.id]; return n; }); }} />)}
              <div className="row nowrap" style={{ alignItems: "flex-end" }}>
                <div className="grow"><EnginePicker value={newEngine} onChange={setNewEngine} label="Add an engine panel" /></div>
                <button className="btn primary" disabled={!newEngine} onClick={() => setPanels([...panels, { id: `p${Date.now().toString(36)}${panelSeq++}`, engine: newEngine, multipv: 3, on: true }])}>Add</button>
              </div>
              {!panels.length && <div className="empty">Add one or more engines. Each runs as its own process with its own lines; arrows are colour-coded per engine.</div>}
              {!engines.length && <div className="note warn">No engine is registered yet. <button className="btn xs" onClick={() => go("engines")}>Open Engines</button></div>}
            </div>)}
          {side === "alternatives" && (
            <Panel title="Second to Nth best" hint="evidence at the stated depth — not a permanent ranking">
              <div className="col">
                <div className="grid g2"><EnginePicker value={rank.engine} onChange={(engine) => setRank({ ...rank, engine })} label="Ranking engine" />
                  <Field label="How many candidates"><Num value={rank.n} min={1} max={20} onChange={(n) => setRank({ ...rank, n })} /></Field></div>
                <BudgetEditor label="Search budget" value={rank.budget} onChange={(budget) => setRank({ ...rank, budget })} />
                <div><button className="btn primary" disabled={!rank.engine || rank.busy} onClick={async () => {
                  setRank((r) => ({ ...r, busy: true }));
                  const result = await act(() => api.post("/api/analysis/ranked", { engine: rank.engine, fen: tree.root.fen, moves, n: rank.n, budget: rank.budget }));
                  setRank((r) => ({ ...r, busy: false, result: result || r.result }));
                }}>{rank.busy ? "Ranking…" : "Rank candidates"}</button></div>
                {rank.result && rank.result.fen === cur.fen && <>
                  <table className="t"><thead><tr><th>#</th><th>Move</th><th>Eval</th><th>Loss</th><th>Class</th><th>Line</th></tr></thead>
                    <tbody>{rank.result.candidates.map((c: any) => (
                      <tr key={c.move} className="click" onClick={() => play([c.move])}><td>{c.rank}</td><td className="mono"><b>{c.san}</b></td><td className="mono">{c.score.text}</td>
                        <td className="mono muted">{c.loss.cp_loss != null ? `${c.loss.cp_loss}cp` : c.loss.mate_involved ? "mate" : "–"}</td>
                        <td className={`cls-${c.classification?.label}`}>{title(c.classification?.label || "")}{c.classification?.provisional ? "?" : ""}{c.classification?.novelty_candidate ? " · N" : ""}</td>
                        <td className="mono muted" style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.pv_san.slice(1, 6).join(" ")}</td></tr>))}</tbody></table>
                  <p className="help">{rank.result.engine} · depth {rank.result.depth} · method: {rank.result.method} · stopped: {rank.result.stop_reason?.replace(/_/g, " ")} · {rank.result.available} of {rank.result.legal_count} legal moves ranked.
                    {rank.result.available < rank.result.requested ? " Fewer candidates exist than requested — none were invented." : ""}</p>
                </>}
              </div>
            </Panel>)}
          {side === "knowledge" && (
            <Panel title="What the project knows here" hint="openings · books · research · puzzles · studies">
              {know.data ? <div className="col">
                <div><span className="label">Opening lines through this position</span><div className="row">{know.data.openings_through.map((o: any) => <span key={o.id} className="pill">{o.eco} {o.name}</span>)}{!know.data.openings_through.length && <span className="muted">none in the catalogue</span>}</div></div>
                <div><span className="label">Books</span>{know.data.books.map((b: any) => <div key={b.book_id}>{b.name} <span className="muted">— {b.moves} move(s) stored here</span></div>)}{!know.data.books.length && <div className="muted">not in any book</div>}</div>
                <div><span className="label">Research findings</span>{know.data.findings.map((f: any) => <div key={f.id}><b className="mono">{f.san}</b> <span className="pill">{title(f.category)}</span> <span className="pill brass">{title(f.status)}</span> <span className="muted">{f.games} game(s)</span></div>)}{!know.data.findings.length && <div className="muted">no findings yet</div>}</div>
                <div><span className="label">Stored engine analysis</span>{know.data.analysis.map((a: any, i: number) => <div key={i} className="mono muted">{a.engine}: {a.best} {a.score} (depth {a.depth}, {a.multipv} lines)</div>)}{!know.data.analysis.length && <div className="muted">none cached</div>}</div>
                {know.data.puzzles.length > 0 && <div><span className="label">Puzzles</span>{know.data.puzzles.map((p: any) => <div key={p.id}>{p.title}</div>)}</div>}
                {know.data.cards.length > 0 && <div><span className="label">Training cards</span>{know.data.cards.map((c: any, i: number) => <div key={i} className="muted">{c.san} — {c.reps} review(s), {c.lapses} miss(es)</div>)}</div>}
                {know.data.recommended.map((r: string, i: number) => <div key={i} className="note">{r}</div>)}
              </div> : <span className="muted">{know.error || "Loading…"}</span>}
            </Panel>)}
          {side === "annotate" && (
            <Panel title="Overlays and annotation style">
              <div className="grid g2">
                <Check checked={overlays.best} onChange={(v) => setOverlays({ ...overlays, best: v })} label="Engine arrows" help="Best, second and third choice per engine." />
                <Check checked={overlays.hanging} onChange={(v) => setOverlays({ ...overlays, hanging: v })} label="Hanging pieces" help="Attacked and not defended." />
                <Check checked={overlays.attacked} onChange={(v) => setOverlays({ ...overlays, attacked: v })} label="Attacked pieces" help="Side to move, under attack." />
                <Check checked={overlays.defended} onChange={(v) => setOverlays({ ...overlays, defended: v })} label="Defended pieces" />
                <Check checked={overlays.king} onChange={(v) => setOverlays({ ...overlays, king: v })} label="King danger squares" help="Squares next to the king that the opponent controls." />
                <Check checked={overlays.outposts} onChange={(v) => setOverlays({ ...overlays, outposts: v })} label="Outposts" help="Pawn-protected squares no enemy pawn can attack." />
              </div>
              <div className="grid g3" style={{ marginTop: 12 }}>
                <Field label="Preset"><select value={an.name} onChange={(e) => { const p = prefs.annotationPresets.find((x) => x.name === e.target.value); if (p) setPrefs({ annotation: p }); }}>
                  {prefs.annotationPresets.map((p) => <option key={p.name}>{p.name}</option>)}{!prefs.annotationPresets.some((p) => p.name === an.name) && <option>{an.name}</option>}</select></Field>
                <Field label="Arrow colour"><input type="color" value={an.arrowColor} onChange={(e) => setAn({ arrowColor: e.target.value, name: "Custom" })} style={{ width: "100%", height: 34, padding: 2, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 8 }} /></Field>
                <Field label={`Thickness ${an.thickness.toFixed(1)}`}><input type="range" min={0.4} max={2} step={0.1} value={an.thickness} onChange={(e) => setAn({ thickness: +e.target.value, name: "Custom" })} /></Field>
                <Field label={`Opacity ${an.opacity.toFixed(2)}`}><input type="range" min={0.2} max={1} step={0.05} value={an.opacity} onChange={(e) => setAn({ opacity: +e.target.value, name: "Custom" })} /></Field>
                <Field label={`Highlight ${an.highlight.toFixed(2)}`}><input type="range" min={0.1} max={0.9} step={0.05} value={an.highlight} onChange={(e) => setAn({ highlight: +e.target.value, name: "Custom" })} /></Field>
                <div className="col"><Check checked={an.animate} onChange={(v) => setAn({ animate: v })} label="Animate arrows" /><Check checked={an.labels} onChange={(v) => setAn({ labels: v })} label="Show labels" />
                  <Check checked={an.tactical} onChange={(v) => setAn({ tactical: v })} label="Tactical highlights" /></div>
              </div>
              <div className="row" style={{ marginTop: 10 }}><button className="btn sm" onClick={() => { const name = prompt("Preset name:", "My preset"); if (name) setPrefs({ annotation: { ...an, name }, annotationPresets: [...prefs.annotationPresets.filter((p) => p.name !== name), { ...an, name }] }); }}>Save as preset</button>
                <button className="btn sm" onClick={() => setShapes({})}>Clear my drawings</button></div>
            </Panel>)}
        </div>
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {io && (
        <Modal title={io === "pgn" ? "Load PGN" : "Position (FEN)"} onClose={() => setIo(null)}>
          <textarea value={ioText} onChange={(e) => setIoText(e.target.value)} rows={io === "pgn" ? 12 : 2} placeholder={io === "pgn" ? "Paste a PGN — variations, comments and annotations are kept" : "FEN"} autoFocus />
          <div className="row" style={{ marginTop: 10 }}>
            {io === "pgn" && <label className="btn sm">Open file…<input type="file" accept=".pgn,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setIoText(await f.text()); }} /></label>}
            <span className="grow" />
            {io === "fen" && <button className="btn" onClick={() => navigator.clipboard?.writeText(cur.fen).then(() => toast("FEN copied", "ok"))}>Copy current</button>}
            <button className="btn primary" onClick={async () => {
              if (io === "pgn") await loadPgn(ioText);
              else { const r = await act(() => api.post("/api/chess/state", { fen: ioText.trim() })); if (!r) return; if (!r.valid) { toast("Not a legal chess position: " + r.status_flags.join(", "), "err"); return; } replace(new GameTree(r.fen)); }
              setIo(null);
            }}>Load</button>
          </div>
        </Modal>)}
    </div>
  );
}
