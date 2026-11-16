import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ASPECTS, CAMERA_PRESETS, CLIPS, EASINGS, FX_KINDS, HELD, JOINTS, PROP_KINDS, SHAKES, makeCamera, newId, nextIdColor, sunState, characterPosition, evalCharacter, type CameraPreset, type Op, type Project, type Vec3 } from '@blockout/core';
import { S, useStudio, activeShot } from '../store';
import { Field, Num, Section as Sec, Sel, Text, Vec } from '../ui';

const D = (op: Op, label?: string) => S().dispatch(op, label ? { label } : undefined);
const focusPoint = (): Vec3 => { const v = S().viewCam; return v ? [Math.round(v.target[0] * 10) / 10, 0, Math.round(v.target[2] * 10) / 10] : [0, 0, 0]; };

export function addCharacter(name?: string): string {
  const p = S().project, id = newId('ch'), n = Object.keys(p.characters).length, pos = focusPoint();
  D({ type: 'addCharacter', character: { id, name: name ?? `Character ${n + 1}`, idColor: nextIdColor(p), height: 1.75, build: 1, held: { kind: 'none', hand: 'R' }, interp: 'catmull', poseKeys: [], keys: [{ id: newId('k'), t: 0, pos, clip: 'idle', facing: { mode: 'path' }, ease: 'linear', speed: 1 }] } });
  S().select({ kind: 'character', id }); return id;
}
export function addCameraPreset(preset: CameraPreset): string {
  const s = S(), p = s.project, id = newId('cam'), shot = activeShot(s), sel = s.selection, subjectId = sel?.kind === 'character' ? sel.id : Object.keys(p.characters)[0];
  const start = shot?.start ?? s.t, end = shot?.end ?? Math.min(p.duration, s.t + 3), n = Object.keys(p.cameras).length;
  const cam = makeCamera(p, preset, { id, name: `Cam ${String.fromCharCode(65 + (n % 26))} · ${preset}`, start, end, subjectId, subject: subjectId ? undefined : focusPoint(), from: s.viewCam?.pos });
  D({ type: 'addCamera', camera: cam }); s.select({ kind: 'camera', id }); return id;
}
export function cameraFromView(): string | null {
  const s = S(), v = s.viewCam; if (!v) return null; const id = newId('cam'), n = Object.keys(s.project.cameras).length, r = (x: number) => Math.round(x * 100) / 100;
  const sensorH = 36 / Math.max(1, ASPECTS[s.project.aspect]), focal = Math.round(sensorH / 2 / Math.tan((v.fov * Math.PI) / 360));
  D({ type: 'addCamera', camera: { id, name: `Cam ${String.fromCharCode(65 + (n % 26))} · view`, sensorWidth: 36, shake: { profile: 'none', amount: 1, seed: 1 }, keys: [{ id: newId('ck'), t: s.t, pos: v.pos.map(r) as Vec3, target: v.target.map(r) as Vec3, focal, focus: Math.hypot(v.pos[0] - v.target[0], v.pos[1] - v.target[1], v.pos[2] - v.target[2]), fstop: 2.8, roll: 0, ease: 'easeInOut' }] } }, 'Camera from view');
  s.select({ kind: 'camera', id }); return id;
}
export function addShot(cameraId?: string): string | null {
  const s = S(), p = s.project, cam = cameraId ?? (s.selection?.kind === 'camera' ? s.selection.id : Object.keys(p.cameras)[0]); if (!cam) { s.notify('Add a camera first.', 'error'); return null; }
  const last = p.shots[p.shots.length - 1], start = last ? Math.min(last.end, p.duration - 0.5) : 0, id = newId('shot');
  const ops: Op[] = [{ type: 'addShot', shot: { id, name: `${p.shots.length + 1} · New shot`, cameraId: cam, start, end: Math.min(p.duration, start + 3), notes: '', transition: { kind: 'cut', duration: 0 }, audioLead: 0, audioTail: 0, trimIn: 0, trimOut: 0, twoStage: false } }];
  if (start + 0.5 > p.duration) ops.unshift({ type: 'setProject', patch: { duration: start + 3 } });
  D({ type: 'batch', label: 'Add shot', ops }); s.select({ kind: 'shot', id }); return id;
}
export function keyframeAtPlayhead() {
  const s = S(), sel = s.selection, p = s.project, t = s.t; if (!sel) return;
  if (sel.kind === 'character') { const c = p.characters[sel.id], st = evalCharacter({ ...p, terrain: { ...p.terrain, heights: [] } }, c, t), ex = c.keys.find((k) => Math.abs(k.t - t) < 0.5 / p.fps); if (ex) return s.select({ ...sel, keyId: ex.id }); const prev = [...c.keys].reverse().find((k) => k.t <= t), id = newId('k'); D({ type: 'addPathKey', characterId: c.id, key: { id, t, pos: [+st.pos[0].toFixed(2), 0, +st.pos[2].toFixed(2)], clip: prev?.clip ?? 'idle', facing: prev?.facing ?? { mode: 'path' }, ease: 'linear', speed: 1 } }); s.select({ ...sel, keyId: id }); }
  if (sel.kind === 'camera') window.dispatchEvent(new CustomEvent('blockout:camkey', { detail: sel.id }));
}

