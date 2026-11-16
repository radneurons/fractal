/** Phone virtual camera: the phone streams DeviceOrientation over a WebRTC data channel (signalled through the bridge's
 *  /phone relay, which also serves as the fallback transport). The studio aims the selected camera with it and records keys. */
import { qConj, qMul, qLookAt, qRotate, newId, evalCamera, type Quat, type Vec3, type CamKey, type Op } from '@blockout/core';

const DEG = Math.PI / 180;
/** W3C DeviceOrientation (alpha Z, beta X', gamma Y'') → quaternion, earth frame (x east, y north, z up). */
export function deviceQuat(alpha: number, beta: number, gamma: number, screenAngle = 0): Quat {
  const _x = (beta || 0) * DEG / 2, _y = (gamma || 0) * DEG / 2, _z = (alpha || 0) * DEG / 2, cX = Math.cos(_x), cY = Math.cos(_y), cZ = Math.cos(_z), sX = Math.sin(_x), sY = Math.sin(_y), sZ = Math.sin(_z);
  const q: Quat = [sX * cY * cZ - cX * sY * sZ, cX * sY * cZ + sX * cY * sZ, cX * cY * sZ + sX * sY * cZ, cX * cY * cZ - sX * sY * sZ];
  const o = -screenAngle * DEG / 2; return qMul(q, [0, 0, Math.sin(o), Math.cos(o)]);
}
/** Camera orientation now = orientation at calibration × the phone's rotation since calibration (in the phone's own frame). */
export const aimFrom = (cam0: Quat, phone0: Quat, phone: Quat): Quat => qMul(cam0, qMul(qConj(phone0), phone));
/** Turn an orientation into a key (target along -Z at the focus distance; roll relative to a level look-at). */
export function keyFromAim(t: number, pos: Vec3, q: Quat, focal: number, focus: number): CamKey {
  const fwd = qRotate(q, [0, 0, -1]), up = qRotate(q, [0, 1, 0]), target: Vec3 = [pos[0] + fwd[0] * focus, pos[1] + fwd[1] * focus, pos[2] + fwd[2] * focus], lvl = qRotate(qLookAt(pos, target, 0), [0, 1, 0]), right = qRotate(q, [1, 0, 0]);
  const roll = Math.atan2(lvl[0] * right[0] + lvl[1] * right[1] + lvl[2] * right[2], lvl[0] * up[0] + lvl[1] * up[1] + lvl[2] * up[2]) * -1, r = (x: number) => Math.round(x * 1000) / 1000;
  return { id: newId('ph'), t: Math.round(t * 1000) / 1000, pos: pos.map(r) as Vec3, target: target.map(r) as Vec3, focal, focus: r(focus), fstop: 2.8, roll: r(roll), ease: 'linear' };
}
export const recordingOps = (cameraId: string, keys: CamKey[], replaceFrom: number, replaceTo: number, existing: CamKey[]): Op[] => [
  { type: 'updateCamera', id: cameraId, patch: { lookAt: undefined, keys: [...existing.filter((k) => k.t < replaceFrom - 1e-6 || k.t > replaceTo + 1e-6), ...keys].sort((a, b) => a.t - b.t) } },
];
export interface PhoneLink { close(): void; transport(): 'webrtc' | 'relay' | 'connecting' }
/** Studio side: offer a data channel to whichever phone joins the room; call `onOrient` with each sample. */
export function listenForPhone(wsUrl: string, onOrient: (q: Quat, meta: { at: number }) => void, onState: (s: string) => void): PhoneLink {
  const ws = new WebSocket(wsUrl); let pc: RTCPeerConnection | null = null, mode: 'webrtc' | 'relay' | 'connecting' = 'connecting';
  const handle = (d: { q: Quat; at: number }) => onOrient(d.q, { at: d.at });
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data as string);
    if (m.type === 'hello') { // phone joined → offer
      pc?.close(); pc = new RTCPeerConnection({ iceServers: [] }); const ch = pc.createDataChannel('orient', { ordered: false, maxRetransmits: 0 });
      ch.onopen = () => { mode = 'webrtc'; onState('phone connected (WebRTC)'); }; ch.onmessage = (ev) => handle(JSON.parse(ev.data));
      pc.onicecandidate = (ev) => ev.candidate && ws.send(JSON.stringify({ type: 'ice', candidate: ev.candidate }));
      await pc.setLocalDescription(await pc.createOffer()); ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
      setTimeout(() => { if (mode !== 'webrtc') { mode = 'relay'; onState('phone connected (relay fallback)'); } }, 4000);
    } else if (m.type === 'answer') await pc?.setRemoteDescription(m.sdp);
    else if (m.type === 'ice') await pc?.addIceCandidate(m.candidate).catch(() => {});
    else if (m.type === 'orient' && mode !== 'webrtc') handle(m);
  };
  ws.onopen = () => onState('waiting for the phone…'); ws.onclose = () => onState('disconnected');
  return { close: () => { pc?.close(); ws.close(); }, transport: () => mode };
}
export { evalCamera };
