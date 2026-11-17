import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Html, Line, OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { compileFrame, evalCamera, evalCharacter, samplePath, terrainHeight, characterPosition, qRotate, newId, nextIdColor, jointFrames, poseKeyFor, CLIP_DEFS, type Joint, type Project, type Vec3, type Op } from '@blockout/core';
import { GLStage, LightRig } from '@blockout/render';
import { S, useStudio, activeShot, type Mode, OVERLAYS } from '../store';
import { Toggle } from '../ui';
import { collab } from '../collab';

const lift = (p: Project, v: readonly number[], dy = 0.03): [number, number, number] => [v[0], v[1] + terrainHeight(p.terrain, v[0], v[2]) + dy, v[2]];

function Stage() {
  const stage = useMemo(() => new GLStage(), []), lights = useMemo(() => new LightRig(1024), []);
  const { scene, controls } = useThree(); const last = useRef<{ p: Project | null; t: number }>({ p: null, t: -1 });
  useFrame((_s, dt) => {
    const st = S(); st.tick(Math.min(dt, 0.1));
    const s = S(), p = s.project;
    stage.setLook('view', s.selection && s.selection.kind !== 'shot' ? s.selection.id : null);
    if (last.current.p !== p || last.current.t !== s.t) { stage.sync(compileFrame(p, s.t)); last.current = { p, t: s.t }; }
    const tg = (controls as unknown as { target?: THREE.Vector3 })?.target;
    scene.background = lights.update(p, tg ? [tg.x, 0, tg.z] : [0, 0, 0], 40);
  });
  const down = (e: ThreeEvent<PointerEvent>) => {
    const s = S(); if (e.button !== 0) return;
    if (s.mode === 'path') return addPathPoint(e);
    if (s.mode === 'scatter') { e.stopPropagation(); s.dispatch({ type: 'addScatter', scatter: { id: newId('sc'), kind: s.scatterKind, seed: Math.floor(e.point.x * 31 + e.point.z * 17) | 0, center: [e.point.x, 0, e.point.z], radius: s.sculpt.radius, count: s.scatterKind === 'grass' ? 120 : 12 } }); return; }
    if (s.mode === 'sculpt') { e.stopPropagation(); sculptAt(e.point); return; }
    const id = GLStage.entityOf(e.object); if (!id || id === 'ground') return;
    e.stopPropagation(); const p = s.project;
    const kind = p.characters[id] ? 'character' : p.props[id] ? 'prop' : p.fx[id] ? 'fx' : null; if (kind) s.select({ kind, id });
  };
  const move = (e: ThreeEvent<PointerEvent>) => { if (S().mode === 'sculpt' && e.buttons === 1) sculptAt(e.point); collab.cursor([e.point.x, e.point.y, e.point.z]); };
  return <><primitive object={stage.group} onPointerDown={down} onPointerMove={move} /><primitive object={lights.group} /></>;
}

