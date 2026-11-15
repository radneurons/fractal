// Study system: studies → chapters, each a full PGN tree with variations, comments, NAGs and drawn shapes.
import { useEffect, useMemo, useState } from "react";
import { api, useApi } from "../api";
import Board, { Shapes } from "../chess/Board";
import { DRAW_COLORS } from "../chess/Board2D";
import { GameTree, TNode, useTree } from "../chess/tree";
import { TreeMoves } from "../chess/widgets";
import { act, ago, title, useStore } from "../store";
import { ContextMenu, Field, MenuItem, Modal, Panel, Select } from "../ui/ui";

const NAGS: [number, string][] = [[1, "!"], [2, "?"], [3, "!!"], [4, "??"], [5, "!?"], [6, "?!"], [10, "="], [14, "⩲"], [15, "⩱"], [16, "±"], [17, "∓"], [18, "+−"], [19, "−+"], [146, "N"]];
const colorName = (c?: string) => (c === DRAW_COLORS.red ? "red" : c === DRAW_COLORS.blue ? "blue" : c === DRAW_COLORS.yellow ? "yellow" : "green");
const colorHex = (c: string) => (DRAW_COLORS as any)[c] || DRAW_COLORS.green;

export default function Studies() {
  const { meta, go, toast, engines } = useStore();
  const list = useApi<any[]>("/api/studies");
  const [sid, setSid] = useState("");
  const [cid, setCid] = useState("");
  const [imp, setImp] = useState(false);
  const [pgn, setPgn] = useState("");
  const study = useApi<any>(sid ? `/api/studies/${sid}` : null);
  useEffect(() => { if (!sid && list.data?.length) setSid(list.data[0].id); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (study.data?.chapters?.length && !study.data.chapters.some((c: any) => c.id === cid)) setCid(study.data.chapters[0].id); }, [study.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = (body: any, ok: string) => act(async () => { const s = await api.post("/api/studies", body); list.reload(); setSid(s.id); setCid(""); return s; }, ok);
  return (
    <div className="view">
      <div className="view-head"><div><h1>Studies</h1><div className="sub">Annotated chapters that export as standard PGN — variations, comments, symbols and arrows included.</div></div>
        <span className="spacer" /><button className="btn" onClick={() => setImp(true)}>Import PGN</button>
        <button className="btn primary" onClick={() => { const t = prompt("Study title:", "New study"); if (t) create({ title: t }, "Study created"); }}>New study</button></div>
      <div className="side-list">
        <div className="col">
          <Panel title="Studies" tight>
            {(list.data || []).map((s) => (
              <div key={s.id} className={`tree-node ${sid === s.id ? "sel" : ""}`} style={{ whiteSpace: "normal", padding: "6px 8px" }} onClick={() => { setSid(s.id); setCid(""); }}>
                <div className="grow"><b>{s.title}</b><div className="muted" style={{ fontSize: 12 }}>{title(s.kind)} · {s.chapters} chapter(s) · {ago(s.updated_at)}</div></div></div>))}
            {!list.data?.length && <div className="muted" style={{ padding: 8 }}>No studies yet.</div>}
          </Panel>
          {study.data && (
            <Panel title="Chapters" tight actions={<button className="btn xs" onClick={() => act(async () => { const c = await api.post(`/api/studies/${sid}/chapters`, { title: `Chapter ${study.data.chapters.length + 1}` }); study.reload(); setCid(c.id); })}>+ Chapter</button>}>
              {study.data.chapters.map((c: any) => (
                <div key={c.id} className={`tree-node ${cid === c.id ? "sel" : ""}`} onClick={() => setCid(c.id)}><span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.title}</span>
                  <button className="btn xs ghost" onClick={(e) => { e.stopPropagation(); confirm("Delete this chapter?") && act(async () => { await api.del(`/api/chapters/${c.id}`); study.reload(); }); }}>✕</button></div>))}
              <div className="row" style={{ marginTop: 8 }}>
                <Select value={study.data.kind} onChange={(kind) => act(async () => { await api.patch(`/api/studies/${sid}`, { kind }); study.reload(); list.reload(); })} options={(meta?.study_kinds || []).map((k: string) => [k, title(k)])} />
                <button className="btn xs" onClick={() => api.download(`/api/studies/${sid}/pgn`, `${study.data.title}.pgn`)}>Export PGN</button>
                <button className="btn xs ghost" onClick={() => confirm("Delete the whole study?") && act(async () => { await api.del(`/api/studies/${sid}`); setSid(""); list.reload(); })}>Delete study</button></div>
            </Panel>)}
        </div>
        {cid ? <Chapter key={cid} id={cid} /> : <div className="empty">{sid ? "Select or add a chapter." : "Create a study, import a PGN, or generate one from an opening, a game, a tournament or a discovery."}</div>}
      </div>
      {imp && (
        <Modal title="Import PGN as a study" onClose={() => setImp(false)}>
          <textarea rows={12} value={pgn} onChange={(e) => setPgn(e.target.value)} placeholder="One or many games — each becomes a chapter. Variations and annotations are kept." />
          <div className="row" style={{ marginTop: 10 }}><label className="btn sm">Open file…<input type="file" accept=".pgn,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPgn(await f.text()); }} /></label><span className="grow" />
            <button className="btn" onClick={() => act(async () => { const r = await api.post("/api/pgn/import-games", { pgn }); toast(`${r.imported} game(s) stored in the research database`, "ok"); })}>Only store the games</button>
            <button className="btn primary" disabled={!pgn.trim()} onClick={async () => { if (await create({ pgn }, "Study imported")) setImp(false); }}>Import as study</button></div>
        </Modal>)}
    </div>
  );
}

function Chapter({ id }: { id: string }) {
  const { go, engines, hw } = useStore();
  const { tree, apply, replace, version } = useTree();
  const [ch, setCh] = useState<any>(null);
  const [flip, setFlip] = useState(false);
  const [comment, setComment] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const load = (data: any, path?: number[]) => {
    setCh(data);
    const t = GameTree.fromServer(data.tree.root);
    let n = t.root;
    for (const i of path || []) { if (!n.children[i]) break; n = n.children[i]; }
    t.current = n;
    replace(t);
    setComment(n.comment);
  };
  useEffect(() => { api.get(`/api/chapters/${id}`).then((d) => { load(d); setFlip(d.orientation === "black"); }).catch(() => undefined); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = tree.current;
  useEffect(() => { setComment(cur.comment); }, [cur]);
  const edit = (op: string, extra: any = {}, node: TNode = cur) => act(async () => { const r = await api.post(`/api/chapters/${id}/edit`, { op, path: tree.indexPath(node), ...extra }); load(r, r.path); });
  const shapes: Shapes = useMemo(() => ({ arrows: cur.arrows.filter((a) => a.from !== a.to).map((a) => ({ from: a.from, to: a.to, color: colorHex(a.color) })),
    squares: Object.fromEntries(cur.arrows.filter((a) => a.from === a.to).map((a) => [a.from, colorHex(a.color)])) }), [cur, version]);
  if (!ch) return <div className="muted">Loading…</div>;
  return (
    <div className="split">
      <div className="col">
        <Board fen={cur.fen} orientation={flip ? "black" : "white"} movable="both" lastMove={cur.uci} onFlip={() => setFlip(!flip)} drawable userShapes={shapes}
          onMove={(uci) => edit("add_move", { move: uci })}
          onUserShapes={(s) => edit("shapes", { arrows: s.arrows.map((a) => ({ from: a.from, to: a.to, color: colorName(a.color) })), squares: Object.entries(s.squares).map(([square, c]) => ({ square, color: colorName(c) })) })} />
        <div className="row"><button className="btn sm" onClick={() => apply((t) => t.start())}>⏮</button><button className="btn sm" onClick={() => apply((t) => t.back())}>◀</button>
          <button className="btn sm" onClick={() => apply((t) => t.forward())}>▶</button><button className="btn sm" onClick={() => apply((t) => t.end())}>⏭</button><span className="grow" />
          <span className="muted">{ch.opening ? `${ch.opening.eco} ${ch.opening.name}` : ""}</span></div>
        <p className="help">Moves you play are saved straight into the chapter. Right-drag to draw arrows and right-click to mark squares — they are stored in the PGN.</p>
      </div>
      <div className="col gap-lg">
        <Panel title={ch.title} actions={<button className="btn xs" onClick={() => { const t = prompt("Chapter title:", ch.title); if (t) act(async () => load(await api.put(`/api/chapters/${id}`, { pgn: ch.pgn, title: t }), tree.indexPath())); }}>Rename</button>}>
          <div style={{ maxHeight: 250, overflow: "auto" }}><TreeMoves tree={tree} onGoto={(n) => apply((t) => t.goto(n))}
            onContext={(n, e) => setMenu({ x: e.clientX, y: e.clientY, items: [{ label: "Promote variation", onClick: () => edit("promote", {}, n) }, { label: "Make main line", onClick: () => edit("make_main", {}, n) }, { label: "Delete from here", onClick: () => edit("delete", {}, n) }] })} /></div>
        </Panel>
        <Panel title={cur.san ? `Annotation for ${cur.san}` : "Chapter introduction"}>
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} onBlur={() => comment !== cur.comment && edit("comment", { text: comment })} placeholder="Write a comment…" style={{ fontFamily: "var(--sans)", fontSize: 13.5 }} />
          {cur.san && <div className="row" style={{ marginTop: 8 }}>{NAGS.map(([n, s]) => <button key={n} className={`btn xs ${cur.nags.includes(n) ? "on" : ""}`} onClick={() => edit("nags", { nags: cur.nags.includes(n) ? cur.nags.filter((x) => x !== n) : [...cur.nags.filter((x) => (x < 10) !== (n < 10)), n] })}>{s}</button>)}</div>}
        </Panel>
        <Panel title="Use this chapter">
          <div className="row">
            <button className="btn" onClick={() => go("analysis", { pgn: ch.pgn })}>Analyse with engines</button>
            <button className="btn" onClick={async () => { const s = await act(() => api.post(`/api/chapters/${id}/to`, { target: "playback", path: tree.indexPath() })); if (s) go("openings", { playbackMoves: s.moves, startFen: s.start_fen, title: s.title }); }}>Replay{hw?.connected ? " / send to Chessnut" : ""}</button>
            <button className="btn" onClick={() => act(() => api.post(`/api/chapters/${id}/to`, { target: "cards", path: tree.indexPath(), color: flip ? "black" : "white" }), `Training deck built as ${flip ? "Black" : "White"}`)}>Make training cards</button>
            <button className="btn" disabled={!engines.length} onClick={() => act(() => api.post(`/api/chapters/${id}/to`, { target: "puzzles", engine: { engine_id: engines[engines.length - 1].id }, budget: { min_time: 0.2, max_time: 1.5, min_depth: 6, max_depth: 16 } }), "Puzzle mining queued")}>Mine puzzles</button>
            <button className="btn" onClick={() => go("play", { moves: tree.moves(), startFen: tree.root.fen })}>Play from here</button>
          </div>
        </Panel>
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
