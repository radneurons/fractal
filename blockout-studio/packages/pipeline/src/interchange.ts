/** Cut and scene interchange: OpenTimelineIO, FCPXML, CMX3600 EDL, and a USDA scene. Pure string builders. */
import { ASPECTS, compileFrame, evalCamera, shotFrames, type Project, type Shot } from '@blockout/core';

export interface CutClip { shot: Shot; frames: number; srcIn: number; srcOut: number; recIn: number; recOut: number; media: string; takeId?: string; transitionFrames: number }
/** Resolve the cut: each shot's selected take (or the blockout), trims, and record positions in frames. */
export function cutList(p: Project, mediaFor: (shot: Shot) => string = (s) => `${s.id}.mp4`): CutClip[] {
  let rec = 0; return p.shots.map((shot) => { const total = shotFrames(p, shot), tin = Math.round(shot.trimIn * p.fps), tout = Math.round(shot.trimOut * p.fps), frames = Math.max(1, total - tin - tout), tr = shot.transition.kind === 'crossfade' ? Math.min(frames - 1, Math.round(shot.transition.duration * p.fps)) : 0; if (tr && rec > 0) rec -= tr; const c: CutClip = { shot, frames, srcIn: tin, srcOut: tin + frames, recIn: rec, recOut: rec + frames, media: mediaFor(shot), takeId: shot.selectedTakeId, transitionFrames: rec > 0 || tr === 0 ? tr : 0 }; rec += frames; return c; });
}
const rt = (frames: number, fps: number) => ({ OTIO_SCHEMA: 'RationalTime.1', rate: fps, value: frames });
const tr = (start: number, dur: number, fps: number) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rt(start, fps), duration: rt(dur, fps) });
export function toOTIO(p: Project, clips = cutList(p)): string {
  const fps = p.fps, video: unknown[] = [], audio: unknown[] = [];
  for (const c of clips) {
    if (c.transitionFrames) video.push({ OTIO_SCHEMA: 'Transition.1', name: 'crossfade', transition_type: 'SMPTE_Dissolve', in_offset: rt(Math.floor(c.transitionFrames / 2), fps), out_offset: rt(Math.ceil(c.transitionFrames / 2), fps), metadata: {} });
    video.push({ OTIO_SCHEMA: 'Clip.2', name: c.shot.name, source_range: tr(c.srcIn, c.frames, fps), active_media_reference_key: 'DEFAULT_MEDIA', media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: 'ExternalReference.1', target_url: c.media, available_range: tr(0, shotFrames(p, c.shot), fps), metadata: {} } }, effects: [], markers: [], metadata: { blockout: { shotId: c.shot.id, takeId: c.takeId ?? null, sceneStart: c.shot.start, sceneEnd: c.shot.end, camera: p.cameras[c.shot.cameraId]?.name, notes: c.shot.notes, audioLead: c.shot.audioLead, audioTail: c.shot.audioTail } } });
  }
  for (const a of Object.values(p.audio)) audio.push({ OTIO_SCHEMA: 'Clip.2', name: a.name, source_range: tr(0, Math.round(a.duration * fps), fps), active_media_reference_key: 'DEFAULT_MEDIA', media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: 'ExternalReference.1', target_url: `audio/${a.name}`, available_range: tr(0, Math.round(a.duration * fps), fps), metadata: {} } }, effects: [], markers: [], metadata: { offset: a.offset, gain: a.gain } });
  const track = (name: string, kind: string, children: unknown[]) => ({ OTIO_SCHEMA: 'Track.1', name, kind, children, effects: [], markers: [], metadata: {}, source_range: null });
  return JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', name: p.name, global_start_time: rt(0, fps), metadata: { generator: 'Blockout Studio', aspect: p.aspect }, tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', children: [track('V1', 'Video', video), ...(audio.length ? [track('A1', 'Audio', audio)] : [])], effects: [], markers: Object.values(p.markers).map((m) => ({ OTIO_SCHEMA: 'Marker.2', name: m.label, color: m.kind === 'beat' ? 'ORANGE' : 'YELLOW', marked_range: tr(Math.round(m.t * fps), 0, fps), metadata: {} })), metadata: {}, source_range: null } }, null, 1);
}
const tc = (f: number, fps: number) => { const s = Math.floor(f / fps); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, f % fps].map((v) => String(v).padStart(2, '0')).join(':'); };
export function toEDL(p: Project, clips = cutList(p)): string {
  const fps = p.fps, base = 3600 * fps, lines = [`TITLE: ${p.name.toUpperCase()}`, 'FCM: NON-DROP FRAME', ''];
  clips.forEach((c, i) => { const reel = c.shot.id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8).padEnd(8, ' '), ev = String(i + 1).padStart(3, '0'), trn = c.transitionFrames ? `D    ${String(c.transitionFrames).padStart(3, '0')}` : 'C        ';
    lines.push(`${ev}  ${reel} V     ${trn} ${tc(c.srcIn, fps)} ${tc(c.srcOut, fps)} ${tc(base + c.recIn, fps)} ${tc(base + c.recOut, fps)}`, `* FROM CLIP NAME: ${c.shot.name}`, `* SOURCE FILE: ${c.media}`, ...(c.shot.notes ? [`* COMMENT: ${c.shot.notes.replace(/\n/g, ' ')}`] : []), ''); });
  return lines.join('\n');
}
const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function toFCPXML(p: Project, clips = cutList(p), height = 1080): string {
  const fps = p.fps, w = Math.round((height * ASPECTS[p.aspect]) / 2) * 2, t = (f: number) => `${f}/${fps}s`, total = clips.length ? clips[clips.length - 1].recOut : 0;
  const assets = clips.map((c, i) => `    <asset id="r${i + 2}" name="${x(c.shot.name)}" start="0s" duration="${t(shotFrames(p, c.shot))}" hasVideo="1" format="r1"><media-rep kind="original-media" src="${x(c.media)}"/></asset>`).join('\n');
  const spine = clips.map((c, i) => `${c.transitionFrames ? `          <transition name="Cross Dissolve" offset="${t(c.recIn)}" duration="${t(c.transitionFrames)}"/>\n` : ''}          <asset-clip ref="r${i + 2}" name="${x(c.shot.name)}" offset="${t(c.recIn)}" start="${t(c.srcIn)}" duration="${t(c.frames)}" format="r1">${c.shot.notes ? `<note>${x(c.shot.notes)}</note>` : ''}</asset-clip>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">\n  <resources>\n    <format id="r1" name="FFVideoFormat${height}p${fps}" frameDuration="1/${fps}s" width="${w}" height="${height}"/>\n${assets}\n  </resources>\n  <library>\n    <event name="${x(p.name)}">\n      <project name="${x(p.name)} — cut">\n        <sequence format="r1" duration="${t(total)}" tcStart="0s" tcFormat="NDF">\n        <spine>\n${spine}\n        </spine>\n        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>\n`;
}
/** USDA scene: static set + characters at a given time as Xform'd primitives, and every camera with time-sampled transforms. */
export function toUSDA(p: Project, t = 0): string {
  const scene = compileFrame(p, t), fps = p.fps, n = Math.round(p.duration * fps), q = (v: number) => +v.toFixed(5), safe = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  const mat = (m: number[]) => `( (${m.slice(0, 4).map(q).join(', ')}), (${m.slice(4, 8).map(q).join(', ')}), (${m.slice(8, 12).map(q).join(', ')}), (${m.slice(12, 16).map(q).join(', ')}) )`;
  const PRIM: Record<string, string> = { box: 'Cube "geo" { double size = 1 }', sphere: 'Sphere "geo" { double radius = 0.5 }', cylinder: 'Cylinder "geo" { double radius = 0.5\n double height = 1\n uniform token axis = "Y" }', cone: 'Cone "geo" { double radius = 0.5\n double height = 1\n uniform token axis = "Y" }', plane: 'Cube "geo" { double size = 1\n float3 xformOp:scale = (1, 0.001, 1)\n uniform token[] xformOpOrder = ["xformOp:scale"] }' };
  const groups = new Map<string, string[]>();
  for (const d of scene.drawables) { if (d.layer === 'fx') continue; const g = groups.get(d.entityId) ?? []; g.push(`        def Xform "${safe(d.key.split(':').slice(1).join('_') || 'part')}" {\n            matrix4d xformOp:transform = ${mat(d.matrix)}\n            uniform token[] xformOpOrder = ["xformOp:transform"]\n            def ${PRIM[d.kind]}\n        }`); groups.set(d.entityId, g); }
  const ents = [...groups].map(([id, parts]) => `    def Xform "${safe(id)}" (\n        customData = { string blockoutName = "${(p.characters[id]?.name ?? p.props[id]?.name ?? id).replace(/"/g, "'")}" }\n    ) {\n${parts.join('\n')}\n    }`).join('\n');
  const cams = Object.values(p.cameras).map((c) => {
    const xf: string[] = [], fl: string[] = [], fd: string[] = [];
    for (let f = 0; f <= n; f += 1) { const cs = evalCamera(p, c, f / fps), [x0, y0, z0, w0] = cs.quat, m = [1 - 2 * (y0 * y0 + z0 * z0), 2 * (x0 * y0 + w0 * z0), 2 * (x0 * z0 - w0 * y0), 0, 2 * (x0 * y0 - w0 * z0), 1 - 2 * (x0 * x0 + z0 * z0), 2 * (y0 * z0 + w0 * x0), 0, 2 * (x0 * z0 + w0 * y0), 2 * (y0 * z0 - w0 * x0), 1 - 2 * (x0 * x0 + y0 * y0), 0, cs.pos[0], cs.pos[1], cs.pos[2], 1]; xf.push(`${f}: ${mat(m)}`); fl.push(`${f}: ${q(cs.focal)}`); fd.push(`${f}: ${q(cs.focus)}`); }
    const a = ASPECTS[p.aspect], hap = a >= 1 ? c.sensorWidth : c.sensorWidth * a;
    return `    def Camera "${safe(c.id)}" (\n        customData = { string blockoutName = "${c.name.replace(/"/g, "'")}" }\n    ) {\n        float horizontalAperture = ${q(hap)}\n        float verticalAperture = ${q(hap / a)}\n        float2 clippingRange = (0.1, 1000)\n        float focalLength.timeSamples = { ${fl.join(', ')} }\n        float focusDistance.timeSamples = { ${fd.join(', ')} }\n        matrix4d xformOp:transform.timeSamples = {\n            ${xf.join(',\n            ')}\n        }\n        uniform token[] xformOpOrder = ["xformOp:transform"]\n    }`;
  }).join('\n');
  return `#usda 1.0\n(\n    defaultPrim = "Scene"\n    metersPerUnit = 1\n    upAxis = "Y"\n    startTimeCode = 0\n    endTimeCode = ${n}\n    timeCodesPerSecond = ${fps}\n    doc = "Blockout Studio export of ${p.name.replace(/"/g, "'")} (geometry posed at t=${t}s; cameras animated)"\n)\n\ndef Xform "Scene" {\n    def Xform "Ground" { def Mesh "geo" {\n        point3f[] points = [(-${p.terrain.size / 2}, 0, -${p.terrain.size / 2}), (${p.terrain.size / 2}, 0, -${p.terrain.size / 2}), (${p.terrain.size / 2}, 0, ${p.terrain.size / 2}), (-${p.terrain.size / 2}, 0, ${p.terrain.size / 2})]\n        int[] faceVertexCounts = [4]\n        int[] faceVertexIndices = [0, 3, 2, 1]\n    } }\n${ents}\n${cams}\n}\n`;
}
