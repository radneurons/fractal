import React, { useEffect, useRef, useState } from 'react';
import { deviceQuat } from '../phone';

/** Runs on the phone (open the QR link). Streams orientation over WebRTC, falling back to the WebSocket relay. */
export function PhonePage({ room }: { room: string }) {
  const [state, setState] = useState('tap Start to stream your phone\'s orientation'), [q, setQ] = useState<number[]>([0, 0, 0, 1]), send = useRef<(m: unknown) => void>(() => {});
  const start = async () => {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }; if (DOE.requestPermission && (await DOE.requestPermission()) !== 'granted') return setState('orientation permission denied');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bridge/phone?room=${encodeURIComponent(room)}`); let ch: RTCDataChannel | null = null, pc: RTCPeerConnection | null = null;
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello' })); setState('connected to studio — negotiating…'); };
    ws.onmessage = async (e) => { const m = JSON.parse(e.data); if (m.type === 'offer') { pc = new RTCPeerConnection({ iceServers: [] }); pc.ondatachannel = (ev) => { ch = ev.channel; ch.onopen = () => setState('streaming (WebRTC)'); }; pc.onicecandidate = (ev) => ev.candidate && ws.send(JSON.stringify({ type: 'ice', candidate: ev.candidate })); await pc.setRemoteDescription(m.sdp); await pc.setLocalDescription(await pc.createAnswer()); ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription })); } else if (m.type === 'ice') await pc?.addIceCandidate(m.candidate).catch(() => {}); };
    ws.onclose = () => setState('disconnected');
    send.current = (msg) => { const s = JSON.stringify(msg); if (ch?.readyState === 'open') ch.send(s); else if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'orient', ...(msg as object) })); };
    window.addEventListener('deviceorientation', (e) => { const qq = deviceQuat(e.alpha ?? 0, e.beta ?? 0, e.gamma ?? 0, (screen.orientation?.angle ?? 0)); setQ(qq); send.current({ q: qq, at: performance.now() }); });
  };
  useEffect(() => () => { send.current = () => {}; }, []);
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"><h1 className="text-lg font-semibold">▚ Blockout virtual camera</h1><p className="text-dim">Room {room}</p>
    <button className="btn-primary !px-6 !py-3 !text-base" onClick={() => void start()}>Start</button><p data-testid="phone-state">{state}</p><p className="font-mono text-xxs text-dim">{q.map((v) => v.toFixed(3)).join(' ')}</p>
    <p className="max-w-xs text-xxs text-dim">Hold the phone like a camera (back camera = lens). In the studio press Calibrate, then Record while the scene plays. iOS needs the page served over HTTPS for motion sensors.</p></div>;
}