function addPathPoint(e: ThreeEvent<PointerEvent>) {
  const s = S(), sel = s.selection; e.stopPropagation();
  if (sel?.kind !== 'character') return s.notify('Select a character first, then click the ground to lay its path.');
  const c = s.project.characters[sel.id], last = c.keys[c.keys.length - 1], pos: Vec3 = [Math.round(e.point.x * 100) / 100, 0, Math.round(e.point.z * 100) / 100];
  const clip = last && CLIP_DEFS[last.clip]?.stride ? last.clip : 'walk', speed = clip === 'sprint' ? 6.5 : clip === 'run' ? 3.8 : 1.5;
  let t = s.t; if (last && t <= last.t + 1e-6) t = last.t + Math.max(0.25, Math.hypot(pos[0] - last.pos[0], pos[2] - last.pos[2]) / speed);
  t = Math.round(t * s.project.fps) / s.project.fps;
  const ops: Op[] = [{ type: 'addPathKey', characterId: c.id, key: { id: newId('k'), t, pos, clip: 'idle', facing: { mode: 'path' }, ease: 'linear', speed: 1 } }];
  if (last && !CLIP_DEFS[last.clip]?.stride && last.clip === 'idle') ops.unshift({ type: 'setPathKey', characterId: c.id, keyId: last.id, patch: { clip: 'walk' } });
  if (t > s.project.duration) ops.push({ type: 'setProject', patch: { duration: Math.ceil(t + 1) } });
  if (s.dispatch({ type: 'batch', label: `Extend ${c.name}'s path`, ops })) s.setTime(t);
}
function sculptAt(pt: THREE.Vector3) {
  const s = S(), T = s.project.terrain, n = T.res, H = T.heights.length === n * n ? T.heights : new Array(n * n).fill(0), cells: [number, number][] = [], { op, radius, strength } = s.sculpt;
  const cx = (pt.x / T.size + 0.5) * (n - 1), cz = (pt.z / T.size + 0.5) * (n - 1), r = (radius / T.size) * (n - 1), h0 = terrainHeight(T, pt.x, pt.z);
  for (let j = Math.max(0, Math.floor(cz - r)); j <= Math.min(n - 1, Math.ceil(cz + r)); j++) for (let i = Math.max(0, Math.floor(cx - r)); i <= Math.min(n - 1, Math.ceil(cx + r)); i++) {
    const d = Math.hypot(i - cx, j - cz) / Math.max(r, 0.75); if (d > 1) continue; const w = (1 - d * d) ** 2 * strength, k = j * n + i; let h = H[k];
    if (op === 'raise') h += w * 0.25; else if (op === 'lower') h -= w * 0.25; else if (op === 'flatten') h += (h0 - h) * Math.min(1, w);
    else { let a = 0, c = 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < n && jj < n) { a += H[jj * n + ii]; c++; } } h += (a / c - h) * Math.min(1, w); }
    cells.push([k, Math.round(h * 1000) / 1000]);
  }
  if (cells.length) s.dispatch({ type: 'sculptTerrain', cells }, { coalesce: 'sculpt', label: `Sculpt terrain (${op})` });
}

function Paths({ project, ghost }: { project: Project; ghost?: boolean }) {
  const sel = useStudio((s) => s.selection), show = useStudio((s) => s.overlays.paths), onion = useStudio((s) => s.overlays.onion);
  if (!show && !ghost) return null;
  return <>{Object.values(project.characters).map((c) => {
    const pts = c.keys.length > 1 ? samplePath(c, 14).map((v) => lift(project, v, 0.04)) : null, selected = sel?.kind === 'character' && sel.id === c.id;
    return <group key={c.id}>
      {pts && <Line points={pts} color={ghost ? '#d97757' : c.idColor} lineWidth={ghost ? 3 : selected ? 2.5 : 1.5} dashed={ghost} dashSize={0.3} gapSize={0.2} transparent opacity={ghost ? 0.95 : 0.9} />}
      {!ghost && c.keys.map((k) => <mesh key={k.id} position={lift(project, k.pos, 0.08)} onPointerDown={(e) => { if (S().mode !== 'select') return; e.stopPropagation(); S().select({ kind: 'character', id: c.id, keyId: k.id }); S().setTime(k.t); }}>
        <sphereGeometry args={[selected && sel?.keyId === k.id ? 0.16 : 0.1, 10, 8]} /><meshBasicMaterial color={selected && sel?.keyId === k.id ? '#ffffff' : c.idColor} />
      </mesh>)}
      {!ghost && onion && selected && c.keys.length > 1 && Array.from({ length: Math.min(80, Math.ceil((c.keys[c.keys.length - 1].t - c.keys[0].t) * 4)) }, (_, i) => { const st = evalCharacter(project, c, c.keys[0].t + i / 4); return <mesh key={i} position={[st.pos[0], st.pos[1] + c.height * 0.5, st.pos[2]]} rotation={[0, st.yaw, 0]}><boxGeometry args={[0.36, c.height, 0.2]} /><meshBasicMaterial color={c.idColor} transparent opacity={0.13} depthWrite={false} /></mesh>; })}
    </group>;
  })}</>;
}

