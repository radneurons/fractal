// Opening Book Forge: import/export, browse and edit, versions, operations and the evidence-driven improvement cycle.
import { useEffect, useState } from "react";
import { api, useApi } from "../api";
import Board from "../chess/Board";
import { START_FEN, tryMove } from "../chess/tree";
import { act, ago, fmtScore, title, useStore } from "../store";
import { Field, Modal, Num, Panel, Select, Tabs } from "../ui/ui";

export default function Books() {
  const { meta, go, toast } = useStore();
  const list = useApi<any[]>("/api/books");
  const [sel, setSel] = useState("");
  const [importing, setImporting] = useState(false);
  useEffect(() => { if (!sel && list.data?.length) setSel(list.data[0].id); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (file: File, into?: string) => {
    setImporting(true);
    const name = file.name.replace(/\.[^.]+$/, "");
    const r = await act(() => api.upload(`/api/books/import?name=${encodeURIComponent(name)}&max_ply=60${into ? `&into=${into}` : ""}`, file));
    setImporting(false);
    if (r) { toast(`Imported ${r.format.toUpperCase()}: ${r.import.moves} moves in ${r.import.positions} positions${r.import.entries_unreachable ? ` (${r.import.entries_unreachable} Polyglot entries not reachable from the start position)` : ""}`, "ok"); list.reload(); setSel(r.book.id); }
  };
  return (
    <div className="view">
      <div className="view-head"><div><h1>Opening Book Forge</h1><div className="sub">Books are transposition-aware graphs. Every change is a new version; nothing is ever overwritten.</div></div>
        <span className="spacer" />
        <label className={`btn ${importing ? "on" : ""}`}>{importing ? "Importing…" : "Import book…"}<input type="file" hidden accept=".pgn,.bin,.epd,.fen,.txt,.json,.csv,.ctg,.abk" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} /></label>
        <button className="btn" onClick={() => { const name = prompt("Name of the new book:", "My repertoire"); if (name) act(async () => { const b = await api.post("/api/books", { name }); list.reload(); setSel(b.id); }); }}>New empty book</button>
      </div>
      <div className="side-list">
        <div className="col">
          <Panel title="Books" tight>
            {(list.data || []).map((b) => (
              <div key={b.id} className={`tree-node ${sel === b.id ? "sel" : ""}`} style={{ whiteSpace: "normal", padding: "6px 8px" }} onClick={() => setSel(b.id)}>
                <div className="grow"><b>{b.name}</b><div className="muted" style={{ fontSize: 12 }}>{title(b.profile)} · v{b.head_version} · {b.stats.moves ?? 0} moves · {b.stats.positions ?? 0} positions</div></div></div>))}
          </Panel>
          <Panel title="Formats" tight>
            <p className="help"><b>Import and export:</b> PGN (with variations), Polyglot .bin, EPD / FEN lists, native JSON, CSV (<span className="mono">{(meta?.csv_fields || []).join(",")}</span>).</p>
            <p className="help"><b>Not read directly:</b> {Object.keys(meta?.unsupported_book_formats || {}).join(", ")} — proprietary formats. Export them to PGN or Polyglot from their own program first; the importer tells you how.</p>
          </Panel>
        </div>
        {sel ? <BookView key={sel} id={sel} books={list.data || []} onChanged={list.reload} onGone={() => { setSel(""); list.reload(); }} onMergeFile={(f) => upload(f, sel)} /> : <div className="empty">Import a book or create an empty one.</div>}
      </div>
    </div>
  );
}

function BookView({ id, books, onChanged, onGone, onMergeFile }: { id: string; books: any[]; onChanged: () => void; onGone: () => void; onMergeFile: (f: File) => void }) {
  const { meta, go, toast } = useStore();
  const info = useApi<any>(`/api/books/${id}`);
  const [tab, setTab] = useState<"explore" | "versions" | "ops" | "improve" | "export">("explore");
  const [path, setPath] = useState<{ fen: string; san: string; uci: string }[]>([]);
  const fen = path.length ? path[path.length - 1].fen : info.data ? (info.data.stats && START_FEN) : START_FEN;
  const pos = useApi<any>(`/api/books/${id}/position?fen=${encodeURIComponent(fen)}`, { deps: [fen, info.data?.head_version] });
  const [weak, setWeak] = useState<any[] | null>(null);
  const [diff, setDiff] = useState<any | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const b = info.data;
  if (!b) return <div className="muted">{info.error || "Loading…"}</div>;
  const refresh = () => { info.reload(); pos.reload(); onChanged(); };
  const op = (body: any, ok?: string) => act(async () => { const r = await api.post(`/api/books/${id}/op`, body); refresh(); return r; }, ok);
  const pending = (b.proposals || []).filter((p: any) => p.state === "pending");
  return (
    <div className="col gap-lg">
      <Panel title={b.name} hint={`${b.profile_label} · version ${b.head_version}`} actions={<div className="row">
        <Select value={b.profile} onChange={(profile) => act(async () => { await api.patch(`/api/books/${id}`, { profile }); refresh(); })} options={Object.entries(meta?.book_profiles || {}).map(([k, v]) => [k, String(v).split(" — ")[0]])} style={{ width: 210 }} />
        <Select value={b.target_color || ""} onChange={(target_color) => act(async () => { await api.patch(`/api/books/${id}`, { target_color: target_color || null }); refresh(); })} options={[["", "both colours"], ["white", "for White"], ["black", "for Black"]]} style={{ width: 130 }} />
        <button className="btn sm ghost" onClick={() => confirm(`Delete “${b.name}” and all its versions?`) && act(async () => { await api.del(`/api/books/${id}`); onGone(); })}>Delete</button></div>}>
        <div className="grid g4">
          <div className="kpi"><b>{b.stats.positions}</b><span>Positions</span></div><div className="kpi"><b>{b.stats.moves}</b><span>Moves</span></div>
          <div className="kpi"><b>{b.stats.max_ply}</b><span>Deepest ply</span></div><div className="kpi"><b>{pending.length}</b><span>Pending proposals</span></div></div>
        {b.source && <p className="help" style={{ marginTop: 6 }}>Source: {b.source}. {b.description}</p>}
      </Panel>
      <Tabs value={tab} onChange={setTab} items={[["explore", "Browse & edit"], ["versions", `Versions (${b.versions.length})`], ["ops", "Operations"], ["improve", `Improve${pending.length ? ` (${pending.length})` : ""}`], ["export", "Export"]]} />
      {tab === "explore" && (
        <div className="split">
          <div className="col"><Board fen={fen} movable="both" lastMove={path.length ? path[path.length - 1].uci : null}
            arrows={(pos.data?.moves || []).slice(0, 8).map((m: any) => ({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), color: m.status === "rejected" ? "#d2584f" : m.status === "candidate" ? "#e0a23a" : "#2fa37c", width: 0.5 + m.share, opacity: 0.4 + m.share * 0.6 }))}
            onMove={(uci) => { const r = tryMove(fen, uci); if (!r) return; const known = pos.data?.moves.find((m: any) => m.uci === r.uci);
              if (known) setPath([...path, { fen: r.fen, san: r.san, uci: r.uci }]); else setEdit({ fen, uci: r.uci, san: r.san, weight: 1, status: "candidate", comment: "", isNew: true, after: r.fen }); }} />
            <div className="row"><span className="mono grow">{path.map((p) => p.san).join(" ") || "Root position"}</span><button className="btn sm" disabled={!path.length} onClick={() => setPath(path.slice(0, -1))}>◀ Back</button><button className="btn sm" disabled={!path.length} onClick={() => setPath([])}>Root</button></div>
            <p className="help">Play a book move to follow it; play any other legal move to add it as a new line.</p></div>
          <Panel title="Moves in this position" hint={pos.data?.in_book ? "" : "not in the book"}>
            <table className="t"><thead><tr><th>Move</th><th>Weight</th><th>Share</th><th>Games</th><th>Score</th><th>Eval</th><th>Status</th><th /></tr></thead>
              <tbody>{(pos.data?.moves || []).map((m: any) => (
                <tr key={m.uci} className="click" onClick={() => setPath([...path, { fen: m.fen_after, san: m.san, uci: m.uci }])}>
                  <td className="mono"><b>{m.san}</b>{m.children ? <span className="muted"> ›{m.children}</span> : ""}</td><td>{+m.weight.toFixed(3)}</td><td>{(m.share * 100).toFixed(0)}%</td>
                  <td>{m.games ? `${m.games} (+${m.w} =${m.d} −${m.l})` : "–"}</td><td>{m.score != null ? (m.score * 100).toFixed(0) + "%" : "–"}</td><td className="mono">{m.eval ? fmtScore({ text: m.eval.cp != null ? (m.eval.cp / 100).toFixed(2) : "#" + m.eval.mate }) : "–"}</td>
                  <td><span className={`pill ${m.status === "approved" ? "good" : m.status === "rejected" ? "bad" : m.status === "candidate" ? "warn" : ""}`}>{m.status}</span></td>
                  <td className="right"><button className="btn xs" onClick={(e) => { e.stopPropagation(); setEdit({ fen, uci: m.uci, san: m.san, weight: m.weight, status: m.status, comment: m.comment || "" }); }}>Edit</button></td></tr>))}</tbody></table>
            {!pos.data?.moves?.length && <div className="empty">No moves stored here. Play a move on the board to add one.</div>}
            <div className="row" style={{ marginTop: 10 }}><button className="btn sm" onClick={() => go("discovery", { fen })}>Research alternatives here</button>
              <button className="btn sm" onClick={() => op({ op: "split", fen, name: `${b.name} — ${path.map((p) => p.san).join(" ") || "root"}` }, "Branch split into a new book").then(onChanged)} disabled={!path.length}>Split this branch into its own book</button></div>
          </Panel>
        </div>)}
      {tab === "versions" && (
        <Panel title="Version history" hint="restoring creates a new version — nothing is lost">
          <table className="t"><thead><tr><th>Version</th><th>Change</th><th>Added</th><th>Removed</th><th>Reweighted</th><th>Evidence</th><th>When</th><th /></tr></thead>
            <tbody>{b.versions.map((v: any) => (
              <tr key={v.version} className={v.version === b.head_version ? "sel" : ""}><td><b>v{v.version}</b>{v.version === b.head_version && <span className="pill good" style={{ marginLeft: 6 }}>head</span>}</td><td>{v.summary}</td>
                <td>{v.changes.added ?? "–"}</td><td>{v.changes.removed ?? "–"}</td><td>{v.changes.changed ?? "–"}</td><td>{v.evidence?.length ? `${v.evidence.length} finding(s)` : "–"}</td><td className="muted">{ago(v.created_at)}</td>
                <td className="right nowrap"><button className="btn xs" onClick={async () => setDiff({ title: `v${v.version} → v${b.head_version}`, ...(await act(() => api.post(`/api/books/${id}/op`, { op: "compare", version_a: v.version, version_b: b.head_version })) || {}) })}>Compare with head</button>{" "}
                  {v.version !== b.head_version && <button className="btn xs" onClick={() => op({ op: "restore", version: v.version }, `Restored version ${v.version} as a new version`)}>Restore</button>}</td></tr>))}</tbody></table>
        </Panel>)}
      {tab === "ops" && (
        <div className="grid g2">
          <Panel title="Merge"><p className="help">Add another book's moves and results into this one.</p>
            <div className="row nowrap"><select id="mergeother">{books.filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <button className="btn" disabled={books.length < 2} onClick={() => op({ op: "merge", other: (document.getElementById("mergeother") as HTMLSelectElement).value }, "Merged as a new version")}>Merge</button></div>
            <label className="btn sm" style={{ marginTop: 8 }}>…or merge a file into this book<input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onMergeFile(f); }} /></label></Panel>
          <Panel title="Reweight"><p className="help">Recompute weights from stored evidence. Results are shrunk toward 50% with a prior of 20 games, so two lucky wins cannot outrank 200 solid games.</p>
            <div className="row">{[["evidence", "Evidence (evaluation × results × confidence)"], ["frequency", "Games played"], ["eval", "Evaluation only"], ["uniform", "All equal"]].map(([m, l]) => <button key={m} className="btn sm" onClick={() => op({ op: "reweight", mode: m }, "Reweighted as a new version")}>{l}</button>)}</div></Panel>
          <Panel title="Filter"><FilterForm onRun={(body) => op({ op: "filter", ...body }, body.as_new ? "Filtered copy created" : "Filtered as a new version").then(onChanged)} /></Panel>
          <Panel title="Clean up"><p className="help">Remove illegal or zero-weight entries and normalise notation. Transposed duplicates are already merged by design.</p>
            <button className="btn" onClick={() => op({ op: "dedupe" }).then((r) => r && toast(`Removed ${r.dedupe.removed} entries, fixed ${r.dedupe.san_fixed} notations`, "ok"))}>Deduplicate and clean</button></Panel>
          <Panel title="Compare with another book"><div className="row nowrap"><select id="cmpother">{books.filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <button className="btn" disabled={books.length < 2} onClick={async () => { const other = (document.getElementById("cmpother") as HTMLSelectElement).value; setDiff({ title: `${b.name} → ${books.find((x) => x.id === other)?.name}`, ...(await act(() => api.post(`/api/books/${id}/op`, { op: "compare", other })) || {}) }); }}>Compare</button></div></Panel>
          <Panel title="Train with this book"><div className="row">{["white", "black"].map((c) => <button key={c} className="btn" onClick={() => act(async () => { await api.post("/api/training/decks", { book_id: id, color: c }); go("training"); }, "Deck built")}>Build a deck as {title(c)}</button>)}</div></Panel>
        </div>)}
      {tab === "improve" && (
        <div className="col gap-lg">
          <Panel title="Improvement cycle" hint="identify → research → verify → propose → approve → new version">
            <div className="row"><button className="btn" onClick={async () => setWeak((await op({ op: "weak", max_ply: 16 }))?.branches || [])}>1 · Find weak or under-explored branches</button>
              <button className="btn" onClick={() => op({ op: "propose" }, "Proposals refreshed from research findings")}>2 · Collect proposals from research findings</button></div>
            {weak && <div className="scroll" style={{ maxHeight: 260, marginTop: 10 }}><table className="t"><thead><tr><th>Ply</th><th>To move</th><th>Why</th><th /></tr></thead><tbody>{weak.map((w, i) => (
              <tr key={i}><td>{w.ply}</td><td>{w.side}</td><td>{w.reasons.join("; ")}</td><td className="right nowrap"><button className="btn xs" onClick={() => go("analysis", { fen: w.fen })}>Look</button>{" "}<button className="btn xs" onClick={() => go("discovery", { fen: w.fen })}>Research</button></td></tr>))}</tbody></table>
              {!weak.length && <div className="muted">Nothing flagged within 16 plies.</div>}</div>}
          </Panel>
          <Panel title="Proposals awaiting your decision" hint="nothing enters the book automatically">
            {pending.length ? <Proposals proposals={pending} onDecide={(d) => act(async () => { const r = await api.post(`/api/books/${id}/op`, { op: "decide", decisions: d }); refresh(); toast(r.applied.length ? `Applied ${r.applied.join(", ")} as version ${r.version}` : "Proposals declined", "ok"); })} />
              : <div className="muted">No pending proposals. Findings marked promising, repertoire candidate, approved or rejected in the Discovery Lab become proposals here.</div>}
          </Panel>
        </div>)}
      {tab === "export" && (
        <Panel title="Export">
          <div className="row">{[["pgn", "PGN with variations"], ["bin", "Polyglot .bin"], ["json", "Native JSON"], ["csv", "CSV"], ["epd", "EPD"]].map(([f, l]) => (
            <button key={f} className="btn" onClick={() => api.download(`/api/books/${id}/export?format=${f}`, `${b.name}.${f}`)}>{l}</button>))}</div>
          <p className="help" style={{ marginTop: 8 }}>Rejected moves are left out of PGN, Polyglot and EPD exports. Polyglot weights are scaled to 1–10000 per position. Any earlier version can be exported from the Versions tab by restoring it first.</p>
        </Panel>)}
      {edit && (
        <Modal title={`${edit.isNew ? "Add" : "Edit"} ${edit.san}`} onClose={() => setEdit(null)}>
          <div className="col">
            <div className="grid g2"><Field label="Weight"><Num value={edit.weight} min={0} step={0.1} onChange={(v) => setEdit({ ...edit, weight: v })} /></Field>
              <Field label="Status"><Select value={edit.status} onChange={(v) => setEdit({ ...edit, status: v })} options={(meta?.book_statuses || []).map((s: string) => [s, title(s)])} /></Field></div>
            <Field label="Comment"><textarea rows={3} value={edit.comment} onChange={(e) => setEdit({ ...edit, comment: e.target.value })} style={{ fontFamily: "var(--sans)" }} /></Field>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              {!edit.isNew && <button className="btn danger" onClick={() => act(async () => { await api.post(`/api/books/${id}/move`, { fen: edit.fen, move: edit.uci, action: "remove" }); setEdit(null); refresh(); }, "Removed (new version)")}>Remove move</button>}
              <button className="btn primary" onClick={() => act(async () => { await api.post(`/api/books/${id}/move`, { fen: edit.fen, move: edit.uci, weight: edit.weight, status: edit.status, comment: edit.comment }); if (edit.after) setPath([...path, { fen: edit.after, san: edit.san, uci: edit.uci }]); setEdit(null); refresh(); }, "Saved as a new version")}>Save</button></div>
          </div>
        </Modal>)}
      {diff && (
        <Modal title={`Comparison · ${diff.title}`} onClose={() => setDiff(null)} wide>
          <div className="grid g3"><div className="kpi"><b className="good-t">+{diff.added ?? 0}</b><span>Added</span></div><div className="kpi"><b className="bad-t">−{diff.removed ?? 0}</b><span>Removed</span></div><div className="kpi"><b>{diff.changed ?? 0}</b><span>Changed</span></div></div>
          <div className="scroll" style={{ maxHeight: "50vh", marginTop: 10 }}><table className="t"><tbody>
            {(diff.added_sample || []).map((x: any, i: number) => <tr key={"a" + i}><td className="good-t">added</td><td className="mono">{x.san}</td><td className="muted mono">{x.fen.split(" ")[0]}</td><td>{x.status}</td></tr>)}
            {(diff.removed_sample || []).map((x: any, i: number) => <tr key={"r" + i}><td className="bad-t">removed</td><td className="mono">{x.san}</td><td className="muted mono">{x.fen.split(" ")[0]}</td><td /></tr>)}
            {(diff.changed_sample || []).map((x: any, i: number) => <tr key={"c" + i}><td>changed</td><td className="mono">{x.san}</td><td className="muted">weight {+x.old_weight.toFixed(3)} → {+x.new_weight.toFixed(3)}</td><td>{x.old_status} → {x.new_status}</td></tr>)}</tbody></table></div>
        </Modal>)}
    </div>
  );
}

