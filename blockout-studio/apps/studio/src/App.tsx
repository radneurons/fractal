import React, { useEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { demoProject, emptyProject } from '@blockout/core';
import { S, useStudio } from './store';
import { SceneView } from './panels/SceneView';
import { BlockoutView, ResultView } from './panels/BlockoutView';
import { Timeline } from './panels/Timeline';
import { AddMenu, Inspector } from './panels/Inspector';
import { PromptPanel } from './panels/Prompt';
import { BiblesPanel } from './panels/Bibles';
import { TakesPanel } from './panels/Takes';
import { ClaudePanel } from './panels/Claude';
import { LivePanel } from './panels/Live';
import { CommandBar } from './panels/CommandBar';
import { installHotkeys } from './hotkeys';
import { exportBlockout, importBlockout, recover, startAutosave, changeLogMarkdown } from './persist';
import { download } from './ui';
import { exportShotPackage } from './exporter';
import { connectBridge, startProjectSync } from './gateway';
import { initBaselines } from './director';
import { startModelSync } from './models';
import { startPopoutHost } from './popout';

const TABS: [string, string, React.FC][] = [['inspector', 'Inspector', Inspector], ['prompt', 'Prompt', PromptPanel], ['bibles', 'Bibles', BiblesPanel], ['takes', 'Takes', TakesPanel], ['claude', 'Claude', ClaudePanel], ['live', 'Live', LivePanel]];

function TopBar({ openCommand }: { openCommand: () => void }) {
  const name = useStudio((s) => s.project.name), canUndo = useStudio((s) => s.history.past.length > 0), canRedo = useStudio((s) => s.history.future.length > 0), last = useStudio((s) => s.history.past[s.history.past.length - 1]?.label), theme = useStudio((s) => s.theme), savedAt = useStudio((s) => s.savedAt), pending = useStudio((s) => s.proposals.filter((p) => p.status === 'pending').length);
  const file = useRef<HTMLInputElement>(null), exportHeight = useStudio((s) => s.exportHeight);
  return <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-2" role="banner">
    <span className="font-semibold tracking-tight text-fg">▚ Blockout Studio</span><span className="text-dim">/</span><span className="truncate text-fg" data-testid="project-name">{name}</span>
    <AddMenu />
    <button className="btn" data-testid="undo" disabled={!canUndo} onClick={() => S().undo()} title={last ? `Undo: ${last} (⌘Z)` : 'Nothing to undo'}>↶ Undo</button>
    <button className="btn" data-testid="redo" disabled={!canRedo} onClick={() => S().redo()} title="Redo (⇧⌘Z)">↷ Redo</button>
    <span className="max-w-[26ch] truncate text-xxs text-dim" data-testid="last-edit">{last ?? ''}</span>
    <span className="flex-1" />
    <button className="btn-claude" data-testid="open-command" onClick={openCommand}>✳ Direct with Claude <kbd className="ml-1 rounded bg-black/30 px-1 text-xxs">⌘K</kbd>{pending > 0 && <span className="ml-1 rounded-full bg-claude px-1.5 text-xxs text-white">{pending}</span>}</button>
    <span className="text-xxs text-dim" title="Autosaved to this browser (IndexedDB)">{savedAt ? `saved ${new Date(savedAt).toLocaleTimeString()}` : 'not saved yet'}</span>
    <button className="btn" data-testid="export-shot" title="Export the active shot as a control-pass package (zip)" onClick={async () => { const s = S(), shot = s.project.shots.find((x) => x.id === s.activeShotId); if (!shot) return s.notify('Select a shot first.', 'error'); s.notify(`Rendering ${shot.name}…`); try { const r = await exportShotPackage(shot, { height: s.exportHeight, onProgress: (d, t, l) => { if (d % 24 === 0) S().notify(`Rendering ${l} ${Math.round((d / t) * 100)}%`); } }); download(`${shot.id}-package.zip`, r.zip, 'application/zip'); S().set({ lastExport: { shotId: shot.id, hash: r.hash, files: Object.keys(r.files).length, seconds: r.seconds } } as never); S().notify(`Exported ${Object.keys(r.files).length} files in ${r.seconds.toFixed(1)}s (hash ${r.hash})`); } catch (e) { S().notify(String((e as Error).message), 'error'); } }}>Export shot</button>
    <select aria-label="Export resolution" data-testid="export-height" className="inp !w-16" value={exportHeight} onChange={(e) => S().set({ exportHeight: +e.target.value })}>{[180, 360, 540, 720, 1080, 2160].map((v) => <option key={v} value={v}>{v}p</option>)}</select>
    <button className="btn" onClick={async () => download(`${name.replace(/\W+/g, '-').toLowerCase()}.blockout`, await exportBlockout())} title="Save a portable .blockout file">Save</button>
    <button className="btn" onClick={() => file.current?.click()}>Open</button>
    <input ref={file} type="file" accept=".blockout,.zip" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) try { await importBlockout(new Uint8Array(await f.arrayBuffer())); S().notify(`Opened ${f.name}`); } catch (err) { S().notify(String((err as Error).message), 'error'); } e.target.value = ''; }} />
    <button className="btn" onClick={() => { if (confirm('Start a new empty project? (Current one stays in autosave until overwritten.)')) S().load(emptyProject('p' + Date.now().toString(36), 'Untitled')); }}>New</button>
    <button className="btn" onClick={() => S().load(demoProject())} title="Reload the Field Duel demo">Demo</button>
    <button className="btn" onClick={() => download('changelog.md', changeLogMarkdown(name, S().changeLog), 'text/markdown')} title="Download the human-readable change log">Log</button>
    <LayoutMenu />
    <button className="btn" aria-label="Toggle theme" onClick={() => S().set({ theme: theme === 'dark' ? 'light' : 'dark' })}>{theme === 'dark' ? '☾' : '☀'}</button>
  </header>;
}

