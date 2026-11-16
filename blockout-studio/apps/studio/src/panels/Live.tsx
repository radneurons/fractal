/** Live capture: webcam mocap (MediaPipe Pose), phone virtual camera, audio + beats, collaboration. */
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { buildMocapClip, evalCamera, newId, shotFrames, type Quat, type Vec3, type CamKey } from '@blockout/core';
import { detectBeats, peaks } from '@blockout/pipeline';
import { S, useStudio } from '../store';
import { Section } from '../ui';
import { collab } from '../collab';
import { putAsset } from '../persist';
import { rpc, useGateway } from '../gateway';
import { aimFrom, keyFromAim, listenForPhone, recordingOps, type PhoneLink } from '../phone';

export async function importAudio(file: File) {
  const buf = await file.arrayBuffer(), ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(), audio = await ctx.decodeAudioData(buf.slice(0)), ch = audio.getChannelData(0);
  const id = newId('aud'); await putAsset(id, new Blob([buf], { type: file.type || 'audio/mpeg' }));
  const beats = detectBeats(ch, audio.sampleRate), p = S().project;
  S().dispatch({ type: 'batch', label: `Import ${file.name}${beats.bpm ? ` (${beats.bpm} BPM)` : ''}`, ops: [{ type: 'addAudio', audio: { id, name: file.name, assetId: id, offset: 0, gain: 1, peaks: peaks(ch, Math.min(4000, Math.ceil(audio.duration * 40))), duration: audio.duration } }, ...beats.beats.filter((t) => t <= p.duration).map((t, i) => ({ type: 'addMarker' as const, marker: { id: `${id}_b${i}`, t: Math.round(t * 1000) / 1000, label: beats.bpm ? `${beats.bpm} BPM` : 'onset', kind: 'beat' as const } }))] });
  S().notify(beats.bpm ? `${file.name}: ${beats.bpm} BPM, ${beats.beats.length} beat markers (keys snap to them)` : `${file.name}: ${beats.onsets.length} onsets`); void ctx.close();
}

function Mocap() {
  const sel = useStudio((s) => s.selection), video = useRef<HTMLVideoElement>(null), [state, setState] = useState('idle'), frames = useRef<Vec3[][]>([]), stop = useRef<() => void>(() => {});
  const ch = sel?.kind === 'character' ? S().project.characters[sel.id] : null;
  const start = async () => {
    try {
      setState('loading MediaPipe Pose…'); const vision = await import('@mediapipe/tasks-vision'), fs = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm');
      const pose = await vision.PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task', delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1 });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } }), v = video.current!; v.srcObject = stream; await v.play(); frames.current = []; setState('recording — perform, then Stop');
      const fps = S().project.fps; let last = -1, raf = 0; const t0 = performance.now();
      const loop = () => { raf = requestAnimationFrame(loop); const now = performance.now(), f = Math.floor(((now - t0) / 1000) * fps); if (f === last) return; last = f; const r = pose.detectForVideo(v, now), w = r.worldLandmarks?.[0]; if (w) frames.current.push(w.map((p) => [p.x, -p.y, -p.z] as Vec3)); };
      loop(); stop.current = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); pose.close(); };
    } catch (e) { setState(`error: ${(e as Error).message}`); }
  };
  const finish = () => { stop.current(); if (!ch || frames.current.length < 6) return setState(`captured ${frames.current.length} frames — too short`);
    const clip = buildMocapClip(newId('clip'), `${ch.name} take ${new Date().toLocaleTimeString()}`, frames.current, S().project.fps, ch.height), key = ch.keys.find((k) => k.id === sel?.keyId) ?? [...ch.keys].reverse().find((k) => k.t <= S().t);
    S().dispatch({ type: 'batch', label: `Mocap clip for ${ch.name}`, ops: [{ type: 'addClip', clip }, ...(key ? [{ type: 'setPathKey' as const, characterId: ch.id, keyId: key.id, patch: { clip: clip.id } }] : [])] }); setState(`clip "${clip.name}" (${clip.frames.length} frames) ${key ? `applied at ${key.t.toFixed(2)}s` : 'added'}`); };
  return <Section title="Webcam mocap">
    <p className="text-xxs text-dim">MediaPipe Pose in the browser → retargeted onto {ch ? <b>{ch.name}</b> : 'the selected character'} as a new clip, smoothed and foot-locked. The model downloads from Google's CDN on first use.</p>
    <video ref={video} className="mt-1 w-full rounded bg-black" muted playsInline style={{ display: state.startsWith('recording') ? 'block' : 'none', transform: 'scaleX(-1)' }} />
    <div className="mt-1 flex gap-1"><button className="btn-primary" disabled={!ch || state.startsWith('recording')} onClick={() => void start()}>Record</button><button className="btn" disabled={!state.startsWith('recording')} onClick={finish}>Stop</button></div><p className="mt-0.5 text-xxs">{state}</p>
  </Section>;
}