/** Motion trails: where each character (and moving camera) was over the last 1.5 s. */
/** Pose mode: joints of the selected character are clickable; the chosen one gets a rotate gizmo; releasing keys an additive pose layer. */
function PoseRig() {
  const mode = useStudio((s) => s.mode), sel = useStudio((s) => s.selection), project = useStudio((s) => s.project), t = useStudio((s) => s.t), joint = useStudio((s) => s.poseJoint) as Joint | null, ref = useRef<THREE.Group>(null!);
  const c = mode === 'pose' && sel?.kind === 'character' ? project.characters[sel.id] : undefined, frames = useMemo(() => (c ? jointFrames(project, c, t) : null), [c, project, t]);
  useEffect(() => { if (ref.current && frames && joint) { ref.current.position.set(...frames[joint].pos); ref.current.quaternion.set(...frames[joint].quat); } });
  if (!c || !frames) return null;
  const commit = () => { if (!joint) return; const q = ref.current.quaternion, rot = poseKeyFor(project, c, t, joint, [q.x, q.y, q.z, q.w]), half = 0.5 / project.fps, old = c.poseKeys.filter((k) => k.joint === joint && Math.abs(k.t - t) < half);
    S().dispatch({ type: 'batch', label: `Pose ${c.name} · ${joint} at ${t.toFixed(2)}s`, ops: [...old.map((k) => ({ type: 'removePoseKey' as const, characterId: c.id, keyId: k.id })), { type: 'addPoseKey', characterId: c.id, key: { id: newId('pk'), t, joint, rot, ease: 'easeInOut' } }] }); };
  return <>
    {(Object.keys(frames) as Joint[]).map((j) => <mesh key={j} position={frames[j].pos} renderOrder={10} onPointerDown={(e) => { e.stopPropagation(); S().set({ poseJoint: j }); }}><sphereGeometry args={[j === joint ? 0.06 : 0.04, 10, 8]} /><meshBasicMaterial color={j === joint ? '#ffffff' : c.idColor} depthTest={false} transparent opacity={0.9} /></mesh>)}
    {joint && <><group ref={ref} /><TransformControls object={ref} mode="rotate" space="local" size={0.6} onMouseUp={commit} />
      <Html position={frames[joint].pos} center distanceFactor={10} style={{ pointerEvents: 'none' }}><div className="mt-8 whitespace-nowrap rounded bg-black/70 px-1 text-[10px] text-white">{joint} · release to key at {t.toFixed(2)}s</div></Html></>}
  </>;
}
function Trails() {
  const project = useStudio((s) => s.project), t = useStudio((s) => s.t), on = useStudio((s) => s.overlays.trails); if (!on) return null;
  const span = 1.5, steps = 18, ts = Array.from({ length: steps + 1 }, (_, i) => Math.max(0, t - span + (span * i) / steps));
  return <>{Object.values(project.characters).map((c) => { const pts = ts.map((tt) => { const p = evalCharacter(project, c, tt).pos; return [p[0], p[1] + c.height * 0.5, p[2]] as [number, number, number]; }); const moved = Math.hypot(pts[0][0] - pts[steps][0], pts[0][2] - pts[steps][2]) > 0.05; return moved ? <Line key={c.id} points={pts} color={c.idColor} lineWidth={3} transparent opacity={0.55} /> : null; })}
    {Object.values(project.cameras).map((c) => { const pts = ts.map((tt) => evalCamera(project, c, tt).pos as [number, number, number]); return Math.hypot(pts[0][0] - pts[steps][0], pts[0][1] - pts[steps][1], pts[0][2] - pts[steps][2]) > 0.05 ? <Line key={c.id} points={pts} color="#5ea8ff" lineWidth={2} transparent opacity={0.45} /> : null; })}</>;
}
/** Focus-plane gizmo for the active/selected camera: the plane in focus, plus near/far limits of acceptable sharpness. */
function FocusPlane() {
  const project = useStudio((s) => s.project), t = useStudio((s) => s.t), sel = useStudio((s) => s.selection), shot = useStudio(activeShot), on = useStudio((s) => s.overlays.frusta);
  const id = sel?.kind === 'camera' ? sel.id : shot?.cameraId, cam = id ? project.cameras[id] : undefined; if (!on || !cam) return null;
  const cs = evalCamera(project, cam, t), coc = 0.03 * (cam.sensorWidth / 36), H = (cs.focal * cs.focal) / (cs.fstop * coc) / 1000, d = cs.focus, near = (H * d) / (H + d), far = d < H ? (H * d) / (H - d) : Infinity;
  const plane = (dist: number, color: string, opacity: number, label?: string) => { const th = Math.tan(cs.fovY / 2), h = 2 * th * dist, w = h * cs.aspect, c = qRotate(cs.quat, [0, 0, -dist]); return <group key={label ?? color + dist} position={[cs.pos[0] + c[0], cs.pos[1] + c[1], cs.pos[2] + c[2]]} quaternion={cs.quat as unknown as THREE.Quaternion}>
    <mesh><planeGeometry args={[w, h]} /><meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} /></mesh>
    {label && <Html position={[0, -h / 2, 0]} center distanceFactor={12} style={{ pointerEvents: 'none' }}><div className="whitespace-nowrap rounded bg-black/60 px-1 text-[10px] text-white">{label}</div></Html>}</group>; };
  return <>{plane(d, '#f0b43c', 0.16, `focus ${d.toFixed(1)} m · f/${cs.fstop.toFixed(1)} · sharp ${near.toFixed(1)}–${far === Infinity ? '∞' : far.toFixed(1)} m`)}{near > 0.2 && plane(near, '#f0b43c', 0.05)}{far < 300 && plane(far, '#f0b43c', 0.05)}</>;
}
function CameraGizmos({ project, ghost }: { project: Project; ghost?: boolean }) {
  const t = useStudio((s) => s.t), sel = useStudio((s) => s.selection), show = useStudio((s) => s.overlays.frusta), shot = useStudio(activeShot);
  if (!show && !ghost) return null;
  return <>{Object.values(project.cameras).map((cam) => {
    const cs = evalCamera(project, cam, t), th = Math.tan(cs.fovY / 2), d = 1.4, active = shot?.cameraId === cam.id, selected = sel?.kind === 'camera' && sel.id === cam.id;
    const corner = (x: number, y: number): [number, number, number] => { const v = qRotate(cs.quat, [x * th * cs.aspect * d, y * th * d, -d]); return [cs.pos[0] + v[0], cs.pos[1] + v[1], cs.pos[2] + v[2]]; };
    const c = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], P = cs.pos as [number, number, number], col = ghost ? '#d97757' : selected ? '#ffffff' : active ? '#5ea8ff' : '#8b92a0';
    const path = !cam.attach && cam.keys.length > 1 ? Array.from({ length: 33 }, (_, i) => evalCamera(project, { ...cam, shake: { ...cam.shake, profile: 'none' } }, cam.keys[0].t + ((cam.keys[cam.keys.length - 1].t - cam.keys[0].t) * i) / 32).pos as [number, number, number]) : null;
    return <group key={cam.id}>
      <Line points={[P, c[0], c[1], P, c[2], c[3], P, c[0], c[3], c[2], c[1]]} color={col} lineWidth={active || selected || ghost ? 2 : 1} dashed={ghost} dashSize={0.2} gapSize={0.15} />
      {path && <Line points={path} color={col} lineWidth={1} dashed dashSize={0.25} gapSize={0.18} />}
      {!ghost && <mesh position={P} onPointerDown={(e) => { if (S().mode !== 'select') return; e.stopPropagation(); S().select({ kind: 'camera', id: cam.id }); }}><boxGeometry args={[0.28, 0.22, 0.36]} /><meshBasicMaterial color={col} /></mesh>}
      {!ghost && selected && !cam.attach && cam.keys.map((k) => <mesh key={k.id} position={k.pos as [number, number, number]} onPointerDown={(e) => { e.stopPropagation(); S().select({ kind: 'camera', id: cam.id, keyId: k.id }); S().setTime(k.t); }}><octahedronGeometry args={[sel?.keyId === k.id ? 0.17 : 0.11]} /><meshBasicMaterial color={sel?.keyId === k.id ? '#ffffff' : '#5ea8ff'} /></mesh>)}
      {!ghost && (active || selected) && <Html position={P} center distanceFactor={14} style={{ pointerEvents: 'none' }}><div className="whitespace-nowrap rounded bg-black/60 px-1 text-[10px] text-white">{cam.name}</div></Html>}
    </group>;
  })}</>;
}