function FilterForm({ onRun }: { onRun: (b: any) => void }) {
  const [f, setF] = useState<any>({ max_ply: 30, min_weight: 0, min_games: 0, top_n: 0, color: "", as_new: true });
  return <div className="col"><div className="grid g4">
    <Field label="Max ply"><Num value={f.max_ply} min={1} onChange={(v) => setF({ ...f, max_ply: v })} /></Field><Field label="Min weight"><Num value={f.min_weight} min={0} step={0.1} onChange={(v) => setF({ ...f, min_weight: v })} /></Field>
    <Field label="Min games"><Num value={f.min_games} min={0} onChange={(v) => setF({ ...f, min_games: v })} /></Field><Field label="Top N moves"><Num value={f.top_n} min={0} onChange={(v) => setF({ ...f, top_n: v })} /></Field></div>
    <div className="row"><Select value={f.color} onChange={(v) => setF({ ...f, color: v })} options={[["", "Filter both sides"], ["white", "Filter White's moves, keep all replies"], ["black", "Filter Black's moves, keep all replies"]]} style={{ maxWidth: 300 }} />
      <label className="check"><input type="checkbox" checked={f.as_new} onChange={(e) => setF({ ...f, as_new: e.target.checked })} /><span>as a new book</span></label>
      <button className="btn" onClick={() => onRun({ ...f, top_n: f.top_n || null, color: f.color || null })}>Filter</button></div></div>;
}

