/** Local companion: Claude + generation gateway, MCP back end, collaboration relay. Binds to 127.0.0.1 only. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import { OpS, ProjectS, applyOp, batch, demoProject, runContinuity, shotFacts, shotFrames, describeOp, type Op, type Project } from '@blockout/core';
import { encodePNG, passSize, softRenderer, PASSES, type PassName } from '@blockout/render';
import { LocalBackend, TASK_NAMES, continuityLocal, listDialects, registerDialect, stalePrompts, type ClaudeBackend, type TaskName } from '@blockout/prompting';
import { HttpProviderConfigS, httpProvider, type GenRequest } from '@blockout/pipeline';
import { AnthropicBackend, ClaudeCodeBackend, McpBackend } from './claude';
import { SecretStore } from './secrets';

export interface BridgeProposal { id: string; title: string; rationale: string; ops: Op[]; source: 'mcp' | 'claude'; kind: string; status: 'pending' | 'applied' | 'rejected'; meta?: Record<string, unknown>; at: number }
export interface BridgeOptions { port?: number; dataDir?: string; project?: Project; fileSecrets?: boolean; quiet?: boolean; backends?: Partial<Record<string, ClaudeBackend>> }
export interface Bridge { port: number; url: string; close(): Promise<void>; rpc(method: string, params?: Record<string, unknown>): Promise<unknown>; state: { project: Project; proposals: BridgeProposal[]; log: { at: number; actor: string; action: string }[] } }

const OK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

export async function startBridge(o: BridgeOptions = {}): Promise<Bridge> {
  const dataDir = o.dataDir ?? process.env.BLOCKOUT_DATA_DIR ?? join(homedir(), '.blockout-studio'); mkdirSync(join(dataDir, 'dialects'), { recursive: true });
  const secrets = new SecretStore(dataDir, o.fileSecrets), mcp = new McpBackend(), cc = new ClaudeCodeBackend(), api = new AnthropicBackend(() => secrets.get('ANTHROPIC_API_KEY'));
  const backends: Record<string, ClaudeBackend> = { 'claude-code': cc, mcp, 'anthropic-api': api, local: new LocalBackend(), ...(o.backends as Record<string, ClaudeBackend>) };
  const state: Bridge['state'] = { project: o.project ?? demoProject(), proposals: [], log: [] };
  const studios = new Set<WebSocket>(), pendingRpc = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>(), aborts = new Map<string, AbortController>(); let seq = 0, apiSpend = 0;
  for (const f of readdirSync(join(dataDir, 'dialects')).filter((x) => x.endsWith('.json'))) { try { registerDialect(JSON.parse(readFileSync(join(dataDir, 'dialects', f), 'utf8'))); } catch (e) { if (!o.quiet) console.error(`[bridge] bad dialect ${f}: ${(e as Error).message}`); } }
  const provFile = join(dataDir, 'providers.json'), providers = (): unknown[] => { try { return JSON.parse(readFileSync(provFile, 'utf8')); } catch { return []; } };
  const send = (ws: WebSocket, m: unknown) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }, broadcast = (m: unknown) => studios.forEach((ws) => send(ws, m));
  const log = (actor: string, action: string) => { const e = { at: Date.now(), actor, action }; state.log.push(e); if (state.log.length > 500) state.log.shift(); broadcast({ type: 'log', entry: e }); };
  const shotOf = (id: unknown) => { const s = state.project.shots.find((x) => x.id === id); if (!s) throw new Error(`shot "${id}" not found. Shots: ${state.project.shots.map((x) => x.id).join(', ')}`); return s; };
  const askStudio = (method: string, params: unknown, timeout = 20000) => new Promise<unknown>((resolve, reject) => { const ws = [...studios][0]; if (!ws) return reject(new Error('the studio is not open; open it in a browser for this action')); const id = `r${seq++}`; pendingRpc.set(id, { resolve, reject }); send(ws, { type: 'rpc', id, method, params }); setTimeout(() => { if (pendingRpc.delete(id)) reject(new Error('studio did not answer in time')); }, timeout); });
  const propose = (p: Omit<BridgeProposal, 'id' | 'status' | 'at'>): BridgeProposal => {
    const ops = p.ops.map((x) => OpS.parse(x)); if (ops.length) applyOp(state.project, batch('dry-run', ops)); // throws with a precise reason if they would not apply
    const pr: BridgeProposal = { ...p, ops, id: `mcp_${Date.now().toString(36)}_${seq++}`, status: 'pending', at: Date.now() }; state.proposals.push(pr); broadcast({ type: 'proposal', proposal: pr }); return pr;
  };
  const status = () => ({ ok: true, studioConnected: studios.size > 0, project: { id: state.project.id, name: state.project.name }, secrets: secrets.backend, apiSpendUsd: Math.round(apiSpend * 1e4) / 1e4, apiModel: api.model,
    backends: { 'claude-code': cc.status(), mcp: { available: mcp.connected(), pending: mcp.pending.size }, 'anthropic-api': { available: false as boolean }, local: { available: true } } });

  const RPC: Record<string, (p: Record<string, any>, actor: string) => unknown | Promise<unknown>> = {
    async status() { const s = status(); s.backends['anthropic-api'].available = !!(await secrets.get('ANTHROPIC_API_KEY')); return s; },
    summary() { const p = state.project; return { id: p.id, name: p.name, fps: p.fps, duration: p.duration, aspect: p.aspect, seed: p.seed, studioConnected: studios.size > 0,
      characters: Object.values(p.characters).map((c) => ({ id: c.id, name: c.name, maskColor: c.idColor, holds: c.held.kind, pathKeys: c.keys.length })), cameras: Object.values(p.cameras).map((c) => ({ id: c.id, name: c.name, keys: c.keys.length })),
      shots: p.shots.map((s) => { const f = shotFacts(p, s); return { id: s.id, name: s.name, camera: s.cameraId, start: s.start, end: s.end, frames: shotFrames(p, s), movement: f.camera.motion.type, lens: `${f.camera.focal}mm`, primarySubject: f.subjects[0]?.name, size: f.subjects[0]?.sizeStart, takes: Object.values(p.takes).filter((t) => t.shotId === s.id).length, prompts: Object.keys(p.prompts.active[s.id] ?? {}) }; }),
      stalePrompts: stalePrompts(p), pendingProposals: state.proposals.filter((x) => x.status === 'pending').map((x) => ({ id: x.id, title: x.title, kind: x.kind })), budget: { cap: p.budgetCap, spent: Object.values(p.takes).reduce((a, t) => a + t.cost, 0) }, memory: Object.values(p.memory).map((m) => m.text), dialects: listDialects().map((d) => d.id) }; },
    scene(p) { const pr = state.project; if (!p.shotId) return { characters: pr.characters, cameras: pr.cameras, props: pr.props, fx: pr.fx, scatter: pr.scatter, lighting: pr.lighting, shots: pr.shots, markers: pr.markers }; const s = shotOf(p.shotId), f = shotFacts(pr, s); return { shot: s, camera: pr.cameras[s.cameraId], characters: Object.fromEntries(f.subjects.map((x) => [x.id, pr.characters[x.id]])), facts: f, lighting: pr.lighting }; },
    shot(p) { const pr = state.project, s = shotOf(p.shotId); return { shot: s, facts: shotFacts(pr, s), camera: pr.cameras[s.cameraId], prompts: Object.fromEntries(Object.entries(pr.prompts.active[s.id] ?? {}).map(([k, v]) => [k, { versionId: v, text: pr.prompts.versions[v]?.text, author: pr.prompts.versions[v]?.author, stale: pr.prompts.versions[v]?.factsHash !== shotFacts(pr, s).hash }])), continuity: runContinuity(pr).filter((i) => i.shots.includes(s.id)) }; },
    takes(p) { shotOf(p.shotId); return Object.values(state.project.takes).filter((t) => t.shotId === p.shotId).map((t) => ({ id: t.id, provider: t.providerId, status: t.status, seed: t.seed, frames: t.frames.length || undefined, video: t.videoUrl, cost: t.cost, circled: t.circled, notes: t.notes, iou: t.iou, critique: t.critique, promptVersionId: t.promptVersionId })); },
    propose(p, actor) { const pr = propose({ title: String(p.title ?? p.rationale ?? 'Proposed edit').slice(0, 80), rationale: String(p.rationale ?? ''), ops: p.ops ?? [], source: 'mcp', kind: 'ops' }); log(actor, `proposed "${pr.title}" (${pr.ops.length} ops)`); return { proposalId: pr.id, status: 'pending', note: studios.size ? 'Queued in the studio for the user to preview and accept.' : 'Queued. The studio is not open, so nobody can review it yet.', summary: pr.ops.map((x) => describeOp(x, state.project)) }; },
    proposals() { return state.proposals.slice(-50); },
    resolveProposal(p, actor) { const pr = state.proposals.find((x) => x.id === p.id); if (!pr) throw new Error('proposal not found'); if (pr.status !== 'pending') return pr; if (p.accept) { if (!studios.size || p.applyHere) state.project = applyOp(state.project, batch(`Claude: ${pr.title}`, pr.ops)).project; pr.status = 'applied'; } else pr.status = 'rejected'; log(actor, `${pr.status} proposal "${pr.title}"`); return pr; },
    renderPreview(p, actor) { const s = shotOf(p.shotId), pass = (PASSES as readonly string[]).includes(p.pass) ? (p.pass as PassName) : 'clay', n = shotFrames(state.project, s), [w, h] = passSize(state.project, Math.min(540, Math.max(90, p.height ?? 216))); const frames = ((p.frames as number[] | undefined)?.length ? (p.frames as number[]) : [0, Math.floor(n / 2), n - 1]).slice(0, 12).map((f) => Math.max(0, Math.min(n - 1, Math.round(f)))); log(actor, `rendered ${frames.length} ${pass} frame(s) of ${s.name}`); return { shotId: s.id, pass, width: w, height: h, totalFrames: n, frames: frames.map((f) => ({ frame: f, t: f / state.project.fps, pngBase64: b64(encodePNG(softRenderer.render(state.project, s, f, pass, w, h), w, h)) })) }; },
    async takeFrames(p, actor) { const t = state.project.takes[p.takeId]; if (!t) throw new Error(`take "${p.takeId}" not found`); if (!t.frames.length) throw new Error(t.videoUrl ? `this take is a remote video (${t.videoUrl}); frames are not stored locally` : 'take has no frames'); const idx = ((p.frames as number[] | undefined)?.length ? (p.frames as number[]) : [0, Math.floor(t.frames.length / 2), t.frames.length - 1]).slice(0, 12).map((f) => Math.max(0, Math.min(t.frames.length - 1, Math.round(f)))); log(actor, `read ${idx.length} frame(s) of take ${t.id}`); return { takeId: t.id, shotId: t.shotId, frames: await Promise.all(idx.map(async (f) => { const ref = t.frames[f]; const file = ref.startsWith('bridge:') ? join(dataDir, 'takes', ref.slice(7)) : null; return { frame: f, pngBase64: file && existsSync(file) ? b64(readFileSync(file)) : String(await askStudio('takeFrame', { takeId: t.id, frame: f })) }; })) }; },
    setShotPrompt(p, actor) { const s = shotOf(p.shotId), provider = String(p.provider ?? 'canonical'), cur = state.project.prompts.active[s.id]?.[provider], at = Date.now(); const pr = propose({ title: `Prompt for ${s.name} (${provider})`, rationale: String(p.rationale ?? 'Prompt written over MCP.'), source: 'mcp', kind: 'prompt', ops: [{ type: 'addPromptVersion', activate: true, version: { id: `pv_${s.id}_${provider}_${at.toString(36)}`, shotId: s.id, provider, text: String(p.prompt), parent: cur, factsHash: shotFacts(state.project, s).hash, author: 'claude', note: 'via MCP', at } }] }); log(actor, `proposed a ${provider} prompt for ${s.name}`); return { proposalId: pr.id, status: 'pending' }; },
    continuity(_p, actor) { const issues = runContinuity(state.project); log(actor, `ran the continuity check (${issues.length} findings)`); return { issues, review: continuityLocal(state.project, issues) }; },
    enqueueGeneration(p, actor) { const s = shotOf(p.shotId); const pr = propose({ title: `Generate ${s.name} with ${p.providerId}`, rationale: 'Generation always needs your confirmation in the studio (it can cost money).', source: 'mcp', kind: 'generation', ops: [], meta: { shotId: s.id, providerId: String(p.providerId) } }); log(actor, `asked to generate ${s.name} with ${p.providerId}`); return { proposalId: pr.id, status: 'awaiting confirmation in the studio UI' }; },
    resource(p) { const pr = state.project; if (p.name === 'style-bible') return pr.bibles.style; if (p.name === 'character-bible') return Object.fromEntries(Object.values(pr.characters).map((c) => [c.name, { id: c.id, maskColor: c.idColor, ...pr.bibles.characters[c.id] }])); if (p.name === 'changelog') return state.log; if (p.name === 'memory') return Object.values(pr.memory); throw new Error('unknown resource'); },
    nextTask() { return mcp.next(); }, taskImages(p) { return mcp.images(p.id); }, submitTask(p, actor) { const ok = mcp.submit(p.id, typeof p.result === 'string' ? p.result : JSON.stringify(p.result)); log(actor, `submitted a result for ${p.id}`); return { accepted: ok }; },
    'secrets.list': () => secrets.names(), 'secrets.set': async (p) => { await secrets.set(p.name, p.value); log('user', `stored secret ${p.name}`); return { ok: true }; }, 'secrets.delete': async (p) => { await secrets.delete(p.name); return { ok: true }; },
    'providers.list': () => providers(), 'providers.save': (p) => { const c = HttpProviderConfigS.parse(p.config), all = providers().filter((x) => (x as { id: string }).id !== c.id); writeFileSync(provFile, JSON.stringify([...all, p.config], null, 1)); return { ok: true }; }, 'providers.delete': (p) => { writeFileSync(provFile, JSON.stringify(providers().filter((x) => (x as { id: string }).id !== p.id), null, 1)); return { ok: true }; },
    dialects: () => listDialects(),
    /** Run a user-configured HTTP provider here so the key never leaves the bridge and CORS is not an issue. */
    async httpGenerate(p, actor) { const plugin = httpProvider(p.config), r = p.request as Record<string, any>; const req: GenRequest = { ...r, passes: Object.fromEntries(Object.entries(r.passes ?? {}).map(([k, v]) => [k, (v as string[]).map(unb64)])), firstFrame: r.firstFrame ? unb64(r.firstFrame) : undefined, lastFrame: r.lastFrame ? unb64(r.lastFrame) : undefined, keyframe: r.keyframe ? unb64(r.keyframe) : undefined, mask: r.mask ? unb64(r.mask) : undefined, source: r.source ? (r.source as string[]).map(unb64) : undefined, references: r.references ?? [] } as GenRequest; log(actor, `sent ${r.shotId} to ${plugin.name}`); return plugin.generate(req, { onProgress: (f, note) => broadcast({ type: 'gen:progress', jobId: p.jobId, fraction: f, note }), signal: { aborted: false }, secret: (n) => secrets.get(n) }); },
    log: () => state.log.slice(-200),
  };
  const rpc = async (method: string, params: Record<string, unknown> = {}, actor = 'mcp') => { const f = RPC[method]; if (!f) throw new Error(`unknown method ${method}`); return f(params as Record<string, any>, actor); };

  const json = (res: ServerResponse, code: number, body: unknown, origin?: string) => { res.writeHead(code, { 'content-type': 'application/json', ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) }); res.end(JSON.stringify(body)); };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin; if (origin && !OK_ORIGIN.test(origin)) return json(res, 403, { ok: false, error: 'origin not allowed' });
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': origin ?? '*', 'access-control-allow-headers': 'content-type,x-blockout-actor', 'access-control-allow-methods': 'GET,POST' }); return res.end(); }
    try {
      if (req.url === '/health') return json(res, 200, await RPC.status({}, 'http'), origin);
      if (req.url === '/rpc' && req.method === 'POST') { const chunks: Buffer[] = []; let size = 0; for await (const c of req) { size += (c as Buffer).length; if (size > 400e6) throw new Error('request too large'); chunks.push(c as Buffer); } const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); return json(res, 200, { ok: true, result: await rpc(body.method, body.params, String(req.headers['x-blockout-actor'] ?? (origin ? 'studio' : 'mcp'))) }, origin); }
      json(res, 404, { ok: false, error: 'not found' }, origin);
    } catch (e) { json(res, 200, { ok: false, error: (e as Error).message }, origin); }
  });
  const wss = new WebSocketServer({ noServer: true }), rooms = new Map<string, { doc: Y.Doc; peers: Set<WebSocket> }>(), phones = new Map<string, Set<WebSocket>>();
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin; if (origin && !OK_ORIGIN.test(origin) && !/^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin)) return socket.destroy();
    const url = new URL(req.url ?? '/', 'http://x');
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (url.pathname === '/collab') { // Yjs relay: binary = doc update (persisted in a server doc for late joiners), text = awareness JSON
        const name = url.searchParams.get('room') ?? 'default'; let room = rooms.get(name); if (!room) rooms.set(name, (room = { doc: new Y.Doc(), peers: new Set() }));
        const r = room; r.peers.add(ws); ws.send(Y.encodeStateAsUpdate(r.doc));
        ws.on('message', (data, isBinary) => { if (isBinary) { try { Y.applyUpdate(r.doc, new Uint8Array(data as Buffer)); } catch { return; } } r.peers.forEach((p) => { if (p !== ws && p.readyState === 1) p.send(data, { binary: isBinary }); }); });
        ws.on('close', () => { r.peers.delete(ws); r.peers.forEach((p) => p.readyState === 1 && p.send(JSON.stringify({ type: 'leave' }))); if (!r.peers.size) setTimeout(() => !r.peers.size && rooms.delete(name), 600000); }); return;
      }
      if (url.pathname === '/phone') { const name = url.searchParams.get('room') ?? 'default'; let set = phones.get(name); if (!set) phones.set(name, (set = new Set())); const s = set; s.add(ws); ws.on('message', (d) => s.forEach((p) => p !== ws && p.readyState === 1 && p.send(d.toString()))); ws.on('close', () => s.delete(ws)); return; }
      studios.add(ws); send(ws, { type: 'status', status: status() }); for (const pr of state.proposals) if (pr.status === 'pending') send(ws, { type: 'proposal', proposal: pr });
      ws.on('close', () => studios.delete(ws));
      ws.on('message', async (raw) => {
        let m: Record<string, any>; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.type === 'project') { const p = ProjectS.safeParse(m.project); if (p.success) state.project = p.data; }
        else if (m.type === 'rpc:result') { const w = pendingRpc.get(m.id); if (w) { pendingRpc.delete(m.id); m.error ? w.reject(new Error(m.error)) : w.resolve(m.result); } }
        else if (m.type === 'proposal:resolved') { const pr = state.proposals.find((x) => x.id === m.id); if (pr) { pr.status = m.status; log('user', `${m.status} proposal "${pr.title}"`); } }
        else if (m.type === 'task:cancel') aborts.get(m.id)?.abort();
        else if (m.type === 'task') {
          const be = backends[m.backend]; if (!be || !TASK_NAMES.includes(m.task)) return send(ws, { type: 'task:error', id: m.id, error: `unknown backend or task (${m.backend}/${m.task})` });
          const project = m.project ? ProjectS.parse(m.project) : state.project, ac = new AbortController(); aborts.set(m.id, ac); log('studio', `${m.task} via ${be.label}`);
          try { for await (const ev of be.run(m.task as TaskName, m.input, project, { images: m.images, signal: ac.signal })) { if (ev.type === 'progress') send(ws, { type: 'task:progress', id: m.id, text: ev.text }); else { apiSpend += ev.usage?.costUsd ?? 0; send(ws, { type: 'task:result', id: m.id, value: ev.value, usage: ev.usage, attempts: ev.attempts, backend: ev.backend, apiSpendUsd: apiSpend }); } } }
          catch (e) { send(ws, { type: 'task:error', id: m.id, error: (e as Error).message }); log('bridge', `${m.task} failed: ${(e as Error).message.slice(0, 120)}`); } finally { aborts.delete(m.id); }
        }
      });
    });
  });
  const port = await new Promise<number>((resolve, reject) => { server.once('error', reject); server.listen(o.port ?? 8787, '127.0.0.1', () => resolve((server.address() as { port: number }).port)); });
  if (!o.quiet) console.error(`[bridge] http://127.0.0.1:${port}  ·  secrets: ${secrets.backend}  ·  data: ${dataDir}`);
  return { port, url: `http://127.0.0.1:${port}`, state, rpc: (m, p) => rpc(m, p, 'local'), close: () => new Promise<void>((r) => { wss.clients.forEach((c) => c.terminate()); wss.close(); server.close(() => r()); server.closeAllConnections?.(); }) };
}
