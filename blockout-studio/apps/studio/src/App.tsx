import React, { useEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
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
import { CommandBar } from './panels/CommandBar';
import { installHotkeys } from './hotkeys';
import { exportBlockout, importBlockout, recover, startAutosave, changeLogMarkdown } from './persist';
import { download } from './ui';

const TABS: [string, string, React.FC][] = [['inspector', 'Inspector', Inspector], ['prompt', 'Prompt', PromptPanel], ['bibles', 'Bibles', BiblesPanel], ['takes', 'Takes', TakesPanel], ['claude', 'Claude', ClaudePanel]];

function TopBar({ openCommand }: { openCommand: () => void }) {
  const name = useStudio((s) => s.project.name), canUndo = useStudio((s) => s.history.past.length > 0), canRedo = useStudio((s) => s.history.future.length > 0), last = useStudio((s) => s.history.past[s.history.past.length - 1]?.label), theme = useStudio((s) => s.theme), savedAt = useStudio((s) => s.savedAt), pending = useStudio((s) => s.proposals.filter((p) => p.status === 'pending').length);
  const file = useRef<HTMLInputElement>(null);
  return <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-2" role="banner">
    <span className="font-semibold tracking-tight text-fg">▚ Blockout Studio</span><span className="text-dim">/</span><span className="truncate text-fg" data-testid="project-name">{name}</span>
    <AddMenu />
    <button className="btn" data-testid="undo" disabled={!canUndo} onClick={() => S().undo()} title={last ? `Undo: ${last} (⌘Z)` : 'Nothing to undo'}>↶ Undo</button>
    <button className="btn" data-testid="redo" disabled={!canRedo} onClick={() => S().redo()} title="Redo (⇧⌘Z)">↷ Redo</button>
    <span className="max-w-[26ch] truncate text-xxs text-dim" data-testid="last-edit">{last ?? ''}</span>
    <span className="flex-1" />
    <button className="btn-claude" data-testid="open-command" onClick={openCommand}>✳ Direct with Claude <kbd className="ml-1 rounded bg-black/30 px-1 text-xxs">⌘K</kbd>{pending > 0 && <span className="ml-1 rounded-full bg-claude px-1.5 text-xxs text-white">{pending}</span>}</button>
    <span className="text-xxs text-dim" title="Autosaved to this browser (IndexedDB)">{savedAt ? `saved ${new Date(savedAt).toLocaleTimeString()}` : 'not saved yet'}</span>
    <button className="btn" onClick={async () => download(`${name.replace(/\W+/g, '-').toLowerCase()}.blockout`, await exportBlockout())} title="Save a portable .blockout file">Save</button>
    <button className="btn" onClick={() => file.current?.click()}>Open</button>
    <input ref={file} type="file" accept=".blockout,.zip" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) try { await importBlockout(new Uint8Array(await f.arrayBuffer())); S().notify(`Opened ${f.name}`); } catch (err) { S().notify(String((err as Error).message), 'error'); } e.target.value = ''; }} />
    <button className="btn" onClick={() => { if (confirm('Start a new empty project? (Current one stays in autosave until overwritten.)')) S().load(emptyProject('p' + Date.now().toString(36), 'Untitled')); }}>New</button>
    <button className="btn" onClick={() => S().load(demoProject())} title="Reload the Field Duel demo">Demo</button>
    <button className="btn" onClick={() => download('changelog.md', changeLogMarkdown(name, S().changeLog), 'text/markdown')} title="Download the human-readable change log">Log</button>
    <button className="btn" aria-label="Toggle theme" onClick={() => S().set({ theme: theme === 'dark' ? 'light' : 'dark' })}>{theme === 'dark' ? '☾' : '☀'}</button>
  </header>;
}

export function App() {
  const [cmd, setCmd] = useState(false), theme = useStudio((s) => s.theme), tab = useStudio((s) => s.rightTab), toast = useStudio((s) => s.toast);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    let stop = () => {}; const off = installHotkeys(() => setCmd(true));
    const noRecover = new URLSearchParams(location.search).has('fresh');
    (noRecover ? Promise.resolve(false) : recover()).then((ok) => { if (ok) S().notify('Recovered your last session from autosave.'); stop = startAutosave(); });
    return () => { off(); stop(); };
  }, []);
  return <div className="flex h-full flex-col">
    <TopBar openCommand={() => setCmd(true)} />
    <PanelGroup direction="vertical" autoSaveId="blockout:v" className="min-h-0 flex-1">
      <Panel defaultSize={70} minSize={30}>
        <PanelGroup direction="horizontal" autoSaveId="blockout:h">
          <Panel defaultSize={46} minSize={20} order={1}><SceneView /></Panel>
          <PanelResizeHandle className="handle-h" />
          <Panel defaultSize={30} minSize={14} order={2}>
            <PanelGroup direction="vertical" autoSaveId="blockout:mid">
              <Panel defaultSize={50} minSize={15}><BlockoutView /></Panel><PanelResizeHandle className="handle-v" /><Panel defaultSize={50} minSize={15}><ResultView /></Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="handle-h" />
          <Panel defaultSize={24} minSize={16} order={3}>
            <Tabs.Root value={tab} onValueChange={(v) => S().set({ rightTab: v })} className="flex h-full flex-col bg-panel">
              <Tabs.List className="flex h-7 shrink-0 border-b border-line" aria-label="Sidebar">{TABS.map(([v, l]) => <Tabs.Trigger key={v} value={v} data-testid={`tab-${v}`} className="flex-1 border-b-2 border-transparent px-1 text-xxs uppercase tracking-wide text-dim data-[state=active]:border-accent data-[state=active]:text-fg">{l}</Tabs.Trigger>)}</Tabs.List>
              {TABS.map(([v, , C]) => <Tabs.Content key={v} value={v} className="min-h-0 flex-1 overflow-hidden"><C /></Tabs.Content>)}
            </Tabs.Root>
          </Panel>
        </PanelGroup>
      </Panel>
      <PanelResizeHandle className="handle-v" />
      <Panel defaultSize={30} minSize={12}><Timeline /></Panel>
    </PanelGroup>
    <CommandBar open={cmd} onOpenChange={setCmd} />
    {toast && <div role="status" data-testid="toast" className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded border px-3 py-1.5 text-xs shadow-xl ${toast.kind === 'error' ? 'border-bad bg-bad/20' : 'border-line bg-raised'}`}>{toast.text}</div>}
  </div>;
}