export interface Layout { sceneRight: boolean; sidebarLeft: boolean; resultTop: boolean }
const LAYOUT_KEY = 'blockout:layout';
const readLayout = (): Layout => { try { return { sceneRight: false, sidebarLeft: false, resultTop: false, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') }; } catch { return { sceneRight: false, sidebarLeft: false, resultTop: false }; } };
let layoutState = readLayout(); const layoutSubs = new Set<() => void>();
export function setLayout(l: Partial<Layout>) { layoutState = { ...layoutState, ...l }; try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutState)); } catch { /* private mode */ } layoutSubs.forEach((f) => f()); }
const useLayout = () => React.useSyncExternalStore((f) => { layoutSubs.add(f); return () => layoutSubs.delete(f); }, () => layoutState);
function Sidebar() {
  const tab = useStudio((s) => s.rightTab);
  return <Tabs.Root value={tab} onValueChange={(v) => S().set({ rightTab: v })} className="flex h-full flex-col bg-panel">
    <Tabs.List className="flex h-7 shrink-0 border-b border-line" aria-label="Sidebar">{TABS.map(([v, l]) => <Tabs.Trigger key={v} value={v} data-testid={`tab-${v}`} className="flex-1 border-b-2 border-transparent px-1 text-xxs uppercase tracking-wide text-dim data-[state=active]:border-accent data-[state=active]:text-fg">{l}</Tabs.Trigger>)}</Tabs.List>
    {TABS.map(([v, , C]) => <Tabs.Content key={v} value={v} className="min-h-0 flex-1 overflow-hidden"><C /></Tabs.Content>)}
  </Tabs.Root>;
}
/** Dockable main area: the scene view, the viewer stack and the sidebar can trade places; sizes persist per arrangement. */
function MainArea() {
  const L = useLayout(), id = `${+L.sceneRight}${+L.sidebarLeft}${+L.resultTop}`;
  const scene = <Panel key="scene" id="scene" defaultSize={46} minSize={20} order={L.sidebarLeft ? (L.sceneRight ? 3 : 2) : L.sceneRight ? 2 : 1}><SceneView /></Panel>;
  const stack = <Panel key="stack" id="stack" defaultSize={30} minSize={14} order={L.sidebarLeft ? (L.sceneRight ? 2 : 3) : L.sceneRight ? 1 : 2}>
    <PanelGroup direction="vertical" autoSaveId={`blockout:mid:${+L.resultTop}`}>{L.resultTop ? <><Panel id="result" order={1} defaultSize={50} minSize={15}><ResultView /></Panel><PanelResizeHandle className="handle-v" /><Panel id="blockout" order={2} defaultSize={50} minSize={15}><BlockoutView /></Panel></> : <><Panel id="blockout" order={1} defaultSize={50} minSize={15}><BlockoutView /></Panel><PanelResizeHandle className="handle-v" /><Panel id="result" order={2} defaultSize={50} minSize={15}><ResultView /></Panel></>}</PanelGroup></Panel>;
  const side = <Panel key="side" id="side" defaultSize={24} minSize={16} order={L.sidebarLeft ? 1 : 3}><Sidebar /></Panel>;
  const main = L.sceneRight ? [stack, scene] : [scene, stack], all = L.sidebarLeft ? [side, ...main] : [...main, side];
  return <PanelGroup key={id} direction="horizontal" autoSaveId={`blockout:h:${id}`} data-testid="main-area" data-layout={id}>{all.flatMap((p, i) => (i ? [<PanelResizeHandle key={'h' + i} className="handle-h" />, p] : [p]))}</PanelGroup>;
}
function LayoutMenu() {
  const L = useLayout();
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="btn" data-testid="layout-menu" aria-label="Layout">▦ Layout</button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 rounded border border-line bg-panel p-1 shadow-xl">
      {([['sceneRight', 'Scene view on the right'], ['sidebarLeft', 'Sidebar on the left'], ['resultTop', 'Result above Blockout']] as const).map(([k, label]) => <DropdownMenu.CheckboxItem key={k} checked={L[k]} onCheckedChange={(v) => setLayout({ [k]: !!v })} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-fg outline-none data-[highlighted]:bg-accent/30"><span className="w-3">{L[k] ? '✓' : ''}</span>{label}</DropdownMenu.CheckboxItem>)}
      <DropdownMenu.Separator className="my-1 h-px bg-line" />
      <DropdownMenu.Item onSelect={() => { setLayout({ sceneRight: false, sidebarLeft: false, resultTop: false }); try { Object.keys(localStorage).filter((k) => k.startsWith('react-resizable-panels:blockout')).forEach((k) => localStorage.removeItem(k)); } catch { /* */ } location.reload(); }} className="cursor-pointer rounded px-2 py-1 text-xs text-fg outline-none data-[highlighted]:bg-accent/30">Reset layout</DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}

export function App() {
  const [cmd, setCmd] = useState(false), theme = useStudio((s) => s.theme), toast = useStudio((s) => s.toast);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    let stop = () => {}, stopModels = () => {}; const off = installHotkeys(() => setCmd(true));
    const noRecover = new URLSearchParams(location.search).has('fresh');
    (noRecover ? Promise.resolve(false) : recover()).then((ok) => { if (ok) S().notify('Recovered your last session from autosave.'); stop = startAutosave(); initBaselines(S().project); connectBridge(); stopModels = startModelSync(); });
    const offSync = startProjectSync(), offPop = startPopoutHost();
    return () => { off(); stop(); offSync(); stopModels(); offPop(); };
  }, []);
  return <div className="flex h-full flex-col">
    <TopBar openCommand={() => setCmd(true)} />
    <PanelGroup direction="vertical" autoSaveId="blockout:v" className="min-h-0 flex-1">
      <Panel defaultSize={70} minSize={30}>
        <MainArea />
      </Panel>
      <PanelResizeHandle className="handle-v" />
      <Panel defaultSize={30} minSize={12}><Timeline /></Panel>
    </PanelGroup>
    <CommandBar open={cmd} onOpenChange={setCmd} />
    {toast && <div role="status" data-testid="toast" className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded border px-3 py-1.5 text-xs shadow-xl ${toast.kind === 'error' ? 'border-bad bg-bad/20' : 'border-line bg-raised'}`}>{toast.text}</div>}
  </div>;
}
