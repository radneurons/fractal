// Chess widgets shared across views: evaluation bar/graph, move lists, clocks and the Clock Designer.
import { useEffect, useRef, useState } from "react";
import { act, fmtMs, useStore } from "../store";
import { api } from "../api";
import { Check, Field, Num, Select } from "../ui/ui";
import type { TNode } from "./tree";
import { GameTree } from "./tree";

export function EvalBar({ expected, text, orientation = "white" }: { expected: number | null | undefined; text?: string | null; orientation?: "white" | "black" }) {
  const e = expected == null ? 0.5 : Math.max(0.02, Math.min(0.98, expected));
  const h = orientation === "white" ? e : 1 - e;
  const whiteBetter = e >= 0.5;
  return (
    <div className="evalbar" title={text ? `Evaluation ${text} (White's point of view)` : "No evaluation yet"} aria-label="Evaluation bar">
      <i style={{ height: `${h * 100}%`, background: orientation === "white" ? "#efe9dd" : "#2a2622" }} />
      <span style={{ position: "absolute", inset: 0, background: orientation === "white" ? undefined : "#efe9dd", zIndex: -1 }} />
      {text && <b className={(whiteBetter ? orientation === "white" : orientation !== "white") ? "" : "top"}>{text.replace("+", "")}</b>}
    </div>
  );
}

export function EvalGraph({ points, current, onPick, height = 70 }: { points: (number | null)[]; current?: number; onPick?: (i: number) => void; height?: number }) {
  const w = 600, n = Math.max(points.length, 2);
  const xs = (i: number) => (i / (n - 1)) * w;
  const ys = (v: number | null) => height - (v == null ? 0.5 : v) * height;
  let d = `M0 ${height / 2}`;
  points.forEach((p, i) => { d += ` L${xs(i).toFixed(1)} ${ys(p).toFixed(1)}`; });
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block", borderRadius: 8, background: "#2a2622", cursor: onPick ? "pointer" : "default" }}
      onClick={(e) => { if (!onPick) return; const r = e.currentTarget.getBoundingClientRect(); onPick(Math.round(((e.clientX - r.left) / r.width) * (n - 1))); }}>
      <path d={`${d} L${w} ${height} L0 ${height} Z`} fill="#efe9dd" opacity="0.92" />
      <line x1="0" x2={w} y1={height / 2} y2={height / 2} stroke="#c9a45c" strokeWidth="1" opacity="0.6" />
      {current != null && current >= 0 && <line x1={xs(current)} x2={xs(current)} y1="0" y2={height} stroke="#d2584f" strokeWidth="2" />}
    </svg>
  );
}

const NAG: Record<number, string> = { 1: "!", 2: "?", 3: "!!", 4: "??", 5: "!?", 6: "?!", 10: "=", 13: "∞", 14: "⩲", 15: "⩱", 16: "±", 17: "∓", 18: "+−", 19: "−+", 146: "N" };

/** Move list with nested variations for a GameTree. */
export function TreeMoves({ tree, onGoto, onContext, labels }: { tree: GameTree; onGoto: (n: TNode) => void; onContext?: (n: TNode, e: React.MouseEvent) => void;
  labels?: Record<number, string> }) {
  const cur = tree.current;
  const startNo = parseInt(tree.root.fen.split(" ")[5] || "1", 10);
  const startWhite = tree.root.fen.split(" ")[1] !== "b";
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector(".mv.cur")?.scrollIntoView({ block: "nearest" }); }, [cur]);
  const render = (node: TNode, ply: number, force: boolean): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const [main, ...vars] = node.children;
    if (!main) return out;
    const white = (ply % 2 === 0) === startWhite;
    const no = startNo + Math.floor((ply + (startWhite ? 0 : 1)) / 2);
    const tok = (n: TNode, f: boolean) => (
      <span key={n.id}>
        {(white || f) && <span className="num">{no}{white ? "." : "…"}</span>}
        <span className={`mv ${n === cur ? "cur" : ""} ${labels?.[n.id] ? "cls-" + labels[n.id] : ""}`} onClick={() => onGoto(n)}
          onContextMenu={(e) => { if (onContext) { e.preventDefault(); onContext(n, e); } }}>{n.san}{n.nags.map((g) => NAG[g] || "").join("")}</span>{" "}
        {n.comment && <span className="cmt">{n.comment} </span>}
      </span>);
    out.push(tok(main, force));
    for (const v of vars) out.push(<span className="var" key={"v" + v.id}>{tok(v, true)}{render(v, ply + 1, false)}</span>, " ");
    out.push(...render(main, ply + 1, vars.length > 0 || !!main.comment));
    return out;
  };
  return <div className="moves" ref={ref}>{tree.root.children.length ? render(tree.root, 0, true) : <span className="muted">No moves yet — play on the board or paste a PGN.</span>}</div>;
}