function AxisAndEyelines() {
  const project = useStudio((s) => s.project), t = useStudio((s) => s.t), ov = useStudio((s) => s.overlays), sel = useStudio((s) => s.selection);
  const ids = Object.keys(project.characters); if (ids.length < 2 && !ov.eyelines) return null;
  const a = sel?.kind === 'character' ? sel.id : ids[0], b = ids.find((x) => x !== a);
  const st = Object.fromEntries(ids.map((id) => [id, evalCharacter(project, project.characters[id], t)]));
  let axis: [number, number, number][] | null = null;
  if (ov.axis && a && b) { const A = st[a].pos, B = st[b].pos, dx = B[0] - A[0], dz = B[2] - A[2], l = Math.hypot(dx, dz) || 1, e = 6; axis = [[A[0] - (dx / l) * e, A[1] + 0.06, A[2] - (dz / l) * e], [B[0] + (dx / l) * e, B[1] + 0.06, B[2] + (dz / l) * e]]; }
  return <>
    {axis && <><Line points={axis} color="#f06060" lineWidth={2} dashed dashSize={0.5} gapSize={0.3} /><Html position={axis[0]} center distanceFactor={16} style={{ pointerEvents: 'none' }}><div className="rounded bg-bad/80 px-1 text-[10px] text-white">180° line</div></Html></>}
    {ov.eyelines && ids.map((id) => { const s = st[id], c = project.characters[id], h: [number, number, number] = [s.pos[0], s.pos[1] + c.height * 0.92, s.pos[2]]; return <Line key={id} points={[h, [h[0] + Math.sin(s.yaw) * 4, h[1], h[2] + Math.cos(s.yaw) * 4]]} color={c.idColor} lineWidth={1.5} dashed dashSize={0.15} gapSize={0.1} />; })}
  </>;
}

