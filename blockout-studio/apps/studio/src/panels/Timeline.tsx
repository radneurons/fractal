import React, { useMemo, useRef, useState } from 'react';
import { evalCamera, evalCharacter, newId, type Op, type Project, type Vec3 } from '@blockout/core';
import { S, useStudio, cutDuration } from '../store';
import { Toggle, fmtTime } from '../ui';

const LABEL_W = 132, ROW = 22;
/** Snap a time to frames, then (if enabled) to nearby markers / beats / other keys. */
function snapTime(p: Project, t: number, pxPerSec: number, on: boolean): number {
  t = Math.round(Math.max(0, t) * p.fps) / p.fps; if (!on) return t;
  let best = t, bd = 7 / pxPerSec;
  for (const m of Object.values(p.markers)) { const d = Math.abs(m.t - t); if (d < bd) { bd = d; best = m.t; } }
  for (const s of p.shots) for (const x of [s.start, s.end]) { const d = Math.abs(x - t); if (d < bd) { bd = d; best = x; } }
  return best;
}
function useDrag(onMove: (dx: number, e: PointerEvent) => void, onEnd?: () => void) {
  return (e: React.PointerEvent) => {
    if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); const x0 = e.clientX;
    const mv = (ev: PointerEvent) => onMove(ev.clientX - x0, ev), up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); onEnd?.(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
}

function Key({ t, color, selected, pps, title, onSelect, onMove, shape = 'diamond' }: { t: number; color: string; selected: boolean; pps: number; title: string; onSelect: () => void; onMove: (t: number) => void; shape?: 'diamond' | 'dot' }) {
  const drag = useDrag((dx) => { const s = S(); onMove(snapTime(s.project, t + dx / pps, pps, s.snap)); });
  return <button type="button" title={title} aria-label={title} data-key className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 outline-offset-2" style={{ left: t * pps, width: 11, height: 11 }} onPointerDown={(e) => { onSelect(); drag(e); }}>
    <span className={`block h-full w-full ${shape === 'diamond' ? 'rotate-45' : 'scale-75 rounded-full'} border`} style={{ background: color, borderColor: selected ? '#fff' : 'rgba(0,0,0,.5)', boxShadow: selected ? '0 0 0 1px #fff' : undefined }} />
  </button>;
}

function Playhead({ pps }: { pps: number }) {
  const t = useStudio((s) => s.t);
  return <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-bad" style={{ left: LABEL_W + t * pps }} data-testid="playhead"><div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-bad" /></div>;
}
function Timecode() { const t = useStudio((s) => s.t), fps = useStudio((s) => s.project.fps); return <span className="tabular-nums text-fg" data-testid="timecode">{fmtTime(t, fps)}</span>; }