/** Flat SAN list (games in progress, spectator view). */
export function SanList({ sans, startFen, current, onPick, annotations }: { sans: string[]; startFen?: string; current?: number; onPick?: (ply: number) => void;
  annotations?: Record<number, string> }) {
  const parts = (startFen || "").split(" ");
  const startWhite = parts[1] !== "b"; const startNo = parseInt(parts[5] || "1", 10);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector(".mv.cur")?.scrollIntoView({ block: "nearest" }); }, [current, sans.length]);
  return (
    <div className="moves" ref={ref}>
      {sans.map((s, i) => {
        const white = (i % 2 === 0) === startWhite;
        const no = startNo + Math.floor((i + (startWhite ? 0 : 1)) / 2);
        return <span key={i}>{(white || i === 0) && <span className="num">{no}{white ? "." : "…"}</span>}
          <span className={`mv ${current === i + 1 ? "cur" : ""} ${annotations?.[i + 1] ? "cls-" + annotations[i + 1] : ""}`} onClick={() => onPick?.(i + 1)}>{s}</span>{" "}</span>;
      })}
      {!sans.length && <span className="muted">Game start</span>}
    </div>
  );
}

/** Live clock driven by the bridge's authoritative snapshot (interpolated locally between updates). */
export function ClockFace({ snap, side, name, big = true }: { snap: any; side: "white" | "black"; name?: string; big?: boolean }) {
  const [, tick] = useState(0);
  const offset = useRef(0);
  useEffect(() => { if (snap?.server_time) offset.current = Date.now() / 1000 - snap.server_time; }, [snap?.server_time]);
  const running = snap && snap.running === side && !snap.frozen && snap.started;
  useEffect(() => { if (!running) return; const id = setInterval(() => tick((x) => x + 1), 100); return () => clearInterval(id); }, [running]);
  if (!snap) return null;
  const s = snap[side];
  let ms: number | null = s.ms;
  if (ms != null && running) {
    const elapsed = (Date.now() / 1000 - offset.current - snap.server_time) * 1000;
    const delayLeft = Math.max(0, (snap.delay_left_ms || 0) - elapsed);
    ms = Math.max(0, ms - Math.max(0, elapsed - (snap.delay_left_ms || 0)));
    if (delayLeft > 0) ms = s.ms;
  }
  const holds = snap.running === side ? Object.keys(snap.holds || {}) : [];
  const holdText: Record<string, string> = { sync: "waiting for board", robot: "robot moving", pause: "paused", setup: "setup time" };
  return (
    <div className={`clock ${running ? "run" : ""} ${s.low ? "low" : ""} ${s.flagged ? "flag" : ""} ${holds.length ? "hold" : ""}`} style={big ? undefined : { fontSize: 20, minWidth: 100, padding: "3px 9px" }}
      aria-label={`${side} clock`}>
      {name && <small>{name}{s.allowance ? " · hand-move allowance" : ""}</small>}
      {fmtMs(ms)}
      <small>{holds.length ? holds.map((h) => holdText[h] || h).join(", ") : s.flagged ? "flag fell" :
        [s.increment_ms ? `+${s.increment_ms / 1000}s` : "", s.delay_ms ? `${s.delay_type} delay ${s.delay_ms / 1000}s` : "", s.moves_to_control ? `${s.moves_to_control} to control` : ""].filter(Boolean).join(" · ") || " "}</small>
    </div>
  );
}