/** Transform gizmo for the selected key / prop. One undo entry per drag. */
function Gizmo() {
  const sel = useStudio((s) => s.selection), project = useStudio((s) => s.project), tool = useStudio((s) => s.tool), mode = useStudio((s) => s.mode), t = useStudio((s) => s.t);
  const ref = useRef<THREE.Group>(null!);
  let pos: [number, number, number] | null = null, rot: [number, number, number] = [0, 0, 0], scl: [number, number, number] = [1, 1, 1], commit: (o: THREE.Object3D) => void = () => {}, gizmoMode: 'translate' | 'rotate' | 'scale' = 'translate';
  const s = S();
  if (sel && mode === 'select') {
    if (sel.kind === 'character') {
      const c = project.characters[sel.id]; if (c) {
        const k = c.keys.find((x) => x.id === sel.keyId) ?? c.keys.find((x) => Math.abs(x.t - t) < 0.5 / project.fps);
        if (k) { pos = lift(project, k.pos, 0); commit = (o) => s.dispatch({ type: 'moveKeyframe', target: { kind: 'character', id: c.id }, keyId: k.id, pos: [r2(o.position.x), k.pos[1], r2(o.position.z)] }); }
        else if (!c.keys.length) { pos = [0, 0, 0]; commit = (o) => s.dispatch({ type: 'addPathKey', characterId: c.id, key: { id: newId('k'), t: 0, pos: [r2(o.position.x), 0, r2(o.position.z)], clip: 'idle', facing: { mode: 'path' }, ease: 'linear', speed: 1 } }); }
      }
    } else if (sel.kind === 'camera') {
      const cam = project.cameras[sel.id], k = cam?.keys.find((x) => x.id === sel.keyId) ?? (cam?.keys.length === 1 ? cam.keys[0] : undefined);
      if (cam && k && !cam.attach) { pos = k.pos as [number, number, number]; commit = (o) => { const d: Vec3 = [o.position.x - k.pos[0], o.position.y - k.pos[1], o.position.z - k.pos[2]]; s.dispatch({ type: 'setCameraKey', cameraId: cam.id, keyId: k.id, patch: { pos: [r2(o.position.x), r2(o.position.y), r2(o.position.z)], ...(cam.lookAt ? {} : { target: [r2(k.target[0] + d[0]), r2(k.target[1] + d[1]), r2(k.target[2] + d[2])] as Vec3 }) } }, { label: `Move ${cam.name}` }); }; }
    } else if (sel.kind === 'prop') {
      const pr = project.props[sel.id]; if (pr) { pos = lift(project, pr.pos, 0); rot = pr.rot as [number, number, number]; scl = pr.scale as [number, number, number]; gizmoMode = tool; const g = terrainHeight(project.terrain, pr.pos[0], pr.pos[2]);
        commit = (o) => s.dispatch({ type: 'updateProp', id: pr.id, patch: { pos: [r2(o.position.x), r2(o.position.y - g), r2(o.position.z)], rot: [r2(o.rotation.x), r2(o.rotation.y), r2(o.rotation.z)], scale: [r2(o.scale.x), r2(o.scale.y), r2(o.scale.z)] } }, { label: `Transform ${pr.name}` }); }
    } else if (sel.kind === 'fx') { const f = project.fx[sel.id]; if (f && !f.attachTo) { pos = lift(project, f.pos, 0); commit = (o) => s.dispatch({ type: 'updateFx', id: f.id, patch: { pos: [r2(o.position.x), 0, r2(o.position.z)] } }); } }
  }
  useEffect(() => { if (ref.current && pos) { ref.current.position.set(...pos); ref.current.rotation.set(...rot); ref.current.scale.set(...scl); } });
  if (!pos) return null;
  return <><group ref={ref} /><TransformControls object={ref} mode={gizmoMode} size={0.8} onMouseUp={() => commit(ref.current)} /></>;
}
const r2 = (x: number) => Math.round(x * 100) / 100;

