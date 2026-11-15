// Openings: catalogue, interactive tree explorer (several display modes), guided lessons and playback.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, useApi, useLive } from "../api";
import Board, { Arrow, MiniBoard } from "../chess/Board";
import { START_FEN } from "../chess/tree";
import { act, fmtScore, title, useStore } from "../store";
import { BudgetEditor, ContextMenu, EnginePicker, Field, MenuItem, Panel, Select, Tabs } from "../ui/ui";

type Mode = "tree" | "graph" | "outline" | "heatmap" | "ranking" | "evidence";
const STATUS_COLOR: Record<string, string> = { main: "#2fa37c", side: "#5aa7e0", candidate: "#e0a23a", approved: "#55c79e", rejected: "#d2584f", exploration: "#9b82e6" };

function TreeRows({ node, depth, sel, onPick, onHover, onMenu, open, toggle }: any) {
  return (
    <>
      {node.children.map((c: any) => {
        const isOpen = open.has(c.id);
        return (
          <div key={c.id}>
            <div className={`tree-node ${sel === c.id ? "sel" : ""}`} style={{ paddingLeft: 6 + depth * 15 }} onClick={() => onPick(c)} onMouseEnter={(e) => onHover(c, e)} onMouseLeave={() => onHover(null)}
              onContextMenu={(e) => { e.preventDefault(); onMenu(c, e); }}>
              <span className="tw" onClick={(e) => { e.stopPropagation(); toggle(c.id); }}>{c.children.length ? (isOpen ? "▾" : "▸") : c.truncated ? "…" : ""}</span>
              <b className="mono" style={{ color: STATUS_COLOR[c.status] }}>{c.san}</b>
              <span className="bar" style={{ width: Math.max(3, c.share * 60), background: STATUS_COLOR[c.status] }} title={`${(c.share * 100).toFixed(0)}% of the weight here`} />
              {c.games > 0 && <span className="muted" style={{ fontSize: 11 }}>{c.games}g {c.score != null ? `${(c.score * 100).toFixed(0)}%` : ""}</span>}
              {c.eval && <span className="mono muted" style={{ fontSize: 11 }}>{fmtScore(c.eval)}</span>}
              {c.transposition_of && <span className="pill sky" title={`Transposes to the line: ${c.transposition_of}`}>⇄</span>}
              {c.status !== "main" && c.status !== "side" && <span className="pill">{c.status}</span>}
              {c.comment && <span className="muted" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis" }}>{c.comment}</span>}
            </div>
            {isOpen && <TreeRows node={c} depth={depth + 1} sel={sel} onPick={onPick} onHover={onHover} onMenu={onMenu} open={open} toggle={toggle} />}
          </div>);
      })}
    </>
  );
}

/** Spatial graph: layered layout with transposition links, pan and zoom. */
function Graph({ root, sel, onPick, onMenu }: { root: any; sel: string; onPick: (n: any) => void; onMenu: (n: any, e: React.MouseEvent) => void }) {
  const [view, setView] = useState({ x: 20, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const { nodes, links, trans, height } = useMemo(() => {
    const nodes: any[] = [], links: any[] = [], trans: any[] = [];
    const pos = new Map<string, any>();
    let leaf = 0;
    const place = (n: any, depth: number): number => {
      let y: number;
      if (!n.children.length) y = leaf++ * 30;
      else { const ys = n.children.map((c: any) => place(c, depth + 1)); y = (ys[0] + ys[ys.length - 1]) / 2; }
      const p = { n, x: depth * 92, y };
      pos.set(n.id, p); nodes.push(p);
      return y;
    };
    place(root, 0);
    for (const p of nodes) for (const c of p.n.children) links.push([p, pos.get(c.id)]);
    for (const p of nodes) if (p.n.transposition_of && pos.get(p.n.transposition_of)) trans.push([p, pos.get(p.n.transposition_of)]);
    return { nodes, links, trans, height: Math.max(200, leaf * 30) };
  }, [root]);
  return (
    <svg style={{ width: "100%", height: "58vh", background: "var(--bg-2)", borderRadius: 10, cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
      onWheel={(e) => setView((v) => ({ ...v, k: Math.max(0.3, Math.min(2.5, v.k * (e.deltaY < 0 ? 1.12 : 0.89))) }))}
      onPointerDown={(e) => { drag.current = { x: e.clientX - view.x, y: e.clientY - view.y }; }} onPointerUp={() => { drag.current = null; }}
      onPointerMove={(e) => { if (drag.current) setView((v) => ({ ...v, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y })); }}>
      <g transform={`translate(${view.x}, ${view.y + 24 - Math.min(0, 0)}) scale(${view.k})`}>
        {links.map(([a, b], i) => <path key={i} d={`M${a.x + 30} ${a.y + 12} C${a.x + 62} ${a.y + 12}, ${b.x - 28} ${b.y + 12}, ${b.x} ${b.y + 12}`} fill="none" stroke="var(--line)" strokeWidth={1 + (b.n.share || 0) * 4} />)}
        {trans.map(([a, b], i) => <path key={"t" + i} d={`M${a.x + 30} ${a.y + 12} Q${(a.x + b.x) / 2 + 40} ${(a.y + b.y) / 2 - 30}, ${b.x + 30} ${b.y + 12}`} fill="none" stroke="#5aa7e0" strokeWidth="1.5" strokeDasharray="5 4" />)}
        {nodes.map((p) => (
          <g key={p.n.id} transform={`translate(${p.x}, ${p.y})`} style={{ cursor: "pointer" }} onClick={() => onPick(p.n)} onContextMenu={(e) => { e.preventDefault(); onMenu(p.n, e); }}>
            <rect width="60" height="24" rx="7" fill={sel === p.n.id ? "var(--brass)" : "var(--panel-2)"} stroke={STATUS_COLOR[p.n.status] || "var(--brass)"} strokeWidth={p.n.transposition_of ? 1 : 1.5} strokeDasharray={p.n.transposition_of ? "3 3" : undefined} />
            <text x="30" y="16" textAnchor="middle" fontSize="12" fontFamily="var(--mono)" fill={sel === p.n.id ? "#1a1408" : "var(--ink)"}>{p.n.san || "start"}</text>
          </g>))}
      </g>
      <text x="10" y={16} fontSize="11" fill="var(--ink-3)">drag to pan · wheel to zoom · dashed blue = transposition · {nodes.length} positions · {Math.round(height)}px</text>
    </svg>
  );
}

function Outline({ node, prefix, depth }: { node: any; prefix: string; depth: number }): JSX.Element {
  const [main, ...rest] = node.children;
  if (!main) return <></>;
  return (
    <>
      <span className="mono">{main.san} </span>
      {rest.map((r: any) => <div key={r.id} style={{ marginLeft: 14 + depth * 4, color: "var(--ink-2)" }}>↳ <span className="mono">{r.san} </span><Outline node={r} prefix="" depth={depth + 1} /></div>)}
      <Outline node={main} prefix={prefix} depth={depth} />
    </>
  );
}

export default function Openings() {
  const { go, takeHandoff, hw, engines, toast } = useStore();
  const cat = useApi<any>("/api/openings");
  const books = useApi<any[]>("/api/books");
  const [bookId, setBookId] = useState("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("tree");
  const [path, setPath] = useState<{ fen: string; uci: string; san: string }[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState("root");
  const [hover, setHover] = useState<{ fen: string; x: number; y: number; last?: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [lesson, setLesson] = useState<any | null>(null);
  const [step, setStep] = useState(0);
  const [flip, setFlip] = useState(false);
  const [pb, setPb] = useState<any | null>(null);
  const [compare, setCompare] = useState<{ fen: string; label: string } | null>(null);
  const [rank, setRank] = useState<any | null>(null);
  const [rankEngine, setRankEngine] = useState<any>(null);
  const [budget, setBudget] = useState({ min_time: 0.2, max_time: 1.5, min_depth: 6, max_depth: 18 });
  const fen = lesson ? (step ? lesson.steps[step - 1].fen : START_FEN) : pb ? pb.fen : path.length ? path[path.length - 1].fen : START_FEN;
  const tree = useApi<any>(bookId ? `/api/books/${bookId}/tree?depth=${mode === "graph" ? 6 : 9}&max_nodes=${mode === "graph" ? 260 : 1400}` : null);
  const here = useApi<any>(bookId ? `/api/books/${bookId}/position?fen=${encodeURIComponent(fen)}` : null, { deps: [fen] });
  const know = useApi<any>(mode === "evidence" ? `/api/knowledge?fen=${encodeURIComponent(fen)}` : null, { deps: [fen] });

  useEffect(() => { if (!bookId && books.data?.length) setBookId((books.data.find((b) => b.name.includes("Reference")) || books.data[0]).id); }, [books.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (engines.length && !rankEngine) setRankEngine({ engine_id: engines[0].id, options: {}, profile_id: null }); }, [engines]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = takeHandoff();
    if (h?.playbackMoves) startPlayback(h.playbackMoves, h.startFen || START_FEN, h.title || "Line");
    api.get("/api/hw").then((s) => { if (s.playback && s.playback.state !== "stopped") setPb(s.playback); }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLive("hw", (m) => { if (m.type === "playback") setPb(m.data.state === "stopped" ? null : m.data); });
  useEffect(() => { if (tree.data && open.size === 0) setOpen(new Set(tree.data.root.children.map((c: any) => c.id))); }, [tree.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickNode = (n: any) => {
    setLesson(null);
    setSel(n.id);
    const ucis: string[] = n.id === "root" ? [] : n.id.split(" ");
    // rebuild the path from the tree so SAN/FEN come from the bridge
    const out: any[] = []; let cur = tree.data?.root;
    for (const u of ucis) { cur = cur?.children.find((c: any) => c.uci === u); if (!cur) break; out.push({ fen: cur.fen, uci: cur.uci, san: cur.san }); }
    setPath(out);
    setOpen((o) => new Set([...o, n.id]));
  };
  const openLesson = async (id: string) => { const l = await act(() => api.get(`/api/openings/${id}`)); if (l) { setLesson(l); setStep(0); setPb(null); } };
  const startPlayback = async (moves: string[], startFen: string, t: string, annotations?: Record<number, string>) => {
    const mode0 = hw?.connected ? (hw.device.capabilities.robotic ? "robot" : "guided") : "digital";
    const p = await act(() => api.post("/api/hw/playback", { moves, start_fen: startFen, title: t, mode: "digital", speed_ms: 1500, annotations }));
    if (p) { setPb({ ...p, suggested: mode0 }); setLesson(null); }
  };
  const pbDo = (action: string, body?: any) => act(async () => setPb(await api.post(`/api/hw/playback/${action}`, body)));
  const lineMoves = () => (lesson ? lesson.opening.uci : path.map((p) => p.uci));
  const nodeMenu = (n: any, e: React.MouseEvent) => {
    const ucis: string[] = n.id === "root" ? [] : n.id.split(" ");
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: "Analyze", onClick: () => go("analysis", { moves: ucis }) },
      { label: "Add variation (open in analysis)", onClick: () => go("analysis", { moves: ucis }) },
      { label: "Create puzzle", onClick: () => act(async () => { const r = await api.post("/api/puzzles/from-position", { fen: n.fen, engine: rankEngine, budget }); toast(r.created ? "Puzzle created" : r.reason, r.created ? "ok" : "info"); }) },
      { label: "Play against engine", onClick: () => go("play", { moves: ucis }) },
      { label: "Bookmark as training cards", onClick: () => act(() => api.post("/api/training/decks", { title: `Line: ${ucis.length} plies`, moves: ucis, color: "white" }), "Deck created") },
      { label: "Add annotation", onClick: () => { const c = prompt("Comment for this move:", n.comment || ""); if (c !== null && n.uci) act(async () => { const parent = ucis.slice(0, -1); const pf = parent.length ? findNode(tree.data.root, parent.join(" "))?.fen : START_FEN; await api.post(`/api/books/${bookId}/move`, { fen: pf, move: n.uci, comment: c }); tree.reload(); }, "Annotation saved as a new book version"); } },
      "sep",
      { label: "Send to Chessnut", onClick: () => go("chessnut", { fen: n.fen }) },
      { label: "Replay this line", onClick: () => startPlayback(ucis, START_FEN, "Selected line") },
      { label: "Test in tournament", onClick: () => go("tournaments", { moves: ucis, title: "Opening test" }) },
      { label: "Explore alternatives", onClick: () => go("discovery", { moves: ucis }) },
      "sep",
      { label: "Mark approved", onClick: () => markStatus(n, ucis, "approved") },
      { label: "Reject", onClick: () => markStatus(n, ucis, "rejected") },
      { label: "Compare with current", onClick: () => setCompare({ fen: n.fen, label: ucis.length ? `${ucis.length} plies` : "start" }) },
    ] });
  };
  const findNode = (root: any, id: string): any => { if (root.id === id) return root; for (const c of root.children) { const r = findNode(c, id); if (r) return r; } return null; };
  const markStatus = (n: any, ucis: string[], status: string) => n.uci && act(async () => {
    const pf = ucis.length > 1 ? findNode(tree.data.root, ucis.slice(0, -1).join(" "))?.fen : START_FEN;
    await api.post(`/api/books/${bookId}/move`, { fen: pf, move: n.uci, status }); tree.reload(); here.reload();
  }, `Marked ${status} (new book version)`);

  const arrows: Arrow[] = [];
  const squares: Record<string, string> = {};
  if (lesson) {
    if (step > 0) lesson.steps[step - 1].arrows.forEach((a: any) => arrows.push({ from: a.from, to: a.to, color: "#2fa37c" }));
    if (step === lesson.steps.length) lesson.opening.key_squares.forEach((s: string) => (squares[s] = "#c9a45c"));
  } else if (mode === "ranking" && rank?.fen === fen) rank.candidates.forEach((c: any) => arrows.push({ from: c.move.slice(0, 2), to: c.move.slice(2, 4), color: c.rank === 1 ? "#2fa37c" : "#9b82e6", width: 1.1 - c.rank * 0.12, label: `#${c.rank}` }));
  else if (here.data && !pb) here.data.moves.slice(0, 6).forEach((m: any) => arrows.push({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), color: STATUS_COLOR[m.status] || "#2fa37c", width: 0.5 + m.share * 0.9, opacity: 0.35 + m.share * 0.6 }));
  if (mode === "heatmap" && here.data && !lesson) for (const m of here.data.moves) { const to = m.uci.slice(2, 4); squares[to] = `rgba(47,163,124,${Math.min(0.95, 0.25 + m.share)})`; }

  const filtered = (cat.data?.openings || []).filter((o: any) => !q || (o.name + " " + o.eco + " " + o.moves.join(" ")).toLowerCase().includes(q.toLowerCase()));
  const groups: Record<string, any[]> = {};
  filtered.forEach((o: any) => (groups[o.group] ||= []).push(o));
  const support = pb?.support;

  return (
    <div className="view">
      <div className="view-head"><div><h1>Openings</h1><div className="sub">Browse the tree, follow a guided lesson, then replay any line on screen or on your Chessnut board.</div></div>
        <span className="spacer" />
        <Field label="Book"><select value={bookId} onChange={(e) => { setBookId(e.target.value); setPath([]); setSel("root"); setOpen(new Set()); }} style={{ minWidth: 220 }}>{(books.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      </div>
      <div className="split">
        <div className="col">
          <Board fen={fen} orientation={flip ? "black" : "white"} lastMove={pb ? pb.last_move : lesson ? (step ? lesson.steps[step - 1].uci : null) : path.length ? path[path.length - 1].uci : null}
            arrows={arrows} squares={squares} onFlip={() => setFlip(!flip)} movable={lesson || pb ? "none" : "both"} leds={hw?.sim?.leds}
            onMove={(uci) => { const m = here.data?.moves.find((x: any) => x.uci === uci); const cur = sel === "root" ? "" : sel; const id = (cur ? cur + " " : "") + uci;
              if (m) { setPath([...path, { fen: m.fen_after, uci, san: m.san }]); setSel(id); setOpen((o) => new Set([...o, id])); } else toast("That move is not in this book. Use Analysis to explore it, or add it in the Book Forge."); }} />
          <div className="row">
            <span className="mono grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lesson ? lesson.opening.moves.slice(0, step).join(" ") : pb ? pb.sans.slice(0, pb.index).join(" ") : path.map((p) => p.san).join(" ") || "Starting position"}</span>
            {!lesson && !pb && <button className="btn sm" disabled={!path.length} onClick={() => { const p = path.slice(0, -1); setPath(p); setSel(p.map((x) => x.uci).join(" ") || "root"); }}>◀ Back</button>}
            {!lesson && !pb && <button className="btn sm" disabled={!path.length} onClick={() => startPlayback(lineMoves(), START_FEN, "Selected line")}>Replay line</button>}
          </div>
          {pb && (
            <Panel title={`Playback · ${pb.title || "line"}`} hint={`${pb.index}/${pb.total} · ${pb.state.replace(/_/g, " ")}`} tight>
              <div className="meter brass"><i style={{ width: `${pb.progress * 100}%` }} /></div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={() => pbDo("restart")} title="Restart">⏮</button>
                <button className="btn sm" onClick={() => pbDo("prev")} title="Previous move">◀</button>
                {pb.state === "playing" || pb.state === "waiting_board" ? <button className="btn sm on" onClick={() => pbDo("pause")}>Pause</button> : <button className="btn sm primary" onClick={() => pbDo("play")}>Play</button>}
                <button className="btn sm" onClick={() => pbDo("next")} title="Next move">▶</button>
                <button className="btn sm danger" onClick={() => pbDo("stop")}>Stop</button>
                <Field label="Speed"><Select value={String(pb.speed_ms)} onChange={(v) => pbDo("speed", { speed_ms: +v })} options={[["600", "fast"], ["1500", "normal"], ["3000", "slow"], ["6000", "study"]]} style={{ width: 100 }} /></Field>
                <Field label="Where"><Select value={pb.mode} onChange={(v) => pbDo("mode", { mode: v })} style={{ width: 150 }}
                  options={[["digital", "On screen"], ...(support?.guided ? [["guided", "Board: LEDs guide me"] as [string, string]] : []), ...(support?.robot ? [["robot", "Board: robot moves"] as [string, string]] : [])]} /></Field>
              </div>
              {pb.annotation && <div className="note" style={{ marginTop: 8 }}>{pb.annotation}</div>}
              {pb.detail && <div className={`note ${pb.state === "error" ? "bad" : "warn"}`} style={{ marginTop: 8 }}>{pb.detail}</div>}
              <p className="help" style={{ marginTop: 6 }}>Board sync: <b>{String(pb.sync).replace(/_/g, " ")}</b>{support?.reasons?.length ? ` · ${support.reasons.join(" · ")}` : ""}
                {pb.mode === "robot" ? " · each position is sent as one target and verified before the next." : ""}</p>
            </Panel>)}
          {compare && (
            <Panel title="Branch comparison" actions={<button className="btn xs" onClick={() => setCompare(null)}>Close</button>} tight>
              <CompareView a={{ fen, label: "current" }} b={compare} />
            </Panel>)}
        </div>
        <div className="col gap-lg">
          {lesson ? (
            <Panel title={`${lesson.opening.eco} · ${lesson.opening.name}`} actions={<button className="btn sm" onClick={() => setLesson(null)}>Close lesson</button>}>
              <p>{lesson.opening.idea}</p>
              <div className="row" style={{ margin: "8px 0" }}>
                <button className="btn sm" disabled={step === 0} onClick={() => setStep(step - 1)}>◀ Previous</button>
                <button className="btn sm primary" disabled={step >= lesson.steps.length} onClick={() => setStep(step + 1)}>Next move ▶</button>
                <span className="muted">move {step} of {lesson.steps.length}</span><span className="grow" />
                <button className="btn sm" onClick={() => startPlayback(lesson.opening.uci, START_FEN, lesson.opening.name, Object.fromEntries(lesson.steps.filter((s: any) => s.text).map((s: any) => [s.ply, `${s.title}: ${s.text}`])))}>Replay / send to board</button>
              </div>
              {step > 0 && <div className="note"><b className="mono">{lesson.steps[step - 1].san}</b>{lesson.steps[step - 1].title ? ` — ${lesson.steps[step - 1].title}` : ""}{lesson.steps[step - 1].text ? `. ${lesson.steps[step - 1].text}` : ""}</div>}
              {step === lesson.steps.length && (
                <div className="grid g2" style={{ marginTop: 10 }}>
                  <div><div className="label">Plans for White</div><ul style={{ margin: "4px 0", paddingLeft: 18 }}>{lesson.opening.plans.white.map((p: string) => <li key={p}>{p}</li>)}</ul></div>
                  <div><div className="label">Plans for Black</div><ul style={{ margin: "4px 0", paddingLeft: 18 }}>{lesson.opening.plans.black.map((p: string) => <li key={p}>{p}</li>)}</ul></div>
                  <div style={{ gridColumn: "1 / 3" }}><div className="label">Pawn structure</div><p>{lesson.opening.structure} <span className="muted">Key squares are highlighted on the board.</span></p></div>
                </div>)}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn good" onClick={() => act(async () => { await api.post("/api/training/decks", { opening_id: lesson.opening.id, color: "white" }); await api.post("/api/training/decks", { opening_id: lesson.opening.id, color: "black" }); go("training"); }, "Training decks created")}>Drill this opening</button>
                <button className="btn" onClick={() => go("play", { moves: lesson.opening.uci })}>Play it against an engine</button>
                <button className="btn" onClick={() => act(async () => { await api.post("/api/studies", { opening_id: lesson.opening.id }); go("studies"); }, "Study created")}>Create a study</button>
                <button className="btn" onClick={() => go("discovery", { openingId: lesson.opening.id, moves: lesson.opening.uci })}>Hunt for alternatives</button>
              </div>
              {lesson.continuations.length > 0 && <><div className="label" style={{ marginTop: 12 }}>Continue with</div>
                <div className="row">{lesson.continuations.map((c: any) => <button key={c.id} className="btn xs" onClick={() => openLesson(c.id)}>{c.name.replace(lesson.opening.name + ": ", "")} <span className="muted mono">{c.next.join(" ")}</span></button>)}</div></>}
              {lesson.traps.length > 0 && <><div className="label" style={{ marginTop: 12 }}>Traps to know</div>
                {lesson.traps.map((t: any) => <div key={t.id} className="row"><b>{t.name}</b><span className="muted grow">{t.explanation}</span><button className="btn xs" onClick={() => startPlayback(t.uci, START_FEN, t.name, { [t.blunder_ply + 1]: `The mistake. ${t.explanation}` })}>Show</button></div>)}</>}
            </Panel>
          ) : (
            <Panel title="Explorer" hint={tree.data ? `${tree.data.nodes} moves loaded` : ""}>
              <Tabs value={mode} onChange={setMode} items={[["tree", "Move tree"], ["graph", "Spatial graph"], ["outline", "Repertoire outline"], ["heatmap", "Heatmap"], ["ranking", "Engine ranking"], ["evidence", "Research evidence"]]} />
              {tree.error && <div className="note bad">{tree.error}</div>}
              {mode === "tree" && tree.data && <div className="scroll" style={{ maxHeight: "46vh" }}>
                <div className={`tree-node ${sel === "root" ? "sel" : ""}`} onClick={() => pickNode(tree.data.root)}><span className="tw" /><b>Start</b></div>
                <TreeRows node={tree.data.root} depth={0} sel={sel} onPick={pickNode} onMenu={nodeMenu} open={open}
                  toggle={(id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                  onHover={(n: any, e?: React.MouseEvent) => setHover(n && e ? { fen: n.fen, x: e.clientX, y: e.clientY, last: n.uci } : null)} /></div>}
              {mode === "graph" && tree.data && <Graph root={tree.data.root} sel={sel} onPick={pickNode} onMenu={nodeMenu} />}
              {mode === "outline" && tree.data && <div className="scroll" style={{ maxHeight: "50vh", lineHeight: 1.8 }}><Outline node={findNode(tree.data.root, sel) || tree.data.root} prefix="" depth={0} /></div>}
              {mode === "heatmap" && <div><p className="help">Destination squares are shaded by the share of book weight that goes there from this position.</p>
                <table className="t"><thead><tr><th>Move</th><th>Share</th><th>Games</th><th>Score</th><th>Status</th></tr></thead><tbody>{(here.data?.moves || []).map((m: any) => (
                  <tr key={m.uci} className="click" onClick={() => { setPath([...path, { fen: m.fen_after, uci: m.uci, san: m.san }]); setSel((sel === "root" ? "" : sel + " ") + m.uci); }}>
                    <td className="mono"><b>{m.san}</b></td><td><div className="meter" style={{ width: 90 }}><i style={{ width: `${m.share * 100}%` }} /></div></td><td>{m.games || "–"}</td><td>{m.score != null ? `${(m.score * 100).toFixed(0)}%` : "–"}</td><td><span className="pill">{m.status}</span></td></tr>))}</tbody></table></div>}
              {mode === "ranking" && <div className="col">
                <div className="grid g2"><EnginePicker value={rankEngine} onChange={setRankEngine} /><BudgetEditor label="Budget" value={budget} onChange={setBudget} /></div>
                <div><button className="btn primary" disabled={!rankEngine} onClick={async () => setRank(await act(() => api.post("/api/analysis/ranked", { engine: rankEngine, fen, n: 6, budget, book_id: bookId })))}>Rank the moves here</button></div>
                {rank?.fen === fen && <table className="t"><thead><tr><th>#</th><th>Move</th><th>Eval</th><th>In book</th><th>Class</th></tr></thead><tbody>{rank.candidates.map((c: any) => (
                  <tr key={c.move}><td>{c.rank}</td><td className="mono"><b>{c.san}</b></td><td className="mono">{c.score.text}</td><td>{here.data?.moves.some((m: any) => m.uci === c.move) ? "yes" : <span className="pill warn">not in book</span>}</td>
                    <td className={`cls-${c.classification.label}`}>{title(c.classification.label)}{c.classification.novelty_candidate ? " · novelty candidate (vs. this book)" : ""}</td></tr>))}</tbody></table>}
              </div>}
              {mode === "evidence" && (know.data ? <div className="col">
                <div className="row"><span className="pill brass">{know.data.repertoire_status}</span>{know.data.opening && <span className="pill">{know.data.opening.eco} {know.data.opening.name}</span>}</div>
                {know.data.findings.map((f: any) => <div key={f.id} className="note"><b className="mono">{f.san}</b> — {title(f.category)} · {title(f.status)} · {f.games} test game(s) · engines: {f.engines.filter(Boolean).join(" → ")}</div>)}
                {!know.data.findings.length && <div className="muted">No research findings at this position yet.</div>}
                {know.data.analysis.map((a: any, i: number) => <div key={i} className="mono muted">{a.engine}: {a.best} {a.score} (depth {a.depth})</div>)}
                {know.data.recommended.map((r: string, i: number) => <div key={i} className="help">→ {r}</div>)}
              </div> : <span className="muted">Loading…</span>)}
              <p className="help" style={{ marginTop: 8 }}>Right-click any move for: analyze, create puzzle, play, send to Chessnut, test in tournament, explore alternatives, approve or reject.</p>
            </Panel>)}
          <Panel title="Opening catalogue" hint={`${filtered.length} lines`} actions={<input type="search" placeholder="Search name, ECO or moves" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 230 }} />}>
            <div className="scroll" style={{ maxHeight: "38vh" }}>
              {Object.entries(groups).map(([g, items]) => (
                <div key={g}><div className="label" style={{ margin: "8px 0 4px" }}>{g}</div>
                  {items.map((o) => (
                    <div key={o.id} className="tree-node" onClick={() => openLesson(o.id)} title={o.idea}>
                      <span className="pill">{o.eco}</span><b>{o.name}</b><span className="mono muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.moves.join(" ")}</span>
                    </div>))}</div>))}
            </div>
          </Panel>
        </div>
      </div>
      {hover && <div style={{ position: "fixed", left: Math.min(hover.x + 18, innerWidth - 190), top: Math.min(hover.y + 12, innerHeight - 190), zIndex: 50, pointerEvents: "none", boxShadow: "var(--shadow)" }}><MiniBoard fen={hover.fen} lastMove={hover.last} size={170} /></div>}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function CompareView({ a, b }: { a: { fen: string; label: string }; b: { fen: string; label: string } }) {
  const [sa, setSa] = useState<any>(null), [sb, setSb] = useState<any>(null);
  useEffect(() => { api.post("/api/chess/state", { fen: a.fen }).then(setSa).catch(() => undefined); api.post("/api/chess/state", { fen: b.fen }).then(setSb).catch(() => undefined); }, [a.fen, b.fen]);
  const col = (x: any, t: { fen: string; label: string }) => (
    <div className="col"><MiniBoard fen={t.fen} size={190} /><b>{t.label}</b>
      {x && <div className="help">{x.opening ? `${x.opening.eco} ${x.opening.name}` : "unnamed"}<br />
        White: {x.pawn_structure.white.islands} island(s), isolated {x.pawn_structure.white.isolated.join(" ") || "–"}, doubled {x.pawn_structure.white.doubled.join(" ") || "–"}<br />
        Black: {x.pawn_structure.black.islands} island(s), isolated {x.pawn_structure.black.isolated.join(" ") || "–"}, doubled {x.pawn_structure.black.doubled.join(" ") || "–"}<br />
        Tactical complexity {x.complexity} · {x.legal.length} legal moves{x.check ? " · check" : ""}</div>}
    </div>);
  const same = sa && sb && sa.fen.split(" ").slice(0, 4).join(" ") === sb.fen.split(" ").slice(0, 4).join(" ");
  return <div><div className="row" style={{ alignItems: "flex-start", gap: 18 }}>{col(sa, a)}{col(sb, b)}</div>
    {same ? <div className="note good" style={{ marginTop: 8 }}>These two branches transpose: the positions are identical.</div>
      : sa && sb && <div className="note" style={{ marginTop: 8 }}>Different positions. Compare the pawn islands and weak pawns above; open either one in Analysis for candidate continuations and engine evaluations.</div>}</div>;
}