// ---------------------------------------------------------------- Clock Designer
export type ClockConfig = any;
const blankStage = () => ({ moves: null as number | null, base_ms: 600_000, increment_ms: 0, delay_ms: 0, delay_type: "none" });
export const DEFAULT_CLOCK: ClockConfig = { kind: "standard", name: "Rapid 10+5", stages: [{ ...blankStage(), increment_ms: 5000 }], flag_policy: "lose", label: "casual",
  physical: { enabled: false, per_move_allowance_ms: 0, start_delay_ms: 0, pause_for_sync: false, sync_cap_ms: 60000, setup_allowance_ms: 0, applies_to: "human", only_without_robot: true },
  robot: { policy: "pause_during_motion" } };

export function describeClock(c: ClockConfig): string {
  if (!c || c.kind === "unlimited") return "No clock";
  if (c.kind === "per_move") return `${c.per_move_ms / 1000}s for every move`;
  if (c.kind === "correspondence") return `${(c.per_move_ms / 86_400_000).toFixed(1)} day(s) per move`;
  const st = (s: any) => `${s.moves ? s.moves + " moves in " : ""}${s.base_ms / 60000 >= 1 ? +(s.base_ms / 60000).toFixed(2) + " min" : s.base_ms / 1000 + " s"}` +
    (s.increment_ms ? ` +${s.increment_ms / 1000}s` : "") + (s.delay_ms && s.delay_type !== "none" ? `, ${s.delay_type} delay ${s.delay_ms / 1000}s` : "");
  const side = (stages: any[]) => stages.map(st).join(", then ");
  let text = c.white || c.black ? `White ${side(c.white || c.stages)} · Black ${side(c.black || c.stages)}` : side(c.stages || [blankStage()]);
  if (c.kind === "hourglass") text = "Hourglass: " + text;
  const p = c.physical;
  if (p?.enabled) {
    const bits = [p.per_move_allowance_ms ? `+${p.per_move_allowance_ms / 1000}s per hand move` : "", p.start_delay_ms ? `${p.start_delay_ms / 1000}s grace` : "",
      p.pause_for_sync ? "pause while relaying" : "", p.setup_allowance_ms ? `${p.setup_allowance_ms / 1000}s setup` : ""].filter(Boolean);
    if (bits.length) text += ` · physical: ${bits.join(", ")}`;
  }
  return text;
}

function StageRow({ s, onChange, onRemove, last }: { s: any; onChange: (s: any) => void; onRemove?: () => void; last: boolean }) {
  const min = Math.floor(s.base_ms / 60000), sec = Math.round((s.base_ms % 60000) / 1000);
  return (
    <div className="row nowrap" style={{ alignItems: "flex-end" }}>
      <Field label={last ? "Then" : "Moves"} className="grow">{last
        ? <input type="text" value="rest of the game" disabled />
        : <Num value={s.moves || 40} min={1} onChange={(v) => onChange({ ...s, moves: v })} />}</Field>
      <Field label="Minutes"><Num value={min} min={0} style={{ width: 74 }} onChange={(v) => onChange({ ...s, base_ms: v * 60000 + sec * 1000 })} /></Field>
      <Field label="Seconds"><Num value={sec} min={0} max={59} style={{ width: 70 }} onChange={(v) => onChange({ ...s, base_ms: min * 60000 + v * 1000 })} /></Field>
      <Field label="Increment s"><Num value={s.increment_ms / 1000} min={0} step={0.5} style={{ width: 80 }} onChange={(v) => onChange({ ...s, increment_ms: Math.round(v * 1000) })} /></Field>
      <Field label="Delay"><Select value={s.delay_type} onChange={(v) => onChange({ ...s, delay_type: v, delay_ms: v === "none" ? 0 : s.delay_ms || 5000 })}
        options={[["none", "none"], ["simple", "simple (US)"], ["bronstein", "Bronstein"]]} style={{ width: 120 }} /></Field>
      <Field label="Delay s"><Num value={s.delay_ms / 1000} min={0} step={0.5} style={{ width: 70 }} onChange={(v) => onChange({ ...s, delay_ms: Math.round(v * 1000), delay_type: v > 0 && s.delay_type === "none" ? "simple" : s.delay_type })} /></Field>
      {onRemove && <button className="btn sm ghost" onClick={onRemove} title="Remove stage">✕</button>}
    </div>
  );
}

