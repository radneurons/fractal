/** Gateway to Claude and generation. Two transports behind one API:
 *  - embedded: offline director + mock provider, entirely in the browser (zero setup);
 *  - bridge: local companion over WebSocket (Claude Code CLI, MCP, Anthropic API, HTTP providers, keychain). */
import { create } from 'zustand';
import { LocalBackend, registerDialect, runTask, type TaskImage, type TaskInputs, type TaskName, type TaskOutput, type Usage } from '@blockout/prompting';
import { S, useStudio } from './store';

export type BackendId = 'claude-code' | 'mcp' | 'anthropic-api' | 'local';
export const BACKENDS: { id: BackendId; label: string; hint: string }[] = [
  { id: 'claude-code', label: 'Claude Code (your subscription)', hint: 'The bridge runs your installed, logged-in `claude` CLI in headless mode. Default.' },
  { id: 'mcp', label: 'Claude over MCP', hint: 'A Claude Code / Desktop session connected to the Blockout MCP server works the task queue.' },
  { id: 'anthropic-api', label: 'Anthropic API key', hint: 'Optional fallback. The key is stored in the bridge keychain; cost is shown here.' },
  { id: 'local', label: 'Offline director (no model)', hint: 'Rule-based. Works with no bridge and no network.' },
];
interface BridgeStatus { studioConnected: boolean; secrets: string; apiSpendUsd: number; apiModel: string; backends: Record<string, { available: boolean; version?: string; error?: string; pending?: number }> }
interface GW { connected: boolean; status: BridgeStatus | null; backend: BackendId; busy: string | null; progress: string; lastUsage: Usage | null; apiSpend: number; setBackend(b: BackendId): void }
const saved = (typeof localStorage !== 'undefined' && (localStorage.getItem('blockout:backend') as BackendId)) || 'claude-code';
export const useGateway = create<GW>((set) => ({ connected: false, status: null, backend: saved, busy: null, progress: '', lastUsage: null, apiSpend: 0, setBackend(b) { try { localStorage.setItem('blockout:backend', b); } catch { /* private mode */ } set({ backend: b }); } }));

const BRIDGE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BRIDGE_URL ?? 'http://127.0.0.1:8787';
let ws: WebSocket | null = null, seq = 0, timer: ReturnType<typeof setTimeout> | null = null;
const waiting = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; onProgress?(t: string): void }>(), genProgress = new Map<string, (f: number, n?: string) => void>();
export const onGenProgress = (jobId: string, f: ((f: number, n?: string) => void) | null) => { if (f) genProgress.set(jobId, f); else genProgress.delete(jobId); };
export let takeFrameResolver: (takeId: string, frame: number) => Promise<string> = async () => { throw new Error('no frames'); };
export const setTakeFrameResolver = (f: typeof takeFrameResolver) => { takeFrameResolver = f; };

