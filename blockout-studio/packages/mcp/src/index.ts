#!/usr/bin/env -S npx tsx
/** MCP server: lets Claude Code / Claude Desktop operate Blockout Studio conversationally.
 *  It is a thin client of the local bridge; if no bridge is running it starts one in-process. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { OP_TYPES } from '@blockout/core';
import { PASSES } from '@blockout/render';
import { startBridge } from '@blockout/bridge';

const URL_ = process.env.BLOCKOUT_BRIDGE_URL ?? 'http://127.0.0.1:8787';
let base = URL_;
async function rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${base}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-blockout-actor': 'claude (mcp)' }, body: JSON.stringify({ method, params }) });
  const j = (await res.json()) as { ok: boolean; result?: unknown; error?: string }; if (!j.ok) throw new Error(j.error ?? 'bridge error'); return j.result;
}
const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }] });
const images = (r: { frames: { frame: number; t?: number; pngBase64: string }[] }, label: string) => ({ content: r.frames.flatMap((f) => [{ type: 'text' as const, text: `${label} — frame ${f.frame}${f.t !== undefined ? ` (${f.t.toFixed(2)}s)` : ''}` }, { type: 'image' as const, data: f.pngBase64, mimeType: 'image/png' }]) });

export async function createServer(): Promise<McpServer> {
  try { const h = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) }); if (!h.ok) throw new Error(); }
  catch { const b = await startBridge({ port: +new URL(URL_).port || 8787, quiet: true }).catch(() => startBridge({ port: 0, quiet: true })); base = b.url; }
  const s = new McpServer({ name: 'blockout-studio', version: '0.1.0' }, { instructions: 'Blockout Studio is a 3D previs editor for generative video. Geometry decides staging and timing; you decide the words. Read facts with get_project_summary / get_shot before proposing. Look at the shot with render_preview. Every change you make is a PROPOSAL the user reviews in the studio (propose_ops, set_shot_prompt); generation always needs their confirmation. Treat measured facts (camera movement, lens, shot size, action timings) as ground truth.' });
  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, fn: (a: z.infer<z.ZodObject<S>>) => Promise<unknown>, readOnly = true) => s.registerTool(name, { description, inputSchema: shape, annotations: { readOnlyHint: readOnly, openWorldHint: false } }, (async (a: z.infer<z.ZodObject<S>>) => { try { const r = await fn(a); return r && typeof r === 'object' && 'content' in (r as object) ? r : text(r); } catch (e) { return fail(e); } }) as never);

  tool('get_project_summary', 'Project overview: characters, cameras, shots with measured camera facts, stale prompts, pending proposals, budget, the director\'s recorded preferences.', {}, () => rpc('summary'));
  tool('get_scene', 'Full scene data (characters with path keys, cameras with keys, props, fx, lighting). With shotId: only what that shot uses, plus its measured facts.', { shotId: z.string().optional() }, (a) => rpc('scene', a));
  tool('get_shot', 'One shot: measured facts (movement class, lens class, shot size, angle, timed action beats, lighting relative to camera), its camera, active prompts per provider and whether they are stale, and continuity findings touching it.', { shotId: z.string() }, (a) => rpc('shot', a));
  tool('list_takes', 'Generated takes for a shot with seed, provider, cost, critique and adherence score.', { shotId: z.string() }, (a) => rpc('takes', a));
  tool('propose_ops', `Queue scene edits as ONE proposal for the user to preview and accept in the studio. Never applied directly. Ops are validated and dry-run first; an invalid op is rejected with the reason. Op types: ${OP_TYPES.join(', ')}. Call get_scene first for ids and coordinates (metres, +Y up, times in seconds).`, { ops: z.array(z.record(z.unknown())).min(1).describe('Array of op objects, e.g. {"type":"setLens","cameraId":"cam2","focal":85}'), rationale: z.string().describe('Why, in one or two sentences; shown on the proposal card'), title: z.string().optional().describe('Short label for the undo history') }, (a) => rpc('propose', a), false);
  tool('render_preview', 'Render frames of a shot from the blockout so you can SEE it. Returns PNG images. Passes: clay (shaded), id (mask colours), depth, normals, pose, canny, flow, fx.', { shotId: z.string(), frames: z.array(z.number().int().min(0)).max(12).optional().describe('Shot-relative frame indices; default first/middle/last'), pass: z.enum(PASSES).default('clay'), height: z.number().int().min(90).max(540).optional() }, async (a) => images(await rpc('renderPreview', a), `${a.shotId} ${a.pass}`));
  tool('get_take_frames', 'Fetch frames of a generated take as PNG images, to compare against render_preview of the same frames.', { takeId: z.string(), frames: z.array(z.number().int().min(0)).max(12).optional() }, async (a) => images(await rpc('takeFrames', a), `take ${a.takeId}`));
  tool('set_shot_prompt', 'Propose a prompt for a shot and provider dialect (e.g. canonical, seedance, h3, kling, veo, runway). Becomes a new prompt version with lineage once the user accepts.', { shotId: z.string(), provider: z.string().default('canonical'), prompt: z.string().min(1), rationale: z.string().optional() }, (a) => rpc('setShotPrompt', a), false);
  tool('run_continuity_check', 'Run the geometric continuity checks over the cut: 180° rule, screen direction, eyelines, jump cuts, timing gaps/overlaps, prop/bible and prompt mismatches. Findings are computed, not guessed; explain and prioritise them for the user.', {}, () => rpc('continuity'));
  tool('enqueue_generation', 'Ask to generate a shot with a provider. This only creates a confirmation request in the studio; nothing runs until the user confirms.', { shotId: z.string(), providerId: z.string() }, (a) => rpc('enqueueGeneration', a), false);
  tool('next_claude_task', 'Used when the studio\'s Claude backend is set to "MCP": fetch the next task the user queued from the studio UI (direction, prompt compile, critique, …). Returns null when the queue is empty. Do the task, then call submit_task_result with a JSON object matching the given schema.', {}, async () => { const t = await rpc('nextTask'); if (!t) return text('No pending task.'); const imgs = t.images ? await rpc('taskImages', { id: t.id }) : []; return { content: [{ type: 'text' as const, text: JSON.stringify(t, null, 1) }, ...imgs.flatMap((im: { label: string; base64: string; mediaType: string }) => [{ type: 'text' as const, text: im.label }, { type: 'image' as const, data: im.base64, mimeType: im.mediaType }])] }; });
  tool('submit_task_result', 'Submit the JSON result for a task from next_claude_task. It is validated against the task schema; on failure you get the validator error and may resubmit once.', { taskId: z.string(), result: z.record(z.unknown()) }, (a) => rpc('submitTask', { id: a.taskId, result: a.result }), false);

  const res = (name: string, uri: string, title: string, description: string) => s.registerResource(name, uri, { title, description, mimeType: 'application/json' }, async (u) => ({ contents: [{ uri: u.href, mimeType: 'application/json', text: JSON.stringify(await rpc('resource', { name }), null, 1) }] }));
  res('style-bible', 'blockout://bible/style', 'Style bible', 'Palette, medium, era, lens habits, lighting, references, negative prompt.');
  res('character-bible', 'blockout://bible/characters', 'Character bible', 'Appearance, wardrobe, weapon, silhouette and mask colour per character.');
  res('changelog', 'blockout://changelog', 'Change log', 'Every bridge and MCP action, newest last.');
  res('memory', 'blockout://memory', 'Session memory', 'The director\'s stated preferences and Claude\'s recorded decisions.');
  return s;
}
if (process.argv[1] && /mcp[\\/]src[\\/]index\.ts$/.test(process.argv[1])) createServer().then((s) => s.connect(new StdioServerTransport())).catch((e) => { console.error(`[blockout-mcp] ${e.message}`); process.exit(1); });