export function ClockDesigner({ value, onChange, physicalAvailable, robotAvailable }: { value: ClockConfig; onChange: (c: ClockConfig) => void;
  physicalAvailable?: boolean; robotAvailable?: boolean }) {
  const meta = useStore((s) => s.meta);
  const [custom, setCustom] = useState<any[]>([]);
  useEffect(() => { api.get("/api/clock/presets").then((r) => setCustom(r.custom)).catch(() => undefined); }, []);
  const c = { ...DEFAULT_CLOCK, ...value, physical: { ...DEFAULT_CLOCK.physical, ...(value.physical || {}) }, robot: { ...DEFAULT_CLOCK.robot, ...(value.robot || {}) } };
  const set = (patch: any) => onChange({ ...c, ...patch, name: patch.name ?? "Custom" });
  const asym = !!(c.white || c.black);
  const stagesOf = (side?: "white" | "black") => (side ? c[side] : c.stages) || c.stages || [blankStage()];
  const setStages = (side: "white" | "black" | undefined, st: any[]) => {
    st = st.map((s, i) => ({ ...s, moves: i === st.length - 1 ? null : s.moves || 40 }));
    set(side ? { [side]: st } : { stages: st });
  };
  const presets: any[] = [...(meta?.clock_presets || []), ...custom];
  const groups = [...new Set(presets.map((p) => p.group || "Other"))];
  const ph = c.physical;
  const setPh = (p: any) => set({ physical: { ...ph, ...p } });
  const timed = c.kind === "standard" || c.kind === "hourglass";
  const stageEditor = (side?: "white" | "black") => {
    const st = stagesOf(side);
    return (
      <div className="col">
        {side && <span className="label">{side}</span>}
        {st.map((s: any, i: number) => <StageRow key={i} s={s} last={i === st.length - 1 && st.length > 1} onChange={(n) => setStages(side, st.map((x: any, k: number) => (k === i ? n : x)))}
          onRemove={st.length > 1 ? () => setStages(side, st.filter((_: any, k: number) => k !== i)) : undefined} />)}
        <div><button className="btn xs" onClick={() => setStages(side, [...st.slice(0, -1), { ...st[st.length - 1], moves: 40 }, { ...blankStage(), base_ms: 1_800_000 }])}>+ add time control stage</button></div>
      </div>);
  };
  return (
    <div className="col gap-lg">
      <div className="grid g2">
        <Field label="Preset">
          <select value="" onChange={(e) => { const p = presets.find((x) => x.name === e.target.value); if (p) onChange({ ...DEFAULT_CLOCK, ...p, physical: { ...DEFAULT_CLOCK.physical, ...(p.physical || {}) }, robot: c.robot }); }}>
            <option value="">{c.name || "Custom"} — change…</option>
            {groups.map((g) => <optgroup key={g} label={g}>{presets.filter((p) => (p.group || "Other") === g).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>)}
          </select>
        </Field>
        <Field label="Clock type">
          <Select value={c.kind} onChange={(v) => set({ kind: v })} options={[["unlimited", "Unlimited (no clock)"], ["standard", "Standard (base + increment / delay / stages)"],
            ["hourglass", "Hourglass (your time flows to the opponent)"], ["per_move", "Fixed time per move"], ["correspondence", "Correspondence (days per move)"]]} />
        </Field>
      </div>
      {timed && (<>
        {asym ? <div className="grid g2">{stageEditor("white")}{stageEditor("black")}</div> : stageEditor()}
        <Check checked={asym} onChange={(v) => v ? set({ white: c.stages, black: c.stages }) : (() => { const { white, black, ...rest } = c; onChange({ ...rest, stages: white || c.stages, name: "Custom" }); })()}
          label="Different time for each side (time odds)" />
      </>)}
      {c.kind === "per_move" && <Field label="Seconds per move"><Num value={c.per_move_ms / 1000} min={1} onChange={(v) => set({ per_move_ms: v * 1000 })} /></Field>}
      {c.kind === "correspondence" && <Field label="Days per move"><Num value={c.per_move_ms / 86_400_000} min={0.01} step={0.5} onChange={(v) => set({ per_move_ms: Math.round(v * 86_400_000) })} /></Field>}
      {c.kind !== "unlimited" && (
        <div className="grid g2">
          <Field label="When time runs out"><Select value={c.flag_policy} onChange={(v) => set({ flag_policy: v })}
            options={[["lose", "Loss on time (normal rules)"], ["continue", "Flag is recorded, game continues (training)"]]} /></Field>
          <Field label="Rules label" help={c.label === "official" ? "Official: pausing, take-backs and manual adjustments are disabled." : "Casual / training: pausing and adjusting are allowed."}>
            <Select value={c.label} onChange={(v) => set({ label: v })} options={[["casual", "Casual / training clock"], ["official", "Official competition clock"]]} /></Field>
        </div>)}
      {c.kind !== "unlimited" && (
        <div className="panel tight" style={{ borderColor: ph.enabled ? "var(--brass)" : undefined }}>
          <Check checked={ph.enabled} onChange={(v) => setPh({ enabled: v })} label={<b>Human Physical Move Allowance</b>}
            help="Extra time for a person who has to move the pieces by hand on a non-robotic board (your own move and the engine's reply). A casual/training aid — not part of official rules." />
          {ph.enabled && (
            <div className="col" style={{ marginTop: 10 }}>
              {physicalAvailable === false && <div className="note warn">No physical board is in use for this game, so the allowance will not apply.</div>}
              <div className="grid g3">
                <Field label="Bonus per hand move (s)" help="Added to your clock after each of your moves."><Num value={ph.per_move_allowance_ms / 1000} min={0} step={1} onChange={(v) => setPh({ per_move_allowance_ms: Math.round(v * 1000) })} /></Field>
                <Field label="Grace before clock starts (s)" help="Your clock waits this long at the start of every turn."><Num value={ph.start_delay_ms / 1000} min={0} step={0.5} onChange={(v) => setPh({ start_delay_ms: Math.round(v * 1000) })} /></Field>
                <Field label="Setup allowance (s)" help="One-off time to set up the pieces before move one."><Num value={ph.setup_allowance_ms / 1000} min={0} step={10} onChange={(v) => setPh({ setup_allowance_ms: Math.round(v * 1000) })} /></Field>
              </div>
              <div className="grid g2">
                <Check checked={ph.pause_for_sync} onChange={(v) => setPh({ pause_for_sync: v })} label="Pause my clock while I place the engine's move"
                  help="Your clock only starts once the sensors confirm the engine's move is on the board." />
                <Field label="Longest pause per move (s, 0 = no limit)"><Num value={ph.sync_cap_ms / 1000} min={0} step={5} onChange={(v) => setPh({ sync_cap_ms: Math.round(v * 1000) })} /></Field>
              </div>
              <div className="grid g2">
                <Field label="Applies to"><Select value={ph.applies_to} onChange={(v) => setPh({ applies_to: v })} options={[["human", "The human player only"], ["both", "Both sides"]]} /></Field>
                <Check checked={ph.only_without_robot} onChange={(v) => setPh({ only_without_robot: v })} label="Only when Chessnut Move is not moving the pieces"
                  help="With a robotic board the pieces move themselves, so no hand-move time is needed." />
              </div>
            </div>)}
        </div>)}
      {c.kind !== "unlimited" && (robotAvailable ?? true) && (
        <Field label="Chessnut Move: how is the robot's movement time counted?">
          <div className="col">
            {([["continue", "Clock continues during physical movement", "The engine is charged for the time its move takes to be executed."],
              ["pause_during_motion", "Clock pauses for mechanical execution", "Both clocks stand still while the pieces are moving."],
              ["engine_thinking_only", "Engine thinking is timed, mechanical execution is not", "The engine is charged exactly its own reported search time; your clock starts when the move is verified."]] as const).map(([k, l, h]) => (
              <label key={k} className="check"><input type="radio" name="robotpol" checked={c.robot.policy === k} onChange={() => set({ robot: { policy: k } })} /><span>{l}<small>{h}</small></span></label>))}
          </div>
        </Field>)}
      <div className="row">
        <span className="note grow"><b>{c.name || "Custom"}:</b> {describeClock(c)}</span>
        <button className="btn sm" onClick={async () => {
          const name = prompt("Name for this clock preset:", c.name && c.name !== "Custom" ? c.name : "My clock"); if (!name) return;
          const next = [...custom.filter((x) => x.name !== name), { ...c, name }];
          const r = await act(() => api.put("/api/clock/presets", next), "Clock preset saved");
          if (r) { setCustom(r.custom); onChange({ ...c, name }); }
        }}>Save as preset</button>
      </div>
    </div>
  );
}