function Proposals({ proposals, onDecide }: { proposals: any[]; onDecide: (d: Record<string, string>) => void }) {
  const [d, setD] = useState<Record<string, string>>({});
  return <div><table className="t"><thead><tr><th>Change</th><th>Line</th><th>Reason</th><th>Viability</th><th>Confidence</th><th>Fit</th><th>Decision</th></tr></thead><tbody>{proposals.map((p) => (
    <tr key={p.id}><td><span className={`pill ${p.type === "reject" ? "bad" : p.type === "add" ? "good" : ""}`}>{p.type}</span></td><td className="mono">{p.line_san || p.san}</td><td>{p.reason}</td>
      <td>{(+p.viability).toFixed(2)}</td><td>{(+p.confidence).toFixed(2)}</td><td className="muted">{p.suits_profile}</td>
      <td className="nowrap"><button className={`btn xs ${d[p.id] === "approve" ? "on" : ""}`} onClick={() => setD({ ...d, [p.id]: "approve" })}>Approve</button>{" "}<button className={`btn xs ${d[p.id] === "reject" ? "on" : ""}`} onClick={() => setD({ ...d, [p.id]: "reject" })}>Decline</button></td></tr>))}</tbody></table>
    <div className="row" style={{ marginTop: 10, justifyContent: "flex-end" }}><span className="help grow">Approved changes are committed together as one new version with links to their research evidence.</span>
      <button className="btn primary" disabled={!Object.keys(d).length} onClick={() => onDecide(d)}>Apply {Object.keys(d).length} decision(s)</button></div></div>;
}