export async function rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BRIDGE}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-blockout-actor': 'studio' }, body: JSON.stringify({ method, params }) });
  const j = (await res.json()) as { ok: boolean; result?: T; error?: string }; if (!j.ok) throw new Error(j.error ?? 'bridge error'); return j.result as T;
}
export function connectBridge() {
  if (ws && ws.readyState <= 1) return; if (new URLSearchParams(location.search).has('nobridge')) return;
  try { ws = new WebSocket(BRIDGE.replace(/^http/, 'ws') + '/ws'); } catch { return; }
  ws.onopen = () => { useGateway.setState({ connected: true }); ws!.send(JSON.stringify({ type: 'project', project: S().project })); rpc<unknown[]>('dialects').then((ds) => ds.forEach((d) => { try { registerDialect(d); } catch { /* ignore bad plugin */ } })).catch(() => {}); refreshStatus(); };
  ws.onclose = () => { useGateway.setState({ connected: false, status: null }); for (const w of waiting.values()) w.reject(new Error('bridge disconnected')); waiting.clear(); ws = null; setTimeout(connectBridge, 4000); };
  ws.onerror = () => {};
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data as string);
    if (m.type === 'status') useGateway.setState({ status: m.status });
    else if (m.type === 'task:progress') { waiting.get(m.id)?.onProgress?.(m.text); useGateway.setState({ progress: m.text }); }
    else if (m.type === 'task:result') { useGateway.setState({ lastUsage: m.usage ?? null, apiSpend: m.apiSpendUsd ?? useGateway.getState().apiSpend }); waiting.get(m.id)?.resolve(m); waiting.delete(m.id); }
    else if (m.type === 'task:error') { waiting.get(m.id)?.reject(new Error(m.error)); waiting.delete(m.id); }
    else if (m.type === 'gen:progress') genProgress.get(m.jobId)?.(m.fraction, m.note);
    else if (m.type === 'log') S().say('log', `${m.entry.actor}: ${m.entry.action}`);
    else if (m.type === 'proposal') { const p = m.proposal, st = S(); if (!st.proposals.some((x) => x.id === p.id)) { st.addProposal({ id: p.id, title: p.title, rationale: p.rationale, ops: p.ops, source: 'mcp', kind: p.kind, meta: p.meta }); st.say('claude', p.rationale || p.title, { proposalId: p.id }); st.set({ rightTab: 'claude' }); } }
    else if (m.type === 'rpc') { try { const result = m.method === 'takeFrame' ? await takeFrameResolver(m.params.takeId, m.params.frame) : null; ws?.send(JSON.stringify({ type: 'rpc:result', id: m.id, result })); } catch (err) { ws?.send(JSON.stringify({ type: 'rpc:result', id: m.id, error: (err as Error).message })); } }
  };
}
export const refreshStatus = () => rpc<BridgeStatus>('status').then((status) => useGateway.setState({ status })).catch(() => {});
export const notifyProposalResolved = (id: string, status: 'applied' | 'rejected') => { if (ws?.readyState === 1 && id.startsWith('mcp_')) ws.send(JSON.stringify({ type: 'proposal:resolved', id, status })); };
/** Mirror the project to the bridge so MCP reads and previews always reflect the editor. */
export function startProjectSync() { return useStudio.subscribe((s, prev) => { if (s.project === prev.project || ws?.readyState !== 1) return; if (timer) clearTimeout(timer); timer = setTimeout(() => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'project', project: S().project })), 350); }); }

const local = new LocalBackend();
/** Which backend will actually serve a request right now (falls back to the offline director, visibly). */
export function effectiveBackend(): { id: BackendId; fallback: boolean; reason?: string } {
  const g = useGateway.getState(); if (g.backend === 'local') return { id: 'local', fallback: false };
  if (!g.connected) return { id: 'local', fallback: true, reason: 'bridge not running (start it with `pnpm bridge`)' };
  const st = g.status?.backends[g.backend]; if (g.backend !== 'mcp' && st && !st.available) return { id: 'local', fallback: true, reason: g.backend === 'claude-code' ? `Claude Code CLI not found${st.error ? ` (${st.error.slice(0, 60)})` : ''}` : 'no API key stored' };
  return { id: g.backend, fallback: false };
}
export async function claude<T extends TaskName>(task: T, input: TaskInputs[T], opts: { images?: TaskImage[]; label?: string; forceLocal?: boolean } = {}): Promise<{ value: TaskOutput<T>; backend: string; attempts: number; usage?: Usage; fallbackReason?: string }> {
  const eff = opts.forceLocal ? { id: 'local' as BackendId, fallback: false, reason: undefined } : effectiveBackend(), project = S().project;
  useGateway.setState({ busy: opts.label ?? task, progress: '' });
  try {
    if (eff.id === 'local' || !ws) { const r = await runTask(local, task, input, project, (t) => useGateway.setState({ progress: t })); return { ...r, fallbackReason: eff.fallback ? eff.reason : undefined }; }
    const id = `t${Date.now().toString(36)}${seq++}`;
    const m = await new Promise<{ value: TaskOutput<T>; backend: string; attempts: number; usage?: Usage }>((resolve, reject) => { waiting.set(id, { resolve: resolve as (v: unknown) => void, reject }); ws!.send(JSON.stringify({ type: 'task', id, backend: eff.id, task, input, images: opts.images, project })); });
    return m;
  } finally { useGateway.setState({ busy: null }); }
}