function ViewSync() {
  const { camera, controls } = useThree();
  useEffect(() => {
    const c = controls as unknown as { addEventListener?: (n: string, f: () => void) => void; removeEventListener?: (n: string, f: () => void) => void; target: THREE.Vector3; update(): void } | null; if (!c?.addEventListener) return;
    const push = () => S().set({ viewCam: { pos: camera.position.toArray() as [number, number, number], target: c.target.toArray() as [number, number, number], fov: (camera as THREE.PerspectiveCamera).fov } });
    const frame = (e: Event) => { const d = (e as CustomEvent<[number, number, number]>).detail; const off = camera.position.clone().sub(c.target); c.target.set(d[0], d[1] + 1, d[2]); camera.position.copy(c.target).add(off.setLength(Math.min(off.length(), 14))); c.update(); push(); };
    push(); c.addEventListener('end', push); window.addEventListener('blockout:frame', frame);
    return () => { c.removeEventListener?.('end', push); window.removeEventListener('blockout:frame', frame); };
  }, [camera, controls]);
  return null;
}
function Peers() {
  const peers = collab.usePeers();
  return <>{peers.map((p) => p.cursor && <group key={p.id} position={p.cursor}><mesh><coneGeometry args={[0.12, 0.4, 8]} /><meshBasicMaterial color={p.color} /></mesh><Html center distanceFactor={12} style={{ pointerEvents: 'none' }}><div className="mt-6 whitespace-nowrap rounded px-1 text-[10px] text-white" style={{ background: p.color }}>{p.name}</div></Html></group>)}</>;
}