function PhoneCam() {
  const sel = useStudio((s) => s.selection), connected = useGateway((g) => g.connected), [qr, setQr] = useState<string | null>(null), [url, setUrl] = useState(''), [state, setState] = useState('off'), [rec, setRec] = useState(false);
  const recRef = useRef(false), timer = useRef<ReturnType<typeof setInterval> | null>(null), link = useRef<PhoneLink | null>(null), latest = useRef<Quat | null>(null), cal = useRef<{ cam: Quat; phone: Quat } | null>(null), keys = useRef<CamKey[]>([]), rec0 = useRef(0);
  const camId = sel?.kind === 'camera' ? sel.id : null;
  useEffect(() => () => link.current?.close(), []);
  const pair = async () => {
    const room = Math.random().toString(36).slice(2, 8), ips = connected ? await rpc<string[]>('lanAddresses').catch(() => []) : [], host = ips[0] ? `${location.protocol}//${ips[0]}:${location.port}` : location.origin, u = `${host}/?phone=${room}`;
    setUrl(u); setQr(await QRCode.toDataURL(u, { margin: 1, width: 220 }));
    link.current?.close(); link.current = listenForPhone(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bridge/phone?room=${room}`, (q) => { latest.current = q; const s = S(), c = camId && s.project.cameras[camId]; if (!c || !cal.current) return;
      const cs = evalCamera(s.project, c, s.t), aim = aimFrom(cal.current.cam, cal.current.phone, q), k = keyFromAim(s.t, cs.pos, aim, Math.round(cs.focal), cs.focus);
      s.set({ ghost: { ...s.project, cameras: { ...s.project.cameras, [c.id]: { ...c, lookAt: undefined, keys: [k] } } } }); }, setState);
  };
  const calibrate = () => { const s = S(), c = camId && s.project.cameras[camId]; if (!c || !latest.current) return s.notify('Pair the phone and select a camera first.', 'error'); cal.current = { cam: evalCamera(s.project, c, s.t).quat, phone: latest.current }; s.notify('Calibrated: the phone now matches the camera.'); };
  const toggleRec = () => { const s = S(); if (!camId) return; if (!recRef.current) { keys.current = []; rec0.current = s.t; recRef.current = true; setRec(true); if (!s.playing) s.togglePlay('scene');
      // sample the latest orientation at 12 keys/s of scene time, independent of how messages arrive
      timer.current = setInterval(() => { const st = S(), c = st.project.cameras[camId], q = latest.current; if (!c || !q || !cal.current || !st.playing) return; const last = keys.current[keys.current.length - 1]; if (last && st.t - last.t < 1 / 12) return; const cs = evalCamera(st.project, c, st.t); keys.current.push(keyFromAim(st.t, cs.pos, aimFrom(cal.current.cam, cal.current.phone, q), Math.round(cs.focal), cs.focus)); }, 20); return; }
    if (timer.current) clearInterval(timer.current); recRef.current = false; setRec(false); s.set({ playing: false, ghost: null }); const c = s.project.cameras[camId]; if (keys.current.length < 2) return s.notify('Nothing recorded (keep the scene playing while recording).', 'error');
    s.dispatch({ type: 'batch', label: `Phone camera take on ${c.name}`, ops: recordingOps(camId, keys.current, rec0.current, keys.current[keys.current.length - 1].t, c.keys) }); s.notify(`Recorded ${keys.current.length} camera keys.`); };
  return <Section title="Phone virtual camera">
    <p className="text-xxs text-dim">Pair a phone; its gyroscope drives the selected camera ({camId ? S().project.cameras[camId]?.name : 'select a camera'}) for real handheld operation, recorded as keys while the scene plays.</p>
    {!connected && <p className="text-xxs text-warn">Needs the bridge (`pnpm bridge`) and the studio served on your LAN (`pnpm dev` already uses --host).</p>}
    <div className="mt-1 flex flex-wrap gap-1"><button className="btn" disabled={!connected} onClick={() => void pair()}>Pair phone</button><button className="btn" disabled={!camId} onClick={calibrate}>Calibrate</button><button className={rec ? 'btn border-bad text-bad' : 'btn-primary'} disabled={!camId || !cal.current} onClick={toggleRec}>{rec ? '■ Stop' : '● Record'}</button></div>
    {qr && <div className="mt-1 flex items-center gap-2"><img alt="Pairing QR code" src={qr} className="h-28 w-28 rounded bg-white p-1" /><div className="text-xxs"><p className="break-all">{url}</p><p className="text-dim">{state}</p></div></div>}
  </Section>;
}

function Collab() {
  const status = collab.useStatus(), peers = collab.usePeers(), connected = useGateway((g) => g.connected), [room, setRoom] = useState('field-duel'), [name, setName] = useState(() => { try { return localStorage.getItem('blockout:name') ?? ''; } catch { return ''; } });
  return <Section title="Collaborate">
    <p className="text-xxs text-dim">Yjs over the op stream: every edit is an op appended to a shared log, so two people can block a scene together and converge. Presence cursors appear in the 3D view.</p>
    <div className="mt-1 flex gap-1"><input aria-label="Your name" className="inp" placeholder="your name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /><input aria-label="Room" className="inp" value={room} onChange={(e) => setRoom(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></div>
    <div className="mt-1 flex items-center gap-1">{collab.room ? <button className="btn" onClick={() => collab.disconnect()}>Leave</button> : <button className="btn-primary" disabled={!connected} data-testid="collab-join" onClick={() => { try { localStorage.setItem('blockout:name', name); } catch { /* */ } collab.connect(room, name); }}>Join room</button>}<span className="text-xxs text-dim" data-testid="collab-status">{status}</span></div>
    {peers.length > 0 && <ul className="mt-1 text-xxs">{peers.map((p) => <li key={p.id}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}</li>)}</ul>}
  </Section>;
}

export function LivePanel() {
  const audio = useStudio((s) => s.project.audio), file = useRef<HTMLInputElement>(null), shot = useStudio((s) => s.project.shots.find((x) => x.id === s.activeShotId));
  return <div className="h-full overflow-auto" data-testid="live-panel">
    <Section title="Audio & beats" right={<button className="btn" onClick={() => file.current?.click()}>+ Import audio</button>}>
      <input ref={file} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importAudio(f).catch((err) => S().notify(String(err.message), 'error')); e.target.value = ''; }} />
      <p className="text-xxs text-dim">Waveforms show in the timeline; detected beats become markers that keys and cuts snap to.</p>
      <ul className="text-xxs">{Object.values(audio).map((a) => <li key={a.id} className="flex justify-between"><span>♪ {a.name} · {a.duration.toFixed(1)}s</span><button className="text-bad" onClick={() => S().dispatch({ type: 'removeAudio', id: a.id })}>✕</button></li>)}</ul>
      {shot && <p className="mt-1 text-xxs text-dim">Active shot: {shotFrames(S().project, shot)} frames.</p>}
    </Section>
    <Mocap /><PhoneCam /><Collab />
  </div>;
}
