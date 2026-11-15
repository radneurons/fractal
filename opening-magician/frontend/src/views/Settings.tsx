// Settings: visual themes, piece sets, graphics quality, focus mode, backups and the portable project package.
import { useRef, useState } from "react";
import { api, setToken, getToken } from "../api";
import Board from "../chess/Board";
import { PIECE_SETS_2D, PieceIcon } from "../chess/pieces2d";
import { PIECE_SETS_3D } from "../chess/three/pieces3d";
import { THEMES_3D } from "../chess/three/themes3d";
import { act, GraphicsQuality, QUALITY_PRESETS, title, useStore } from "../store";
import { Check, Field, Modal, Panel, Select, Tabs } from "../ui/ui";

export default function Settings() {
  const { prefs, setPrefs, setGraphics, meta, bridge, toast } = useStore();
  const [tab, setTab] = useState<"look" | "graphics" | "data" | "about">("look");
  const [pkg, setPkg] = useState<{ file: File; info: any } | null>(null);
  const g = prefs.graphics;
  const fen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQkq - 0 5";
  return (
    <div className="view">
      <div className="view-head"><div><h1>Settings</h1><div className="sub">Cinematic when you want atmosphere, focused when you want to work.</div></div></div>
      <Tabs value={tab} onChange={setTab} items={[["look", "Themes & pieces"], ["graphics", "Graphics"], ["data", "Backup & project"], ["about", "About"]]} />
      {tab === "look" && (
        <div className="split">
          <div className="col"><Board fen={fen} movable="none" arrows={[{ from: "c4", to: "f7" }]} />
            <div className="row"><button className={`btn ${prefs.boardMode === "2d" ? "on" : ""}`} onClick={() => setPrefs({ boardMode: "2d" })}>2D board</button>
              <button className={`btn ${prefs.boardMode === "3d" ? "on" : ""}`} onClick={() => setPrefs({ boardMode: "3d" })}>3D board</button>
              <span className="help">In 3D: drag to orbit, wheel to zoom, double-click a piece to inspect it.</span></div></div>
          <div className="col gap-lg">
            <Panel title="Environment">
              <div className="grid g2">{THEMES_3D.map((t) => (
                <button key={t.id} className="card" style={prefs.theme === t.id ? { borderColor: "var(--brass)", background: "color-mix(in srgb, var(--brass) 12%, var(--panel))" } : undefined} onClick={() => setPrefs({ theme: t.id })}><b>{t.name}</b><small>{t.note}</small></button>))}</div>
              <p className="help" style={{ marginTop: 8 }}>A theme changes the 3D scene, the 2D board colours and the interface accents together. Every theme keeps light and dark squares clearly apart.</p>
            </Panel>
            <Panel title="2D pieces">
              <div className="grid g4">{PIECE_SETS_2D.map((s) => (
                <button key={s.id} className="card" title={s.note} style={prefs.pieces2d === s.id ? { borderColor: "var(--brass)" } : undefined} onClick={() => setPrefs({ pieces2d: s.id })}>
                  <div className="row nowrap" style={{ background: "var(--sq-dark)", borderRadius: 6, padding: 2, justifyContent: "center" }}><PieceIcon piece="N" set={s.id} size={34} /><PieceIcon piece="q" set={s.id} size={34} /></div><b style={{ fontSize: 13, marginTop: 6 }}>{s.name}</b></button>))}</div>
              <p className="help" style={{ marginTop: 8 }}>The sets share one family of original silhouettes drawn for this app and differ in rendering; the Accessibility set uses letter tokens with a different shape per side.</p>
            </Panel>
            <Panel title="3D pieces">
              <div className="grid g3">{PIECE_SETS_3D.map((s) => (
                <button key={s.id} className="card" style={prefs.pieces3d === s.id ? { borderColor: "var(--brass)" } : undefined} onClick={() => setPrefs({ pieces3d: s.id, boardMode: "3d" })}><b style={{ fontSize: 13.5 }}>{s.name}</b><small>{s.note}</small></button>))}</div>
              <p className="help" style={{ marginTop: 8 }}>All 3D pieces are modelled procedurally in the app: lathe-turned bodies, a sculpted knight, real crenellations and crowns. Six sets share the Staunton geometry with different materials; the architectural set has its own faceted shapes.</p>
            </Panel>
            <Panel title="Board behaviour">
              <div className="grid g2">
                <Check checked={prefs.focus} onChange={(v) => setPrefs({ focus: v })} label="Focused professional mode" help="Compact navigation and no decorative motion — for long analysis sessions." />
                <Check checked={prefs.coordinates} onChange={(v) => setPrefs({ coordinates: v })} label="Show coordinates" />
                <Check checked={prefs.legalDots} onChange={(v) => setPrefs({ legalDots: v })} label="Show legal-move markers" />
                <Check checked={!prefs.introSeen} onChange={(v) => setPrefs({ introSeen: !v })} label="Play the opening camera move on Home again" />
              </div>
            </Panel>
          </div>
        </div>)}
      {tab === "graphics" && (
        <div className="grid g2">
          <Panel title="Quality">
            <div className="grid g2">{(Object.keys(QUALITY_PRESETS) as GraphicsQuality[]).map((q) => (
              <button key={q} className="card" style={g.quality === q ? { borderColor: "var(--brass)", background: "color-mix(in srgb, var(--brass) 12%, var(--panel))" } : undefined} onClick={() => setPrefs({ graphics: { quality: q, ...QUALITY_PRESETS[q] } })}>
                <b>{title(q)}</b><small>{{ performance: "Fastest. No shadows or effects; 2D on Home.", balanced: "Shadows, antialiasing and reflections.", cinematic: "Adds bloom and depth of field.", ultra: "Everything, at the highest resolution." }[q]}</small></button>))}</div>
          </Panel>
          <Panel title="Fine control">
            <div className="grid g2">
              <Check checked={g.shadows} onChange={(v) => setGraphics({ shadows: v })} label="Shadows" />
              <Check checked={g.antialias} onChange={(v) => setGraphics({ antialias: v })} label="Antialiasing" help="Changing this restarts the 3D view." />
              <Check checked={g.reflections} onChange={(v) => setGraphics({ reflections: v })} label="Environment reflections" help="Physically based materials reflect a studio environment." />
              <Check checked={g.bloom} onChange={(v) => setGraphics({ bloom: v })} label="Bloom" help="Kept subtle so pieces stay readable." />
              <Check checked={g.ao} onChange={(v) => setGraphics({ ao: v })} label="Ambient occlusion" help="Costly; best on a dedicated GPU." />
              <Check checked={g.dof} onChange={(v) => setGraphics({ dof: v })} label="Depth of field" />
              <Field label={`Rendering resolution ×${g.resolution.toFixed(2)}`}><input type="range" min={0.5} max={2} step={0.25} value={g.resolution} onChange={(e) => setGraphics({ resolution: +e.target.value })} /></Field>
              <Field label="Animation"><Select value={g.animation} onChange={(animation) => setGraphics({ animation })} options={[["full", "Full"], ["reduced", "Reduced"], ["off", "Off"]]} /></Field>
            </div>
            <p className="help" style={{ marginTop: 8 }}>The 3D board renders only when something changes, so a still position costs almost nothing. Your system's “reduce motion” setting is respected.</p>
          </Panel>
        </div>)}
      {tab === "data" && (
        <div className="grid g2">
          <Panel title="Project package" hint="move everything to another computer">
            <p>One <span className="mono">.omproj</span> file with the database snapshot, PGNs, studies, opening books, research findings, training progress, preferences and engine settings.</p>
            <p className="help">Engine programs themselves are not included — their licences differ. Re-register them on the new computer; profiles and research stay attached.</p>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn primary" disabled={!bridge} onClick={() => act(() => api.download("/api/package/export", `opening-magician-${new Date().toISOString().slice(0, 10)}.omproj`), "Project package saved")}>Export project package</button>
              <label className="btn">Restore from a package…<input type="file" accept=".omproj,.zip" hidden onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; const info = await act(() => api.upload("/api/package/inspect", file)); if (info) setPkg({ file, info }); }} /></label>
            </div>
          </Panel>
          <Panel title="Database backup" hint="automatic every six hours">
            <p>Research runs on the bridge and is saved in a local database with write-ahead logging, so it survives a closed browser tab, a crash or a restart.</p>
            <button className="btn" disabled={!bridge} onClick={() => act(async () => { const r = await api.post("/api/backup"); toast(`Backup written to ${r.path} — integrity: ${r.integrity}`, "ok"); })}>Back up now</button>
            {meta && <p className="help" style={{ marginTop: 8 }}>Data folder: <span className="mono">{meta.data_dir}</span> · schema v{meta.schema_version}</p>}
          </Panel>
          <Panel title="Connection">
            <Field label="Admin token" help="Only needed when you open the app from another device (LAN or server mode). On this computer none is required.">
              <div className="row nowrap"><input type="text" defaultValue={getToken()} id="omtoken" placeholder="paste the token printed by the bridge" />
                <button className="btn" onClick={() => { setToken((document.getElementById("omtoken") as HTMLInputElement).value.trim()); location.reload(); }}>Save</button></div></Field>
            {meta && <p className="help" style={{ marginTop: 8 }}>Bridge mode: <b>{meta.mode}</b>. Spectator links work without a token and can only read a published broadcast.</p>}
          </Panel>
        </div>)}
      {tab === "about" && (
        <Panel title={`Opening Magician ${meta?.version || ""}`}>
          <p style={{ fontFamily: "var(--serif)", fontSize: 17, fontStyle: "italic" }}>{meta?.tagline || "Discover deeper. Train smarter. Play beyond theory."}</p>
          <p>A local-first chess research and training environment: native UCI engines, opening discovery, tournaments, books, studies, puzzles and Chessnut boards — no cloud service required.</p>
          <p className="help">{meta?.ai_commentary?.note} Chess rules: python-chess (bridge) and chess.js (interface). Chessnut support follows the manufacturer's published documentation for the Air family and the Move; anything it leaves open is listed in the Chessnut view and must be verified on real hardware.</p>
        </Panel>)}
      {pkg && (
        <Modal title="Restore this project?" onClose={() => setPkg(null)}>
          <p>Created with version {pkg.info.app_version} on {new Date(pkg.info.created_at * 1000).toLocaleString()}.</p>
          <table className="t"><tbody>{Object.entries(pkg.info.counts).map(([k, v]) => <tr key={k}><td>{title(k)}</td><td className="right"><b>{String(v)}</b></td></tr>)}</tbody></table>
          <div className="note warn" style={{ marginTop: 10 }}>Restoring replaces the current project. A backup of the current database is made first and kept in the data folder.</div>
          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}><button className="btn" onClick={() => setPkg(null)}>Cancel</button>
            <button className="btn danger" onClick={() => act(async () => { const r = await api.upload("/api/package/restore?confirm=true", pkg.file); setPkg(null); toast(r.engines_missing ? `Restored. ${r.engines_missing} engine(s) must be registered again on this computer.` : "Project restored", "ok"); setTimeout(() => location.reload(), 1200); })}>Replace current project</button></div>
        </Modal>)}
    </div>
  );
}
