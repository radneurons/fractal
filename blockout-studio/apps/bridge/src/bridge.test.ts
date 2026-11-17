import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import WebSocket from 'ws';
import { demoProject, runContinuity } from '@blockout/core';
import { decodePNG } from '@blockout/render';
import { FixtureBackend } from '@blockout/prompting';
import { SecretStore, startBridge, type Bridge } from './index';

const dir = mkdtempSync(join(tmpdir(), 'blockout-test-')); let bridge: Bridge, mcp: Client;
const fixture = (n: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../packages/prompting/fixtures/${n}.json`, import.meta.url)), 'utf8')).responses as string[];
beforeAll(async () => {
  bridge = await startBridge({ port: 0, dataDir: dir, fileSecrets: true, quiet: true, project: demoProject(), backends: { fixture: new FixtureBackend({ direct: fixture('direct-retry'), continuity: fixture('continuity') }) } });
  mcp = new Client({ name: 'test', version: '0' });
  await mcp.connect(new StdioClientTransport({ command: 'npx', args: ['tsx', fileURLToPath(new URL('../../../packages/mcp/src/index.ts', import.meta.url))], env: { ...process.env, BLOCKOUT_BRIDGE_URL: bridge.url } as Record<string, string>, stderr: 'ignore' }));
}, 60000);
afterAll(async () => { await mcp?.close(); await bridge?.close(); rmSync(dir, { recursive: true, force: true }); });
const call = async (name: string, args: Record<string, unknown> = {}) => { const r = (await mcp.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text?: string; data?: string }[] }; return r; };
const data = (r: { content: { text?: string }[] }) => JSON.parse(r.content[0].text!);

describe('MCP: Claude drives the demo', () => {
  it('exposes the required tools and resources', async () => {
    const tools = (await mcp.listTools()).tools.map((t) => t.name); for (const t of ['get_project_summary', 'get_scene', 'get_shot', 'list_takes', 'propose_ops', 'render_preview', 'get_take_frames', 'set_shot_prompt', 'run_continuity_check', 'enqueue_generation']) expect(tools).toContain(t);
    expect((await mcp.listResources()).resources.map((r) => r.uri).sort()).toEqual(['blockout://bible/characters', 'blockout://bible/style', 'blockout://changelog', 'blockout://memory']);
    const bible = await mcp.readResource({ uri: 'blockout://bible/style' }); expect(String((bible.contents[0] as { text: string }).text)).toMatch(/hand-painted anime/);
  });
  it('reads facts, sees the shot, finds the 180° break, proposes a fix; nothing changes until the user accepts', async () => {
    const sum = data(await call('get_project_summary')); expect(sum.name).toBe('Field Duel'); expect(sum.shots).toHaveLength(6); expect(sum.shots[3].movement).toBe('orbit');
    const shot = data(await call('get_shot', { shotId: 's5' })); expect(shot.facts.camera.motion.type).toBe('whip pan'); expect(shot.continuity.some((i: { kind: string }) => i.kind === 'axis-180')).toBe(true);
    const prev = await call('render_preview', { shotId: 's4', frames: [0, 30], pass: 'id', height: 108 }); const imgs = prev.content.filter((c) => c.type === 'image'); expect(imgs).toHaveLength(2); const png = decodePNG(new Uint8Array(Buffer.from(imgs[0].data!, 'base64'))); expect(png.height).toBe(108);
    const cont = data(await call('run_continuity_check')), fix = cont.review.items.find((i: { id: string }) => i.id.startsWith('axis-180:s4>s5')).fix; expect(fix.ops.length).toBeGreaterThan(0);
    const before = JSON.stringify(bridge.state.project.cameras.cam5);
    const prop = data(await call('propose_ops', { ops: fix.ops, rationale: 'Camera E crosses the line after the orbit; mirror it to the near side.', title: fix.title })); expect(prop.status).toBe('pending');
    expect(JSON.stringify(bridge.state.project.cameras.cam5)).toBe(before); // never applied directly
    expect(data(await call('get_project_summary')).pendingProposals).toHaveLength(1);
    await bridge.rpc('resolveProposal', { id: prop.proposalId, accept: true }); // what the studio does when the user clicks Apply
    expect(runContinuity(bridge.state.project).some((i) => i.id.startsWith('axis-180:s4>s5'))).toBe(false);
  });
  it('rejects invalid ops with a reason, and gates prompts and generation behind confirmation', async () => {
    const bad = await call('propose_ops', { ops: [{ type: 'setLens', cameraId: 'nope', focal: 50 }], rationale: 'x' }); expect(bad.isError).toBe(true); expect(bad.content[0].text).toMatch(/camera not found/);
    const pr = data(await call('set_shot_prompt', { shotId: 's1', provider: 'seedance', prompt: 'Top-down tracking shot…' })); expect(pr.status).toBe('pending'); expect(bridge.state.project.prompts.active.s1).toBeUndefined();
    const gen = data(await call('enqueue_generation', { shotId: 's1', providerId: 'mock' })); expect(gen.status).toMatch(/awaiting confirmation/); expect(Object.keys(bridge.state.project.takes)).toHaveLength(0);
    expect(bridge.state.log.some((l) => /claude \(mcp\)/.test(l.actor) && /proposed/.test(l.action))).toBe(true);
  });
});

describe('bridge WebSocket tasks', () => {
  const ws = () => new Promise<WebSocket>((res) => { const s = new WebSocket(bridge.url.replace('http', 'ws') + '/ws'); s.on('open', () => res(s)); });
  const run = (s: WebSocket, msg: Record<string, unknown>) => new Promise<{ result?: any; error?: string; progress: string[] }>((res) => { const progress: string[] = []; s.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id !== msg.id) return; if (m.type === 'task:progress') progress.push(m.text); if (m.type === 'task:result') res({ result: m, progress }); if (m.type === 'task:error') res({ error: m.error, progress }); }); s.send(JSON.stringify(msg)); });
  it('streams progress, validates with zod, retries once with the error attached', async () => { const s = await ws(), r = await run(s, { type: 'task', id: 't1', backend: 'fixture', task: 'direct', input: { instruction: 'Ren steps back', t: 5 } }); expect(r.result.attempts).toBe(2); expect(r.result.value.ops[0].type).toBe('addPathKey'); expect(r.progress.join(' ')).toMatch(/retrying once/); s.close(); });
  it('MCP hand-off backend: a studio task is picked up and answered by the MCP-connected Claude', async () => {
    const s = await ws(), pending = run(s, { type: 'task', id: 't2', backend: 'mcp', task: 'continuity', input: {} });
    let task: any = null; for (let i = 0; i < 40 && !task; i++) { await new Promise((r) => setTimeout(r, 50)); const t = await call('next_claude_task'); if (!/No pending/.test(t.content[0].text!)) task = data(t); }
    expect(task.task).toBe('continuity'); expect(task.context).toMatch(/Style bible/);
    await call('submit_task_result', { taskId: task.id, result: JSON.parse(fixture('continuity')[0]) }); const r = await pending; expect(r.result.backend).toBe('mcp'); expect(r.result.value.items[0].priority).toBe(1); s.close();
  });
  it('surfaces a clear error when the Claude Code CLI is missing', async () => { const { ClaudeCodeBackend } = await import('./claude'); const be = new ClaudeCodeBackend('definitely-not-a-binary'); expect(be.status().available).toBe(false); await expect((async () => { for await (const _ of be.run('continuity', {}, demoProject())) void _; })()).rejects.toThrow(/Claude Code exited|ENOENT|not installed/i); });
});

describe('secrets', () => {
  it('encrypted-file fallback round-trips, lists names only, and stores no plaintext', async () => {
    const st = new SecretStore(dir, true); await st.set('MY_VIDEO_KEY', 'sk-super-secret-123'); expect(await st.get('MY_VIDEO_KEY')).toBe('sk-super-secret-123'); expect(await st.names()).toEqual(['MY_VIDEO_KEY']);
    expect(readFileSync(st.file).includes('sk-super-secret-123')).toBe(false); expect(readFileSync(st.file).includes('MY_VIDEO_KEY')).toBe(false);
    expect(JSON.stringify(await bridge.rpc('status'))).not.toMatch(/sk-super/); await st.delete('MY_VIDEO_KEY'); expect(await st.get('MY_VIDEO_KEY')).toBeUndefined();
  });
});

describe('segmentation via the bridge', () => {
  it('runs the configured HTTP segmenter with keychain secrets and returns the mask', async () => {
    const { createServer } = await import('node:http'); let auth = '';
    const srv = createServer((req, res) => { let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => { auth = String(req.headers.authorization); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ mask: JSON.parse(body).hint })); }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r)); const port = (srv.address() as { port: number }).port;
    try {
      await bridge.rpc('secrets.set', { name: 'SEG_KEY', value: 'k-123' });
      await bridge.rpc('segmenter.save', { config: { name: 'stub', url: `http://127.0.0.1:${port}/seg`, headers: { authorization: 'Bearer {{secret:SEG_KEY}}' }, maskPath: 'mask' } });
      const { encodePNG } = await import('@blockout/render'), px = new Uint8ClampedArray(4 * 4 * 4).fill(255), b64 = Buffer.from(encodePNG(px, 4, 4)).toString('base64');
      const r = (await bridge.rpc('segment', { image: b64, hint: b64, palette: [{ color: '#56b4e9', entityId: 'kenji' }] })) as { mask: string };
      expect(auth).toBe('Bearer k-123'); expect(decodePNG(new Uint8Array(Buffer.from(r.mask, 'base64'))).width).toBe(4);
    } finally { srv.close(); await bridge.rpc('segmenter.save', { config: null }); }
  });
});