function Curves({ pps, width }: { pps: number; width: number }) {
  const project = useStudio((s) => s.project), sel = useStudio((s) => s.selection), H = 96;
  const curves = useMemo(() => {
    const out: { name: string; color: string; pts: [number, number][]; unit: string; keys?: { id: string; t: number; v: number }[]; edit?: (keyId: string, v0: number, dy: number, scale: number) => Op }[] = [], N = Math.max(40, Math.min(400, Math.round(project.duration * 12)));
    const ts = Array.from({ length: N + 1 }, (_, i) => (project.duration * i) / N);
    if (sel?.kind === 'character' && project.characters[sel.id]) { const c = project.characters[sel.id]; out.push({ name: 'speed', unit: 'm/s', color: c.idColor, pts: ts.map((t) => [t, evalCharacter(project, c, t).speed]) }); out.push({ name: 'height', unit: 'm', color: '#8b92a0', pts: ts.map((t) => [t, evalCharacter(project, c, t).pos[1]]) }); }
    if (sel?.kind === 'camera' && project.cameras[sel.id]) { const c = project.cameras[sel.id], ck = (f: (k: (typeof c.keys)[number]) => number) => c.keys.map((k) => ({ id: k.id, t: k.t, v: f(k) }));
      out.push({ name: 'focal', unit: 'mm', color: '#5ea8ff', pts: ts.map((t) => [t, evalCamera(project, c, t).focal]), keys: ck((k) => k.focal), edit: (id, v0, dy) => ({ type: 'setCameraKey', cameraId: c.id, keyId: id, patch: { focal: Math.max(8, Math.min(600, Math.round(v0 * Math.exp(dy / 80)))) } }) });
      if (!c.attach) out.push({ name: 'height', unit: 'm', color: '#50c88c', pts: ts.map((t) => [t, evalCamera(project, c, t).pos[1]]), keys: ck((k) => k.pos[1]), edit: (id, v0, dy, sc) => { const k = c.keys.find((x) => x.id === id)!, y = Math.round((v0 + dy * sc) * 100) / 100, d = y - k.pos[1]; return { type: 'setCameraKey', cameraId: c.id, keyId: id, patch: { pos: [k.pos[0], y, k.pos[2]], ...(c.lookAt ? {} : { target: [k.target[0], Math.round((k.target[1] + d) * 100) / 100, k.target[2]] as Vec3 }) } }; } });
      out.push({ name: 'roll', unit: '°', color: '#f0b43c', pts: ts.map((t) => [t, (evalCamera(project, c, t).roll * 180) / Math.PI]), keys: ck((k) => (k.roll * 180) / Math.PI), edit: (id, v0, dy, sc) => ({ type: 'setCameraKey', cameraId: c.id, keyId: id, patch: { roll: (Math.round(v0 + dy * sc) * Math.PI) / 180 } }) }); }
    return out;
  }, [project, sel]);
  if (!curves.length) return <div className="flex h-24 items-center justify-center border-t border-line text-dim">Select a character or camera to see its curves.</div>;
  return <div className="relative border-t border-line" style={{ height: H }} data-testid="curve-editor">
    <div className="absolute left-0 top-0 z-10 flex h-full flex-col justify-center gap-0.5 bg-panel px-2" style={{ width: LABEL_W }}>{curves.map((c) => { const vs = c.pts.map((p) => p[1]); return <div key={c.name} className="flex items-center gap-1 text-xxs"><span className="inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />{c.name}<span className="text-dim">{Math.min(...vs).toFixed(1)}–{Math.max(...vs).toFixed(1)}{c.unit}</span></div>; })}</div>
    <svg className="absolute top-0" style={{ left: LABEL_W }} width={width} height={H}>{curves.map((c) => {
      const vs = c.pts.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), flat = hi - lo < 1e-6, span = flat ? Math.max(1, Math.abs(hi) * 0.2) : hi - lo, y = (v: number) => (flat ? H / 2 - ((v - lo) / span) * (H - 12) : H - 6 - ((v - lo) / span) * (H - 12));
      return <g key={c.name}><polyline fill="none" stroke={c.color} strokeWidth={1.5} points={c.pts.map(([t, v]) => `${t * pps},${y(v)}`).join(' ')} />
        {c.keys?.map((k) => <circle key={k.id} cx={k.t * pps} cy={y(k.v)} r={4} fill={c.color} stroke="#fff" style={{ cursor: 'ns-resize' }} data-testid={`curve-key-${c.name}`} onPointerDown={(e) => {
          if (!c.edit) return; e.stopPropagation(); const y0 = e.clientY, v0 = k.v, perPx = span / (H - 12), edit = c.edit;
          const mv = (ev: PointerEvent) => S().dispatch(edit(k.id, v0, y0 - ev.clientY, perPx), { coalesce: `curve${c.name}${k.id}`, label: `Adjust ${c.name}` });
          const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        }}><title>{`${c.name} ${k.v.toFixed(1)}${c.unit} — drag vertically`}</title></circle>)}</g>;
    })}</svg>
  </div>;
}

export function Timeline() {
  const project = useStudio((s) => s.project), sel = useStudio((s) => s.selection), activeShotId = useStudio((s) => s.activeShotId), playing = useStudio((s) => s.playing), playMode = useStudio((s) => s.playMode), loop = useStudio((s) => s.loop), snap = useStudio((s) => s.snap), range = useStudio((s) => s.range);
  const [pps, setPps] = useState(70), [curves, setCurves] = useState(false), scroller = useRef<HTMLDivElement>(null);
  const width = Math.max(600, project.duration * pps + 80), s = S();
  const timeAt = (clientX: number) => { const r = scroller.current!.getBoundingClientRect(); return (clientX - r.left + scroller.current!.scrollLeft - LABEL_W) / pps; };
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return; const t0 = timeAt(e.clientX), shift = e.shiftKey; S().set({ playing: false }); S().setTime(t0);
    const mv = (ev: PointerEvent) => { const t = Math.max(0, Math.min(S().project.duration, timeAt(ev.clientX))); if (shift) S().set({ range: [Math.min(t0, t), Math.max(t0, t)] }); else S().setTime(t); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const ticks = useMemo(() => { const step = pps > 120 ? 0.5 : pps > 45 ? 1 : pps > 20 ? 2 : 5, out: number[] = []; for (let t = 0; t <= project.duration + 1e-6; t += step) out.push(+t.toFixed(3)); return out; }, [pps, project.duration]);
  const row = (key: string, label: React.ReactNode, body: React.ReactNode, onLabel?: () => void, selected?: boolean, onDbl?: (t: number) => void) => (
    <div key={key} className="relative flex border-b border-line/50" style={{ height: ROW }} role="group" aria-label={typeof label === 'string' ? label : key}>
      <button type="button" className={`sticky left-0 z-10 flex shrink-0 items-center gap-1 truncate border-r border-line px-2 text-left text-xxs ${selected ? 'bg-raised text-fg' : 'bg-panel text-dim'}`} style={{ width: LABEL_W }} onClick={onLabel}>{label}</button>
      <div className="relative" style={{ width }} onDoubleClick={(e) => onDbl?.(snapTime(S().project, timeAt(e.clientX), pps, false))}>{body}</div>
    </div>);
  const addCharKey = (id: string, t: number) => { const p = S().project, c = p.characters[id], st = evalCharacter({ ...p, terrain: { ...p.terrain, heights: [] } }, c, t), prev = [...c.keys].reverse().find((k) => k.t <= t); S().dispatch({ type: 'addPathKey', characterId: id, key: { id: newId('k'), t, pos: [+st.pos[0].toFixed(2), 0, +st.pos[2].toFixed(2)], clip: prev?.clip ?? 'idle', facing: prev?.facing ?? { mode: 'path' }, ease: 'linear', speed: 1 } }); };
  const addCamKey = (id: string, t: number) => { const p = S().project, c = p.cameras[id], base = { ...c, shake: { ...c.shake, profile: 'none' as const }, attach: undefined, lookAt: undefined }, cs = evalCamera(p, base, t), r = (v: number) => +v.toFixed(3); S().dispatch({ type: 'addCameraKey', cameraId: id, key: { id: newId('ck'), t, pos: [r(cs.pos[0]), r(cs.pos[1]), r(cs.pos[2])], target: [r(cs.target[0]), r(cs.target[1]), r(cs.target[2])], focal: Math.round(cs.focal), focus: r(cs.focus), fstop: cs.fstop, roll: r(cs.roll), ease: 'easeInOut' } }); };

  return <div className="flex h-full flex-col bg-panel" data-testid="timeline">
    <div className="panel-h gap-1" role="toolbar" aria-label="Transport">
      <button className="btn" onClick={() => s.step(-1)} title="Previous frame (,)" aria-label="Previous frame">◀︎|</button>
      <button className="btn-primary" data-testid="play" onClick={() => s.togglePlay('scene')} title="Play scene (Space)">{playing && playMode === 'scene' ? '❚❚' : '▶'} Scene</button>
      <button className="btn" data-testid="play-cut" onClick={() => s.togglePlay('cut')} title="Play the cut (Shift+Space)">{playing && playMode === 'cut' ? '❚❚' : '▶'} Cut</button>
      <button className="btn" onClick={() => s.step(1)} title="Next frame (.)" aria-label="Next frame">|▶︎</button>
      <Timecode /><span className="normal-case">{project.fps} fps · {project.duration.toFixed(1)}s scene · {cutDuration(project).toFixed(1)}s cut</span>
      <span className="flex-1" />
      {range && <button className="chip" onClick={() => S().set({ range: null })} title="Clear play range">range {range[0].toFixed(1)}–{range[1].toFixed(1)}s ✕</button>}
      <Toggle on={loop} onChange={(v) => S().set({ loop: v })}>Loop</Toggle><Toggle on={snap} onChange={(v) => S().set({ snap: v })} title="Snap keys to markers, beats and cuts">Snap</Toggle>
      <Toggle on={curves} onChange={setCurves}>Curves</Toggle>
      <button className="btn" onClick={() => S().dispatch({ type: 'addMarker', marker: { id: newId('m'), t: S().t, label: 'Marker', kind: 'marker' } })} title="Add marker at playhead (M)">+ Marker</button>
      <input aria-label="Timeline zoom" type="range" min={12} max={240} value={pps} onChange={(e) => setPps(+e.target.value)} className="w-24" />
    </div>
    <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto" role="region" aria-label="Dope sheet">
      <div className="relative" style={{ width: width + LABEL_W }}>
        <Playhead pps={pps} />
        {range && <div className="pointer-events-none absolute bottom-0 top-0 z-0 bg-accent/10" style={{ left: LABEL_W + range[0] * pps, width: (range[1] - range[0]) * pps }} />}
        {/* ruler */}
        <div className="sticky top-0 z-30 flex border-b border-line bg-panel" style={{ height: ROW }}>
          <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-panel px-2 text-xxs leading-[22px] text-dim" style={{ width: LABEL_W }}>shift-drag = range</div>
          <div className="relative cursor-ew-resize" style={{ width }} onPointerDown={scrub} data-testid="ruler">
            {ticks.map((t) => <div key={t} className="absolute top-0 h-full border-l border-line/70 pl-1 text-xxs text-dim" style={{ left: t * pps }}>{t}s</div>)}
            {Object.values(project.markers).map((m) => <button key={m.id} type="button" title={`${m.label} @ ${m.t.toFixed(2)}s — double-click to delete`} className={`absolute bottom-0 h-2.5 -translate-x-1/2 ${m.kind === 'beat' ? 'w-0.5 bg-claude' : 'w-2 rounded-t bg-warn'}`} style={{ left: m.t * pps }} onPointerDown={(e) => { e.stopPropagation(); S().setTime(m.t); }} onDoubleClick={() => S().dispatch({ type: 'removeMarker', id: m.id })} />)}
          </div>
        </div>
        {/* shot strip */}
        {row('shots', <b className="text-fg">Shots (cut)</b>, <>{project.shots.map((sh, i) => <ShotBlock key={sh.id} i={i} id={sh.id} pps={pps} active={sh.id === activeShotId} />)}</>, undefined, false)}
        {Object.values(project.cameras).map((c) => row(c.id, <><span className="text-accent">▣</span>{c.name}</>,
          c.keys.map((k) => <Key key={k.id} t={k.t} pps={pps} color="#5ea8ff" selected={sel?.id === c.id && sel.keyId === k.id} title={`${c.name} · ${k.focal.toFixed(0)}mm @ ${k.t.toFixed(2)}s`} onSelect={() => S().select({ kind: 'camera', id: c.id, keyId: k.id })} onMove={(t) => S().dispatch({ type: 'moveKeyframe', target: { kind: 'camera', id: c.id }, keyId: k.id, t }, { coalesce: 'mk' + k.id })} />),
          () => S().select({ kind: 'camera', id: c.id }), sel?.kind === 'camera' && sel.id === c.id, (t) => addCamKey(c.id, t)))}
        {Object.values(project.characters).map((c) => row(c.id, <><span className="inline-block h-2 w-2 rounded-full" style={{ background: c.idColor }} />{c.name}</>,
          <>{c.keys.map((k, i) => { const next = c.keys[i + 1]; return <React.Fragment key={k.id}>
            {next && <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded opacity-40" style={{ left: k.t * pps, width: (next.t - k.t) * pps, background: c.idColor }} />}
            <span className="pointer-events-none absolute top-0 pl-2 text-[9px] leading-[10px] text-dim" style={{ left: k.t * pps }}>{k.clip}</span>
            <Key t={k.t} pps={pps} color={c.idColor} selected={sel?.id === c.id && sel.keyId === k.id} title={`${c.name} · ${k.clip} @ ${k.t.toFixed(2)}s`} onSelect={() => S().select({ kind: 'character', id: c.id, keyId: k.id })} onMove={(t) => S().dispatch({ type: 'moveKeyframe', target: { kind: 'character', id: c.id }, keyId: k.id, t }, { coalesce: 'mk' + k.id })} /></React.Fragment>; })}
          {c.poseKeys.map((k) => <Key key={k.id} shape="dot" t={k.t} pps={pps} color="#cc79a7" selected={false} title={`pose ${k.joint} @ ${k.t.toFixed(2)}s (double-click row to add path keys; Alt-click to delete)`} onSelect={() => S().select({ kind: 'character', id: c.id })} onMove={() => {}} />)}</>,
          () => S().select({ kind: 'character', id: c.id }), sel?.kind === 'character' && sel.id === c.id, (t) => addCharKey(c.id, t)))}
        {Object.values(project.fx).map((f) => row(f.id, <><span style={{ color: f.idColor }}>✦</span>{f.name}</>,
          <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded opacity-70" style={{ left: f.start * pps, width: (Math.min(f.end, project.duration) - f.start) * pps, background: f.idColor }} />, () => S().select({ kind: 'fx', id: f.id }), sel?.kind === 'fx' && sel.id === f.id))}
        {Object.values(project.audio).map((a) => row(a.id, <>♪ {a.name}</>,
          <svg className="absolute top-0 h-full" style={{ left: a.offset * pps }} width={Math.max(1, a.duration * pps)} height={ROW} preserveAspectRatio="none" viewBox={`0 0 ${Math.max(1, a.peaks.length)} 2`}><path fill="none" stroke="rgb(var(--good))" strokeWidth={1} vectorEffect="non-scaling-stroke" d={a.peaks.map((v, i) => `M${i} ${1 - v}V${1 + v}`).join('')} /></svg>))}
      </div>
      {curves && <div style={{ width: width + LABEL_W }}><Curves pps={pps} width={width} /></div>}
    </div>
  </div>;
}

function ShotBlock({ id, pps, active }: { id: string; i: number; pps: number; active: boolean }) {
  const sh = useStudio((s) => s.project.shots.find((x) => x.id === id))!, hasTake = useStudio((s) => Object.values(s.project.takes).some((t) => t.shotId === id && t.status === 'done'));
  const edge = (which: 'start' | 'end') => useDrag((dx) => { const s = S(), v = snapTime(s.project, sh[which] + dx / pps, pps, s.snap); if (which === 'start' ? v < sh.end - 0.1 : v > sh.start + 0.1) s.dispatch({ type: 'updateShot', id, patch: { [which]: v } }, { coalesce: 'shot' + which + id, label: `Trim ${sh.name}` }); });
  const body = useDrag((dx) => { const s = S(), st = snapTime(s.project, sh.start + dx / pps, pps, s.snap), d = st - sh.start; if (Math.abs(d) > 1e-6 && sh.end + d <= s.project.duration + 1e-6) s.dispatch({ type: 'updateShot', id, patch: { start: st, end: sh.end + d } }, { coalesce: 'shotmove' + id, label: `Slide ${sh.name}` }); });
  if (!sh) return null;
  return <div data-testid={`shot-${id}`} className={`absolute top-0.5 flex cursor-grab items-center overflow-hidden rounded border text-xxs ${active ? 'border-accent bg-accent/30 text-fg' : 'border-line bg-raised text-dim'}`} style={{ left: sh.start * pps, width: (sh.end - sh.start) * pps, height: ROW - 4 }} title={`${sh.name} · ${(sh.end - sh.start).toFixed(2)}s${sh.transition.kind === 'crossfade' ? ' · crossfade ' + sh.transition.duration + 's' : ''}`} onPointerDown={(e) => { S().select({ kind: 'shot', id }); body(e); }}>
    <span className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize hover:bg-accent" onPointerDown={edge('start')} />
    {(sh.audioLead > 0 || sh.audioTail > 0) && <span className="pointer-events-none absolute bottom-0 h-0.5 bg-good" style={{ left: -sh.audioLead * pps, right: -sh.audioTail * pps }} />}
    {sh.transition.kind === 'crossfade' && <span className="pointer-events-none absolute left-0 top-0 h-full bg-gradient-to-r from-claude/60 to-transparent" style={{ width: sh.transition.duration * pps }} />}
    <span className="truncate px-2">{sh.name}{hasTake ? ' ●' : ''}</span>
    <span className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize hover:bg-accent" onPointerDown={edge('end')} />
  </div>;
}
export const _op = null as unknown as Op;
