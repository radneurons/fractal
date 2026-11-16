import { evalCamera, newId } from '@blockout/core';
import { S, activeShot } from './store';
import { cameraFromView, keyframeAtPlayhead } from './panels/Inspector';

export function installHotkeys(openCommand: () => void) {
  const camKey = (e: Event) => { const id = (e as CustomEvent<string>).detail, s = S(), p = s.project, c = p.cameras[id]; if (!c) return; const ex = c.keys.find((k) => Math.abs(k.t - s.t) < 0.5 / p.fps); if (ex) return s.select({ kind: 'camera', id, keyId: ex.id });
    const cs = evalCamera(p, { ...c, shake: { ...c.shake, profile: 'none' }, attach: undefined, lookAt: undefined }, s.t), r = (v: number) => +v.toFixed(3), kid = newId('ck');
    s.dispatch({ type: 'addCameraKey', cameraId: id, key: { id: kid, t: s.t, pos: cs.pos.map(r) as [number, number, number], target: cs.target.map(r) as [number, number, number], focal: Math.round(cs.focal), focus: r(cs.focus), fstop: cs.fstop, roll: r(cs.roll), ease: 'easeInOut' } }); s.select({ kind: 'camera', id, keyId: kid }); };
  const onKey = (e: KeyboardEvent) => {
    const s = S(), mod = e.metaKey || e.ctrlKey, el = e.target as HTMLElement;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); return openCommand(); }
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? s.redo() : s.undo(); }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return s.redo(); }
    if (mod || e.altKey) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); return s.togglePlay(e.shiftKey ? 'cut' : s.focus === 'blockout' ? 'cut' : 'scene'); }
    if (k === ',') return s.step(-1); if (k === '.') return s.step(1);
    if (k === 'w' || k === 'W') return s.set({ tool: 'translate', mode: 'select' }); if (k === 'e' || k === 'E') return s.set({ tool: 'rotate', mode: 'select' }); if (k === 'r' || k === 'R') return s.set({ tool: 'scale', mode: 'select' });
    if (k === 'p' || k === 'P') return s.set({ mode: s.mode === 'path' ? 'select' : 'path' });
    if (k === 'k' || k === 'K') return keyframeAtPlayhead();
    if (k === 'c' || k === 'C') { cameraFromView(); return; }
    if (k === 'm' || k === 'M') { s.dispatch({ type: 'addMarker', marker: { id: newId('m'), t: s.t, label: 'Marker', kind: 'marker' } }); return; }
    if (k === 'f' || k === 'F') { const sel = s.selection, p = s.project; let pos: readonly number[] | null = null; if (sel?.kind === 'character' && p.characters[sel.id]) { const c = p.characters[sel.id]; pos = (c.keys.find((x) => x.id === sel.keyId) ?? c.keys[0])?.pos ?? null; } else if (sel?.kind === 'prop') pos = p.props[sel.id]?.pos ?? null; else if (sel?.kind === 'camera') pos = p.cameras[sel.id]?.keys[0].target ?? null; if (pos) window.dispatchEvent(new CustomEvent('blockout:frame', { detail: pos })); return; }
    if (k === 'Tab') { e.preventDefault(); return s.set({ focus: s.focus === 'scene' ? 'blockout' : 'scene' }); }
    if (k === 'Escape') return s.ghost ? s.previewProposal(null) : s.mode !== 'select' ? s.set({ mode: 'select' }) : s.select(null);
    if (k === 'Delete' || k === 'Backspace') { const sel = s.selection; if (!sel) return; if (sel.keyId && (sel.kind === 'character' || sel.kind === 'camera')) { if (s.dispatch({ type: 'removeKeyframe', target: { kind: sel.kind, id: sel.id }, keyId: sel.keyId })) s.select({ kind: sel.kind, id: sel.id }); } else if (sel.kind === 'prop') { s.dispatch({ type: 'removeProp', id: sel.id }); s.select(null); } else if (sel.kind === 'fx') { s.dispatch({ type: 'removeFx', id: sel.id }); s.select(null); } return; }
    if (/^[1-9]$/.test(k)) { const shot = s.project.shots[+k - 1]; if (shot) s.select({ kind: 'shot', id: shot.id }); return; }
    void activeShot;
  };
  window.addEventListener('keydown', onKey); window.addEventListener('blockout:camkey', camKey);
  return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('blockout:camkey', camKey); };
}
