// Broadcast studio: consented, read-only spectator links for games, tournaments and playback, with OBS guidance.
import { useEffect, useState } from "react";
import { api, useApi } from "../api";
import { act, ago, title, useStore } from "../store";
import { Check, Field, Panel, Select } from "../ui/ui";

const TOGGLES: [string, string, string][] = [["show_eval", "Engine evaluation", "Evaluation bar and score."], ["show_pv", "Principal variation", "The engine's expected line."],
  ["show_arrows", "Arrows", "Only arrows you publish — private annotations are never sent."], ["show_clock", "Clocks", ""], ["show_standings", "Tournament standings", ""],
  ["show_opening", "Opening name", ""], ["show_engine", "Engine name", ""], ["transparent", "Transparent background", "For compositing in OBS."]];

export default function Broadcast() {
  const { meta, takeHandoff, toast } = useStore();
  const list = useApi<any[]>("/api/broadcasts", { interval: 4000 });
  const play = useApi<any>("/api/play"); const tours = useApi<any[]>("/api/tournaments");
  const [src, setSrc] = useState<{ kind: string; id: string }>({ kind: "play", id: "" });
  const [titleText, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [cfg, setCfg] = useState<any>({ theme: "tournament_broadcast", show_eval: true, show_pv: false, show_arrows: true, show_clock: true, show_standings: true, show_opening: true, show_engine: true, transparent: false, orientation: "white" });
  useEffect(() => { const h = takeHandoff(); if (h?.tournamentId) { setSrc({ kind: "tournament", id: h.tournamentId }); setTitle(h.title || ""); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const origin = location.origin;
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast("Link copied", "ok"), () => toast(t));
  const needsId = src.kind === "play" || src.kind === "tournament";
  return (
    <div className="view">
      <div className="view-head"><div><h1>Broadcast Studio</h1><div className="sub">Publish one chosen game to a read-only spectator page. Nothing is public until you say so, and spectators can never control engines or hardware.</div></div></div>
      <div className="grid g2">
        <Panel title="New broadcast">
          <div className="col">
            <Field label="Title"><input type="text" value={titleText} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday engine tournament" /></Field>
            <div className="grid g2">
              <Field label="What to show"><Select value={src.kind} onChange={(kind) => setSrc({ kind, id: "" })} options={[["play", "My game against an engine"], ["tournament", "An engine tournament"], ["playback", "Opening playback"], ["manual", "Positions I push from the app"]]} /></Field>
              {src.kind === "play" && <Field label="Game"><select value={src.id} onChange={(e) => setSrc({ ...src, id: e.target.value })}><option value="">choose…</option>{(play.data?.active || []).map((g: any) => <option key={g.id} value={g.id}>vs {g.engine_name} · {g.sans.length} moves</option>)}</select></Field>}
              {src.kind === "tournament" && <Field label="Tournament"><select value={src.id} onChange={(e) => setSrc({ ...src, id: e.target.value })}><option value="">choose…</option>{(tours.data || []).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.status})</option>)}</select></Field>}
            </div>
            {src.kind === "play" && !play.data?.active?.length && <div className="help">No game is in progress. Start one in Play, then come back.</div>}
            <Field label="Spectator theme"><Select value={cfg.theme} onChange={(theme) => setCfg({ ...cfg, theme })} options={(meta?.broadcast_themes || []).map((t: string) => [t, title(t)])} /></Field>
            <div className="grid g2">{TOGGLES.map(([k, l, h]) => <Check key={k} checked={cfg[k]} onChange={(v) => setCfg({ ...cfg, [k]: v })} label={l} help={h || undefined} />)}</div>
            <div className="note warn"><Check checked={consent} onChange={setConsent} label={<b>I want to publish this</b>} help="Anyone who has the link can watch the position, moves and whatever is switched on above. Private research, notes and hardware controls are never included." /></div>
            <div><button className="btn primary" disabled={!consent || (needsId && !src.id)} onClick={() => act(async () => { await api.post("/api/broadcasts", { title: titleText, source: src, config: cfg, consent: true }); setConsent(false); list.reload(); }, "Broadcast is live")}>Start publishing</button></div>
          </div>
        </Panel>
        <Panel title="Streaming to YouTube or Twitch" hint="video is produced by your encoder">
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Start a broadcast here and copy its <b>OBS link</b>.</li>
            <li>In OBS Studio add a <b>Browser</b> source, paste the link, and set the size (for example 1920 × 1080). Tick “Transparent background” here if you want to place the board over your own scene.</li>
            <li>In OBS → Settings → Stream choose YouTube or Twitch and sign in or paste your stream key, then press <b>Start Streaming</b>.</li>
            <li>Optional: OBS → Tools → WebSocket Server Settings lets other tools switch scenes; this app does not need it.</li>
          </ol>
          <p className="help" style={{ marginTop: 8 }}>Changing a position here does not by itself create a livestream — OBS (or another encoder) captures the spectator page and delivers the video to the platform. On another device in your network, open the same link with this computer's address instead of “localhost”.</p>
        </Panel>
      </div>
      <Panel title="Broadcasts" className="" hint="spectator links need no token and are read-only">
        <table className="t"><thead><tr><th>Title</th><th>Source</th><th>Theme</th><th>Status</th><th>Viewers</th><th>Links</th><th /></tr></thead><tbody>{(list.data || []).map((b) => (
          <tr key={b.id}><td><b>{b.title}</b><div className="muted" style={{ fontSize: 12 }}>{ago(b.created_at)}</div></td><td>{title(b.config.source.kind)}</td>
            <td><select value={b.config.theme} onChange={(e) => act(async () => { await api.patch(`/api/broadcasts/${b.id}`, { config: { theme: e.target.value } }); list.reload(); })}>{(meta?.broadcast_themes || []).map((t: string) => <option key={t} value={t}>{title(t)}</option>)}</select></td>
            <td><span className={`pill ${b.active ? "good" : ""}`}>{b.active ? "live" : "stopped"}</span></td><td>{b.viewers}</td>
            <td className="nowrap"><button className="btn xs" onClick={() => copy(origin + b.path)}>Copy spectator link</button>{" "}<button className="btn xs" onClick={() => copy(origin + b.obs_path)}>Copy OBS link</button>{" "}<a className="btn xs" href={b.path} target="_blank" rel="noreferrer">Open</a></td>
            <td className="right nowrap">
              <button className="btn xs" onClick={() => act(async () => { await api.patch(`/api/broadcasts/${b.id}`, { config: { show_eval: !b.config.show_eval } }); list.reload(); })}>{b.config.show_eval ? "Hide eval" : "Show eval"}</button>{" "}
              <button className="btn xs" onClick={() => act(async () => { await api.patch(`/api/broadcasts/${b.id}`, { active: !b.active }); list.reload(); })}>{b.active ? "Stop" : "Resume"}</button>{" "}
              <button className="btn xs ghost" onClick={() => act(async () => { await api.del(`/api/broadcasts/${b.id}`); list.reload(); })}>Delete</button></td></tr>))}</tbody></table>
        {!list.data?.length && <div className="empty">Nothing is being published.</div>}
      </Panel>
    </div>
  );
}
