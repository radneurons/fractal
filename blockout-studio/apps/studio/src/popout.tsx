/** Pop-out viewers: a second window (e.g. on another monitor) that mirrors the editor's state over a BroadcastChannel.
 *  The pop-out is read-only and never autosaves; the main window stays the source of truth. */
import React, { useEffect, useState } from 'react';
import { S, useStudio, type Studio } from './store';
import { BlockoutView, ResultView } from './panels/BlockoutView';
import { loadAssets } from './persist';

const CH = 'blockout-sync';
type Shared = Pick<Studio, 'project' | 't' | 'activeShotId' | 'blockoutPass' | 'overlays' | 'currentTakeId' | 'compareTakeId' | 'resultOpacity' | 'theme' | 'selection'>;
const pick = (s: Studio): Shared => ({ project: s.project, t: s.t, activeShotId: s.activeShotId, blockoutPass: s.blockoutPass, overlays: s.overlays, currentTakeId: s.currentTakeId, compareTakeId: s.compareTakeId, resultOpacity: s.resultOpacity, theme: s.theme, selection: s.selection });
/** Main window: answer hellos with full state, then stream changes (project only when it changed). */
export function startPopoutHost(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(CH);
  ch.onmessage = (e) => { if (e.data?.type === 'hello') ch.postMessage({ type: 'state', state: pick(S()) }); if (e.data?.type === 'assets') void 0; };
  const off = useStudio.subscribe((s, p) => { const d: Partial<Shared> = {}; let any = false; for (const k of Object.keys(pick(s)) as (keyof Shared)[]) if (s[k] !== p[k]) { (d as Record<string, unknown>)[k] = s[k]; any = true; } if (any) ch.postMessage({ type: 'state', state: d }); });
  return () => { off(); ch.close(); };
}
export function openPopout(view: 'blockout' | 'result') { window.open(`${location.pathname}?view=${view}`, `blockout-${view}`, 'popup,width=960,height=480'); }
export function PopoutPage({ view }: { view: string }) {
  const [live, setLive] = useState(false), theme = useStudio((s) => s.theme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    void loadAssets(); const ch = new BroadcastChannel(CH);
    ch.onmessage = (e) => { if (e.data?.type === 'state') { useStudio.setState(e.data.state); setLive(true); if (e.data.state.project) void loadAssets(); } };
    ch.postMessage({ type: 'hello' }); document.title = `Blockout · ${view}`; return () => ch.close();
  }, [view]);
  return <div className="flex h-full flex-col" data-testid={`popout-${view}`}>
    {!live && <div className="p-3 text-dim">Waiting for the editor window…</div>}
    {live && (view === 'result' ? <ResultView /> : <BlockoutView />)}
  </div>;
}