const ADD: [string, () => void][] = [
  ['Character', () => addCharacter()], ...CAMERA_PRESETS.map((p) => [`Camera · ${p}`, () => addCameraPreset(p)] as [string, () => void]), ['Shot', () => addShot()],
  ...PROP_KINDS.filter((k) => k !== 'glb').map((k) => [`Prop · ${k}`, () => { const p = S().project, id = newId('prop'); D({ type: 'addProp', prop: { id, name: k, kind: k, pos: focusPoint(), rot: [0, 0, 0], scale: k === 'plane' ? [4, 1, 4] : [1, 1, 1], idColor: nextIdColor(p), ...(k === 'building' ? { plan: { points: [[-3, -2], [3, -2], [3, 2], [-3, 2]] as [number, number][], height: 3, roof: true } } : {}) } }); S().select({ kind: 'prop', id }); }] as [string, () => void]),
  ...FX_KINDS.map((k) => [`Effect · ${k}`, () => { const s = S(), p = s.project, id = newId('fx'), host = s.selection?.kind === 'character' ? s.selection.id : undefined; D({ type: 'addFx', fx: { id, name: k, kind: k, pos: host ? [0, 0, 0] : focusPoint(), size: k === 'rain' ? [12, 6, 12] : [1, 1, 1], attachTo: host, start: 0, end: 9999, idColor: nextIdColor(p), trail: 1.5 } }); S().select({ kind: 'fx', id }); }] as [string, () => void]),
];
export function AddMenu() {
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="btn-primary" data-testid="add-menu">+ Add</button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content align="start" className="z-50 max-h-[70vh] overflow-auto rounded border border-line bg-panel p-1 shadow-xl">{ADD.map(([l, f]) => <DropdownMenu.Item key={l} onSelect={f} className="cursor-pointer rounded px-2 py-1 text-xs text-fg outline-none data-[highlighted]:bg-accent/30">{l}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}

function CharacterPanel({ p, id, keyId }: { p: Project; id: string; keyId?: string }) {
  const c = p.characters[id], k = c.keys.find((x) => x.id === keyId), up = (patch: Partial<typeof c>) => D({ type: 'updateCharacter', id, patch }), others = Object.values(p.characters).filter((o) => o.id !== id);
  const upk = (patch: Partial<NonNullable<typeof k>>) => k && D({ type: 'setPathKey', characterId: id, keyId: k.id, patch });
  const [joint, setJoint] = React.useState<(typeof JOINTS)[number]>('head'), [rot, setRot] = React.useState<Vec3>([0, 0.5, 0]);
  return <>
    <Sec title="Character" right={<button className="btn" onClick={() => { D({ type: 'removeCharacter', id }); S().select(null); }}>Delete</button>}>
      <Field label="Name"><Text label="Name" value={c.name} onChange={(name) => up({ name })} /></Field>
      <Field label="ID colour"><input aria-label="ID colour" type="color" value={c.idColor} onChange={(e) => S().dispatch({ type: 'updateCharacter', id, patch: { idColor: e.target.value } }, { coalesce: 'idc' + id })} /></Field>
      <Field label="Height m"><Num value={c.height} step={0.01} min={0.5} max={3} onChange={(height) => up({ height })} /></Field>
      <Field label="Build"><input aria-label="Build" type="range" min={0.6} max={1.6} step={0.02} value={c.build} onChange={(e) => S().dispatch({ type: 'updateCharacter', id, patch: { build: +e.target.value } }, { coalesce: 'build' + id })} className="w-full" /></Field>
      <Field label="Holds"><div className="flex gap-1"><Sel value={c.held.kind} options={HELD} onChange={(kind) => up({ held: { ...c.held, kind } })} /><Sel value={c.held.hand} options={['L', 'R']} onChange={(hand) => up({ held: { ...c.held, hand } })} /></div></Field>
      <Field label="Path"><Sel value={c.interp} options={['catmull', 'bezier', 'linear']} onChange={(interp) => up({ interp })} /></Field>
      <p className="mt-1 text-xxs text-dim">{c.keys.length} path keys · press <kbd>K</kbd> to key at the playhead, or use Path mode and click the ground.</p>
    </Sec>
    {k && <Sec title={`Path key @ ${k.t.toFixed(2)}s`} right={<button className="btn" onClick={() => { D({ type: 'removeKeyframe', target: { kind: 'character', id }, keyId: k.id }); S().select({ kind: 'character', id }); }}>Delete key</button>}>
      <Field label="Time s"><Num value={k.t} step={1 / p.fps} min={0} onChange={(t) => D({ type: 'moveKeyframe', target: { kind: 'character', id }, keyId: k.id, t })} /></Field>
      <Field label="Position"><Vec value={k.pos} onChange={(pos) => D({ type: 'moveKeyframe', target: { kind: 'character', id }, keyId: k.id, pos })} /></Field>
      <Field label="Clip"><Sel label="Clip" value={k.clip} options={[...CLIPS, ...Object.values(p.clips).map((cc) => [cc.id, `mocap: ${cc.name}`] as [string, string])]} onChange={(clip) => upk({ clip })} /></Field>
      <Field label="Clip speed"><Num value={k.speed} step={0.1} min={0.05} onChange={(speed) => upk({ speed })} /></Field>
      <Field label="Ease"><Sel value={k.ease} options={EASINGS} onChange={(ease) => upk({ ease })} /></Field>
      <Field label="Facing"><div className="flex gap-1"><Sel value={k.facing.mode} options={['path', 'target', 'fixed']} onChange={(mode) => upk({ facing: mode === 'path' ? { mode } : mode === 'fixed' ? { mode, yaw: 0 } : { mode, targetId: others[0]?.id ?? id } })} />
        {k.facing.mode === 'target' && <Sel value={k.facing.targetId} options={others.map((o) => [o.id, o.name] as [string, string])} onChange={(targetId) => upk({ facing: { mode: 'target', targetId } })} />}
        {k.facing.mode === 'fixed' && <Num value={(k.facing.yaw * 180) / Math.PI} step={5} onChange={(d) => upk({ facing: { mode: 'fixed', yaw: (d * Math.PI) / 180 } })} />}</div></Field>
    </Sec>}
    <Sec title="Pose layer (additive)">
      <p className="mb-1 text-xxs text-dim">Rotate a joint on top of the clip and key it — e.g. a head turn during a run.</p>
      <Field label="Joint"><Sel value={joint} options={JOINTS} onChange={setJoint} /></Field>
      <Field label="Rotation°"><Vec step={5} value={rot.map((r) => Math.round((r * 180) / Math.PI))} onChange={(v) => setRot(v.map((d) => (d * Math.PI) / 180) as Vec3)} /></Field>
      <div className="mt-1 flex gap-1"><button className="btn" data-testid="pose-key" onClick={() => D({ type: 'addPoseKey', characterId: id, key: { id: newId('pk'), t: S().t, joint, rot, ease: 'easeInOut' } }, `Key ${joint} pose on ${c.name}`)}>Key pose at playhead</button>
        <button className="btn" onClick={() => D({ type: 'addPoseKey', characterId: id, key: { id: newId('pk'), t: S().t, joint, rot: [0, 0, 0], ease: 'easeInOut' } }, `Key ${joint} rest on ${c.name}`)}>Key rest</button></div>
      {c.poseKeys.length > 0 && <ul className="mt-1 max-h-24 overflow-auto text-xxs text-dim">{c.poseKeys.map((pk) => <li key={pk.id} className="flex justify-between"><span>{pk.t.toFixed(2)}s · {pk.joint} · [{pk.rot.map((r) => Math.round((r * 180) / Math.PI)).join(', ')}]°</span><button className="text-bad" aria-label="Delete pose key" onClick={() => D({ type: 'removePoseKey', characterId: id, keyId: pk.id })}>✕</button></li>)}</ul>}
    </Sec>
  </>;
}

function CameraPanel({ p, id, keyId }: { p: Project; id: string; keyId?: string }) {
  const c = p.cameras[id], k = c.keys.find((x) => x.id === keyId) ?? (c.keys.length === 1 ? c.keys[0] : undefined), chars = Object.values(p.characters), up = (patch: Partial<typeof c>) => D({ type: 'updateCamera', id, patch });
  const upk = (patch: Partial<NonNullable<typeof k>>) => k && D({ type: 'setCameraKey', cameraId: id, keyId: k.id, patch });
  return <>
    <Sec title="Camera" right={<button className="btn" onClick={() => { if (D({ type: 'removeCamera', id })) S().select(null); }}>Delete</button>}>
      <Field label="Name"><Text value={c.name} onChange={(name) => up({ name })} /></Field>
      <Field label="Lens mm"><div className="flex flex-wrap gap-1">{[18, 24, 35, 50, 85, 135].map((f) => <button key={f} data-testid={`lens-${f}`} className={`btn ${c.keys.every((x) => Math.round(x.focal) === f) ? 'border-accent text-accent' : ''}`} onClick={() => D({ type: 'setLens', cameraId: id, focal: f })}>{f}</button>)}</div></Field>
      <Field label="Sensor mm"><Num value={c.sensorWidth} step={1} min={4} onChange={(sensorWidth) => up({ sensorWidth })} /></Field>
      <Field label="Look at"><Sel value={c.lookAt?.characterId ?? ''} options={[['', 'key targets'], ...chars.map((o) => [o.id, o.name] as [string, string])]} onChange={(v) => up({ lookAt: v ? { characterId: v, offset: [0, 1.4, 0] } : undefined })} /></Field>
      <Field label="Attach to"><div className="flex gap-1"><Sel value={c.attach?.characterId ?? ''} options={[['', 'world'], ...chars.map((o) => [o.id, o.name] as [string, string])]} onChange={(v) => { if (!v) return up({ attach: undefined }); const cp = characterPosition(p, p.characters[v], c.keys[0].t); D({ type: 'updateCamera', id, patch: { attach: { characterId: v, lag: 0.2 }, keys: c.attach ? c.keys : c.keys.map((x) => ({ ...x, pos: [x.pos[0] - cp[0], x.pos[1] - cp[1], x.pos[2] - cp[2]] as Vec3, target: [x.target[0] - cp[0], x.target[1] - cp[1], x.target[2] - cp[2]] as Vec3 })) } }, `Attach ${c.name}`); }} />{c.attach && <Num label="Lag s" value={c.attach.lag} step={0.05} min={0} onChange={(lag) => up({ attach: { ...c.attach!, lag } })} />}</div></Field>
      <Field label="Shake"><div className="flex gap-1"><Sel value={c.shake.profile} options={SHAKES} onChange={(profile) => up({ shake: { ...c.shake, profile } })} /><Num label="Shake amount" value={c.shake.amount} step={0.1} min={0} max={4} onChange={(amount) => up({ shake: { ...c.shake, amount } })} /></div></Field>
    </Sec>
    {k && <Sec title={`Camera key @ ${k.t.toFixed(2)}s`} right={c.keys.length > 1 ? <button className="btn" onClick={() => D({ type: 'removeKeyframe', target: { kind: 'camera', id }, keyId: k.id })}>Delete key</button> : undefined}>
      <Field label="Time s"><Num value={k.t} step={1 / p.fps} min={0} onChange={(t) => D({ type: 'moveKeyframe', target: { kind: 'camera', id }, keyId: k.id, t })} /></Field>
      <Field label={c.attach ? 'Offset' : 'Position'}><Vec value={k.pos} onChange={(pos) => upk({ pos })} /></Field>
      {!c.lookAt && <Field label="Target"><Vec value={k.target} onChange={(target) => upk({ target })} /></Field>}
      <Field label="Focal mm"><Num value={k.focal} step={1} min={8} max={600} onChange={(focal) => D({ type: 'setLens', cameraId: id, focal, keyId: k.id })} /></Field>
      <Field label="Focus m"><Num value={k.focus} step={0.1} min={0.1} onChange={(focus) => upk({ focus })} /></Field>
      <Field label="f-stop"><Num value={k.fstop} step={0.1} min={0.7} onChange={(fstop) => upk({ fstop })} /></Field>
      <Field label="Roll°"><Num value={(k.roll * 180) / Math.PI} step={1} onChange={(d) => upk({ roll: (d * Math.PI) / 180 })} /></Field>
      <Field label="Ease"><Sel value={k.ease} options={EASINGS} onChange={(ease) => upk({ ease })} /></Field>
    </Sec>}
    {!k && <p className="p-2 text-xxs text-dim">Select a key (◆ in the timeline) to edit it. Double-click the camera row to add one.</p>}
  </>;
}

function ShotPanel({ p, id }: { p: Project; id: string }) {
  const sh = p.shots.find((s) => s.id === id); if (!sh) return null; const up = (patch: Partial<typeof sh>) => D({ type: 'updateShot', id, patch }), i = p.shots.indexOf(sh);
  const move = (d: number) => { const order = p.shots.map((s) => s.id), j = i + d; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; D({ type: 'reorderShots', order }, 'Reorder shots'); };
  return <Sec title="Shot" right={<div className="flex gap-1"><button className="btn" aria-label="Move earlier in cut" onClick={() => move(-1)}>↑</button><button className="btn" aria-label="Move later in cut" onClick={() => move(1)}>↓</button><button className="btn" onClick={() => { D({ type: 'removeShot', id }); S().select(null); }}>Delete</button></div>}>
    <Field label="Name"><Text value={sh.name} onChange={(name) => up({ name })} /></Field>
    <Field label="Camera"><Sel label="Shot camera" value={sh.cameraId} options={Object.values(p.cameras).map((c) => [c.id, c.name] as [string, string])} onChange={(cameraId) => up({ cameraId })} /></Field>
    <Field label="In / out s"><div className="flex gap-1"><Num label="Shot start" value={sh.start} step={1 / p.fps} min={0} onChange={(start) => up({ start })} /><Num label="Shot end" value={sh.end} step={1 / p.fps} min={0} onChange={(end) => up({ end })} /></div></Field>
    <Field label="Retime"><button className="btn" title="Scale every key inside this shot to a new duration and ripple what follows" onClick={() => { const v = prompt('New duration for this segment (seconds)', (sh.end - sh.start).toFixed(2)); const d = v ? parseFloat(v) : NaN; if (d > 0.05) D({ type: 'retimeSegment', start: sh.start, end: sh.end, newEnd: sh.start + d, ripple: true }); }}>Retime segment…</button></Field>
    <Field label="Transition"><div className="flex gap-1"><Sel value={sh.transition.kind} options={['cut', 'crossfade']} onChange={(kind) => up({ transition: { kind, duration: kind === 'cut' ? 0 : 0.5 } })} />{sh.transition.kind === 'crossfade' && <Num value={sh.transition.duration} step={0.1} min={0} onChange={(duration) => up({ transition: { ...sh.transition, duration } })} />}</div></Field>
    <Field label="J / L cut s"><div className="flex gap-1"><Num label="Audio lead" value={sh.audioLead} step={0.1} min={0} onChange={(audioLead) => up({ audioLead })} /><Num label="Audio tail" value={sh.audioTail} step={0.1} min={0} onChange={(audioTail) => up({ audioTail })} /></div></Field>
    <Field label="Trim in/out"><div className="flex gap-1"><Num label="Trim in" value={sh.trimIn} step={0.1} min={0} onChange={(trimIn) => up({ trimIn })} /><Num label="Trim out" value={sh.trimOut} step={0.1} min={0} onChange={(trimOut) => up({ trimOut })} /></div></Field>
    <Field label="Two-stage"><input aria-label="Two-stage generation" type="checkbox" checked={sh.twoStage} onChange={(e) => up({ twoStage: e.target.checked })} /> <span className="text-xxs text-dim">styled keyframe first, then image-to-video</span></Field>
    <Field label="Notes" wide><Text area value={sh.notes} onChange={(notes) => up({ notes })} /></Field>
  </Sec>;
}

function WorldPanel({ p }: { p: Project }) {
  const L = p.lighting, sun = sunState(L), up = (patch: Partial<typeof L>, c?: string) => S().dispatch({ type: 'setLighting', patch }, c ? { coalesce: c } : undefined), pp = (patch: Record<string, unknown>) => D({ type: 'setProject', patch } as Op);
  return <>
    <Sec title="Project">
      <Field label="Name"><Text value={p.name} onChange={(name) => pp({ name })} /></Field>
      <Field label="Aspect"><Sel label="Aspect" value={p.aspect} options={Object.keys(ASPECTS) as (keyof typeof ASPECTS)[]} onChange={(aspect) => pp({ aspect })} /></Field>
      <Field label="FPS"><Num value={p.fps} step={1} min={1} max={120} onChange={(fps) => pp({ fps: Math.round(fps) })} /></Field>
      <Field label="Duration s"><Num value={p.duration} step={0.5} min={0.5} onChange={(duration) => pp({ duration })} /></Field>
      <Field label="Seed"><Num value={p.seed} step={1} onChange={(seed) => pp({ seed: Math.round(seed) })} /></Field>
      <Field label="Budget $"><Num value={p.budgetCap} step={1} min={0} onChange={(budgetCap) => pp({ budgetCap })} /></Field>
    </Sec>
    <Sec title="Lighting blockout">
      <Field label="Time of day"><div className="flex items-center gap-1"><input aria-label="Time of day" type="range" min={0} max={24} step={0.1} value={L.timeOfDay} onChange={(e) => up({ timeOfDay: +e.target.value }, 'tod')} className="w-full" /><span className="w-10 tabular-nums">{Math.floor(L.timeOfDay)}:{String(Math.round((L.timeOfDay % 1) * 60)).padStart(2, '0')}</span></div></Field>
      <Field label="Latitude"><Num value={L.latitude} step={1} min={-90} max={90} onChange={(latitude) => up({ latitude })} /></Field>
      <Field label="Day of year"><Num value={L.dayOfYear} step={1} min={1} max={366} onChange={(dayOfYear) => up({ dayOfYear: Math.round(dayOfYear) })} /></Field>
      <Field label="North°"><Num value={L.north} step={5} onChange={(north) => up({ north })} /></Field>
      <Field label="Sky"><input aria-label="Sky colour" type="color" value={L.skyColor} onChange={(e) => up({ skyColor: e.target.value }, 'sky')} /></Field>
      <p className="text-xxs text-dim">Sun elevation {sun.elevation.toFixed(0)}°, azimuth {sun.azimuth.toFixed(0)}° — written into every prompt.</p>
      {(['key', 'fill', 'rim'] as const).map((k) => <Field key={k} label={k}><div className="flex items-center gap-1"><input aria-label={`${k} light on`} type="checkbox" checked={L[k].on} onChange={(e) => up({ [k]: { ...L[k], on: e.target.checked } })} /><Num label="azimuth" value={L[k].azimuth} step={5} onChange={(azimuth) => up({ [k]: { ...L[k], azimuth } })} /><Num label="elevation" value={L[k].elevation} step={5} onChange={(elevation) => up({ [k]: { ...L[k], elevation } })} /><Num label="intensity" value={L[k].intensity} step={0.1} min={0} onChange={(intensity) => up({ [k]: { ...L[k], intensity } })} /></div></Field>)}
    </Sec>
    <Sec title="Set dressing">
      <p className="text-xxs text-dim">{Object.keys(p.props).length} props · {Object.values(p.scatter).reduce((a, s) => a + s.count, 0)} scattered instances · terrain {p.terrain.heights.length ? `${p.terrain.res}² heightmap` : 'flat'}</p>
      <div className="mt-1 flex flex-wrap gap-1">{Object.values(p.scatter).map((s) => <button key={s.id} className="chip" title="Remove scatter" onClick={() => D({ type: 'removeScatter', id: s.id })}>{s.kind} ×{s.count} ✕</button>)}<button className="btn" onClick={() => D({ type: 'setTerrain', terrain: { ...p.terrain, heights: [] } }, 'Flatten terrain')}>Flatten terrain</button></div>
    </Sec>
  </>;
}

export function Inspector() {
  const p = useStudio((s) => s.project), sel = useStudio((s) => s.selection);
  let body: React.ReactNode = <WorldPanel p={p} />;
  if (sel?.kind === 'character' && p.characters[sel.id]) body = <CharacterPanel p={p} id={sel.id} keyId={sel.keyId} />;
  else if (sel?.kind === 'camera' && p.cameras[sel.id]) body = <CameraPanel p={p} id={sel.id} keyId={sel.keyId} />;
  else if (sel?.kind === 'shot') body = <ShotPanel p={p} id={sel.id} />;
  else if (sel?.kind === 'prop' && p.props[sel.id]) { const pr = p.props[sel.id], up = (patch: Partial<typeof pr>) => D({ type: 'updateProp', id: pr.id, patch });
    body = <Sec title={`Prop · ${pr.kind}`} right={<button className="btn" onClick={() => { D({ type: 'removeProp', id: pr.id }); S().select(null); }}>Delete</button>}>
      <Field label="Name"><Text value={pr.name} onChange={(name) => up({ name })} /></Field><Field label="Position"><Vec value={pr.pos} onChange={(pos) => up({ pos })} /></Field>
      <Field label="Rotation"><Vec value={pr.rot} onChange={(rot) => up({ rot })} /></Field><Field label="Scale"><Vec value={pr.scale} onChange={(scale) => up({ scale })} /></Field>
      {pr.kind === 'building' && pr.plan && <><Field label="Wall height"><Num value={pr.plan.height} min={0.5} onChange={(height) => up({ plan: { ...pr.plan!, height } })} /></Field>
        <Field label="Floorplan" wide><Text area label="Floorplan points" value={pr.plan.points.map((q) => q.join(',')).join(' ')} onChange={(v) => { const points = v.trim().split(/\s+/).map((q) => q.split(',').map(Number) as [number, number]).filter((q) => q.length === 2 && q.every(Number.isFinite)); if (points.length >= 2) up({ plan: { ...pr.plan!, points } }); }} /><span className="text-xxs text-dim">x,z corner points in metres, space-separated; walls are extruded along the outline.</span></Field>
        <Field label="Roof"><input aria-label="Roof" type="checkbox" checked={pr.plan.roof} onChange={(e) => up({ plan: { ...pr.plan!, roof: e.target.checked } })} /></Field></>}
    </Sec>; }
  else if (sel?.kind === 'fx' && p.fx[sel.id]) { const f = p.fx[sel.id], up = (patch: Partial<typeof f>) => D({ type: 'updateFx', id: f.id, patch });
    body = <Sec title={`Effect proxy · ${f.kind}`} right={<button className="btn" onClick={() => { D({ type: 'removeFx', id: f.id }); S().select(null); }}>Delete</button>}>
      <Field label="Name"><Text value={f.name} onChange={(name) => up({ name })} /></Field><Field label="Kind"><Sel value={f.kind} options={FX_KINDS} onChange={(kind) => up({ kind })} /></Field>
      <Field label="Attach to"><Sel value={f.attachTo ?? ''} options={[['', 'world'], ...Object.values(p.characters).map((o) => [o.id, o.name] as [string, string])]} onChange={(v) => up({ attachTo: v || undefined })} /></Field>
      <Field label="Offset"><Vec value={f.pos} onChange={(pos) => up({ pos })} /></Field><Field label="Size"><Vec value={f.size} onChange={(size) => up({ size })} /></Field>
      <Field label="Start / end"><div className="flex gap-1"><Num value={f.start} min={0} onChange={(start) => up({ start })} /><Num value={Math.min(f.end, p.duration)} min={0} onChange={(end) => up({ end })} /></div></Field>
    </Sec>; }
  return <div className="h-full overflow-auto" data-testid="inspector">{body}</div>;
}
