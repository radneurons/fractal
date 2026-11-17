// Live output (SPEC §14.5).
//  • Audience window: window.open; it shows the stage through canvas.captureStream() in a <video>, fullscreened on
//    another screen with the Window Management API where available.
//  • BroadcastChannel sync: the presenter broadcasts analyser reports and operator actions; a `?live&output` page in
//    the same browser renders the same stage itself (chrome-free, for a second monitor or an OBS window capture).
//    OBS's own browser source runs in a separate process, so there `?live&output` runs standalone: it takes its own
//    input and the operator cues it with OBS's "Interact" keys.
import type { OnlineState } from './types.ts';
import type { OnlineDelta } from './session.ts';
import type { FollowMode } from './follow.ts';

export type LiveMsg =
  | { type: 'report'; state: OnlineState; delta: OnlineDelta }
  | { type: 'action'; action: 'cue' | 'tap' | 'back'; t: number; bpm: number }
  | { type: 'mode'; mode: FollowMode }
  | { type: 'config'; effect: string; lyricsText: string; aspect: string; settings: Record<string, unknown> }
  | { type: 'hello' };

export const CHANNEL = 'lyric-engine-live';

export function liveChannel(on: (m: LiveMsg) => void): { post(m: LiveMsg): void; close(): void } {
  if (typeof BroadcastChannel === 'undefined') return { post: () => {}, close: () => {} };
  const bc = new BroadcastChannel(CHANNEL);
  bc.onmessage = (e) => on(e.data as LiveMsg);
  return { post: (m) => bc.postMessage(m), close: () => bc.close() };
}

interface ScreenDetailsLike { screens: (Screen & { isPrimary?: boolean; availLeft?: number; availTop?: number; label?: string })[]; currentScreen: Screen }

/** Open the audience window showing `canvas` live. Returns a handle to close it. */
export async function openAudience(canvas: HTMLCanvasElement): Promise<{ win: Window; close(): void } | null> {
  let features = 'popup,width=960,height=540';
  let target: (Screen & { availLeft?: number; availTop?: number }) | null = null;
  const w = window as unknown as { getScreenDetails?: () => Promise<ScreenDetailsLike> };
  if (w.getScreenDetails) {
    try {
      const d = await w.getScreenDetails();
      target = d.screens.find((s) => s !== d.currentScreen && !s.isPrimary) ?? d.screens.find((s) => s !== d.currentScreen) ?? null;
      if (target) features = `popup,left=${target.availLeft ?? 0},top=${target.availTop ?? 0},width=${target.availWidth},height=${target.availHeight}`;
    } catch { /* permission denied: open on this screen */ }
  }
  const win = window.open('', 'lyric-engine-audience', features);
  if (!win) return null;
  const d = win.document;
  d.title = 'Lyric Engine — audience';
  d.body.innerHTML = '';
  d.body.style.cssText = 'margin:0;background:#000;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:none';
  const video = d.createElement('video');
  video.muted = true; video.autoplay = true; video.playsInline = true;
  video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
  const stream = canvas.captureStream(60);
  video.srcObject = stream;
  d.body.appendChild(video);
  const hint = d.createElement('div');
  hint.textContent = 'Click or press F for fullscreen';
  hint.style.cssText = 'position:fixed;bottom:12px;left:0;right:0;text-align:center;color:#888;font:14px system-ui;transition:opacity 1s';
  d.body.appendChild(hint);
  setTimeout(() => { hint.style.opacity = '0'; }, 3500);
  const fs = () => { const el = d.documentElement as HTMLElement & { requestFullscreen(o?: { screen?: unknown }): Promise<void> }; void el.requestFullscreen(target ? { screen: target } : undefined).catch(() => el.requestFullscreen().catch(() => {})); };
  d.addEventListener('click', fs);
  d.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') fs(); });
  void video.play().catch(() => {});
  return { win, close: () => { for (const t of stream.getTracks()) t.stop(); win.close(); } };
}