const MODES: [Mode, string, string][] = [['select', 'Select', 'Select & transform (W/E/R)'], ['path', 'Path', 'Click the ground to lay the selected character\'s path'], ['pose', 'Pose', 'Click a joint of the selected character, rotate it, release to key it at the playhead'], ['sculpt', 'Sculpt', 'Drag on terrain to sculpt'], ['scatter', 'Scatter', 'Click to scatter set dressing']];
export function SceneView() {
  const project = useStudio((s) => s.project), ghost = useStudio((s) => s.ghost), mode = useStudio((s) => s.mode), ov = useStudio((s) => s.overlays), focus = useStudio((s) => s.focus), sculpt = useStudio((s) => s.sculpt), scatterKind = useStudio((s) => s.scatterKind);
  return <div className={`relative h-full w-full ${focus === 'scene' ? 'ring-1 ring-inset ring-accent/40' : ''}`} data-testid="scene-view" onPointerDown={() => S().set({ focus: 'scene' })}>
    <Canvas shadows camera={{ position: [7, 6, 13], fov: 42, near: 0.1, far: 800 }} dpr={[1, 1.5]} onPointerMissed={() => S().mode === 'select' && S().select(null)} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <Stage /><Paths project={project} /><CameraGizmos project={project} /><Trails /><FocusPlane /><AxisAndEyelines /><Gizmo /><PoseRig /><Peers />
      {ghost && <><Paths project={ghost} ghost /><CameraGizmos project={ghost} ghost /></>}
      <OrbitControls makeDefault target={[0, 1, 0]} maxPolarAngle={Math.PI / 2 - 0.02} enableDamping={false} mouseButtons={{ LEFT: mode === 'sculpt' ? (-1 as unknown as THREE.MOUSE) : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }} />
      <ViewSync /><GizmoHelper alignment="bottom-left" margin={[48, 48]}><GizmoViewport labelColor="white" axisHeadScale={0.9} /></GizmoHelper>
    </Canvas>
    <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap items-center gap-1">
      <div className="pointer-events-auto flex gap-1" role="toolbar" aria-label="Scene tools">{MODES.map(([m, label, title]) => <Toggle key={m} on={mode === m} title={title} onChange={() => S().set({ mode: m })}>{label}</Toggle>)}</div>
      {mode === 'sculpt' && <div className="pointer-events-auto flex items-center gap-1 rounded bg-panel/90 p-1">{(['raise', 'lower', 'smooth', 'flatten'] as const).map((o) => <Toggle key={o} on={sculpt.op === o} onChange={() => S().set({ sculpt: { ...sculpt, op: o } })}>{o}</Toggle>)}<span className="lbl ml-1">radius</span><input aria-label="Brush radius" type="range" min={2} max={30} value={sculpt.radius} onChange={(e) => S().set({ sculpt: { ...sculpt, radius: +e.target.value } })} /></div>}
      {mode === 'scatter' && <div className="pointer-events-auto flex items-center gap-1 rounded bg-panel/90 p-1">{(['grass', 'rock', 'tree'] as const).map((o) => <Toggle key={o} on={scatterKind === o} onChange={() => S().set({ scatterKind: o })}>{o}</Toggle>)}</div>}
    </div>
    <div className="pointer-events-auto absolute right-2 top-2 flex flex-wrap justify-end gap-1" role="toolbar" aria-label="Overlays">
      {OVERLAYS.filter((o) => !['thirds', 'golden', 'safe'].includes(o)).map((o) => <Toggle key={o} on={ov[o]} onChange={(v) => S().set({ overlays: { ...ov, [o]: v } })}>{o === 'axis' ? '180°' : o}</Toggle>)}
    </div>
    {ghost && <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded border border-claude bg-claude/20 px-2 py-1 text-xs text-fg">Previewing proposal — ghost paths in orange</div>}
  </div>;
}
export { characterPosition, nextIdColor };
