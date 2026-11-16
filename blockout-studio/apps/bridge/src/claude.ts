/** Claude backends that live in the bridge: Claude Code CLI (default), Anthropic API (optional), and MCP hand-off. */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { Project } from '@blockout/core';
import { buildRequest, costOf, runValidated, type BackendEvent, type ClaudeBackend, type RawEvent, type TaskImage, type TaskInputs, type TaskName, type TaskOutput, type TaskRequest } from '@blockout/prompting';

// ---------- 1. Claude Code CLI (uses the user's own, already-logged-in installation) ----------
/** We only ever spawn the CLI. We never read, copy or proxy its credentials or config directory. */
export class ClaudeCodeBackend implements ClaudeBackend {
  readonly id = 'claude-code'; readonly label = 'Claude Code (your subscription)';
  constructor(private bin = process.env.BLOCKOUT_CLAUDE_BIN ?? 'claude', private model = process.env.BLOCKOUT_CLAUDE_CODE_MODEL) {}
  status(): { available: boolean; version?: string; error?: string } { try { const r = spawnSync(this.bin, ['--version'], { encoding: 'utf8', timeout: 8000 }); return r.status === 0 ? { available: true, version: r.stdout.trim() } : { available: false, error: (r.stderr || r.error?.message || 'not found').trim() }; } catch (e) { return { available: false, error: (e as Error).message }; } }
  private async *call(req: TaskRequest, signal?: AbortSignal): AsyncGenerator<RawEvent> {
    const dir = mkdtempSync(join(tmpdir(), 'blockout-claude-')); // empty cwd: no project CLAUDE.md, nothing to edit
    try {
      const imgs = (req.images ?? []).map((im, i) => { const f = join(dir, `frame_${String(i).padStart(2, '0')}.${im.mediaType === 'image/png' ? 'png' : 'jpg'}`); writeFileSync(f, Buffer.from(im.base64, 'base64')); return `- ${f} — ${im.label}`; });
      const prompt = `${req.stable}\n\n---\n\n${req.user}${imgs.length ? `\n\nRead each of these image files with the Read tool before answering:\n${imgs.join('\n')}` : ''}\n\nJSON schema for your reply:\n${JSON.stringify(req.jsonSchema)}\n\nReply with the JSON object only.`;
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', imgs.length ? '12' : '3', '--append-system-prompt', req.system, ...(imgs.length ? ['--allowedTools', 'Read'] : []), ...(this.model ? ['--model', this.model] : [])];
      const child = spawn(this.bin, args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      signal?.addEventListener('abort', () => child.kill('SIGTERM')); child.stdin.end(prompt);
      let buf = '', err = '', final: string | null = null, usage: RawEvent['usage']; const queue: RawEvent[] = []; let wake: (() => void) | null = null, done = false;
      const push = (e: RawEvent) => { queue.push(e); wake?.(); };
      child.stderr.on('data', (d) => (err += d));
      child.stdout.on('data', (d: Buffer) => { buf += d.toString('utf8'); let nl: number; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue; try { const ev = JSON.parse(line);
        if (ev.type === 'assistant') for (const b of ev.message?.content ?? []) { if (b.type === 'text' && b.text) push({ type: 'progress', text: b.text.slice(0, 240) }); else if (b.type === 'tool_use') push({ type: 'progress', text: `Claude Code: ${b.name} ${String(b.input?.file_path ?? '').split('/').pop() ?? ''}` }); }
        else if (ev.type === 'result') { final = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.structured_output ?? ev.result ?? ''); const u = ev.usage ?? {}; usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0, costUsd: 0, model: 'claude-code (subscription)' }; if (ev.is_error) err += `\n${final}`; }
      } catch { /* non-JSON line */ } } });
      const exit = new Promise<number>((res) => { child.on('error', (e) => { err += e.message; res(127); }); child.on('close', (c) => res(c ?? 1)); }).then((c) => { done = true; wake?.(); return c; });
      yield { type: 'progress', text: 'Asking Claude Code…' };
      while (!done || queue.length) { if (queue.length) yield queue.shift()!; else await new Promise<void>((r) => (wake = r)); }
      const code = await exit; if (code !== 0 || final === null) throw new Error(`Claude Code exited with ${code}: ${(err || 'no result').trim().slice(0, 400)}${code === 127 ? ' — is the `claude` CLI installed and on PATH?' : ''}`);
      yield { type: 'text', text: final, usage };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  run<T extends TaskName>(task: T, input: TaskInputs[T], project: Project, opts?: { images?: TaskImage[]; signal?: AbortSignal }): AsyncIterable<BackendEvent<TaskOutput<T>>> { return runValidated<T>(this.id, project, buildRequest(project, task, input, opts?.images), (r) => this.call(r, opts?.signal)); }
}

// ---------- 2. Anthropic API (optional fallback; key from the keychain) ----------
export const DEFAULT_API_MODEL = 'claude-opus-5-5';
export class AnthropicBackend implements ClaudeBackend {
  readonly id = 'anthropic-api'; readonly label = 'Anthropic API key';
  constructor(private getKey: () => Promise<string | undefined>, public model = process.env.BLOCKOUT_ANTHROPIC_MODEL ?? DEFAULT_API_MODEL) {}
  private async *call(req: TaskRequest, signal?: AbortSignal): AsyncGenerator<RawEvent> {
    const apiKey = await this.getKey(); if (!apiKey) throw new Error('No Anthropic API key in the bridge keychain. Add one in the Claude tab, or use the Claude Code backend.');
    const client = new Anthropic({ apiKey });
    const content: Anthropic.Beta.BetaContentBlockParam[] = [...(req.images ?? []).flatMap((im): Anthropic.Beta.BetaContentBlockParam[] => [{ type: 'text', text: im.label }, { type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.base64 } }]), { type: 'text', text: `${req.user}\n\nJSON schema for your reply:\n${JSON.stringify(req.jsonSchema)}` }];
    yield { type: 'progress', text: `Calling ${this.model}…` };
    // Prompt caching: task instructions + the stable project context (bibles, op reference, memory) form the cached prefix; volatile facts go in the user turn.
    const stream = client.beta.messages.stream({ model: this.model, max_tokens: 64000, thinking: { type: 'adaptive' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      system: [{ type: 'text', text: req.stable }, { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content }] } as unknown as Parameters<typeof client.beta.messages.stream>[0], { signal });
    let chars = 0; stream.on('text', (t) => { chars += t.length; });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request.'); if (msg.stop_reason === 'max_tokens') throw new Error('Response was cut off (max_tokens).');
    const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(''), u = msg.usage;
    const tok = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 };
    yield { type: 'progress', text: `${msg.model}: ${tok.outputTokens} output tokens${tok.cacheReadTokens ? `, ${tok.cacheReadTokens} read from cache` : ''} (${chars} chars)` };
    yield { type: 'text', text, usage: { ...tok, costUsd: costOf(msg.model, tok), model: msg.model } };
  }
  run<T extends TaskName>(task: T, input: TaskInputs[T], project: Project, opts?: { images?: TaskImage[]; signal?: AbortSignal }): AsyncIterable<BackendEvent<TaskOutput<T>>> { return runValidated<T>(this.id, project, buildRequest(project, task, input, opts?.images), (r) => this.call(r, opts?.signal)); }
}

// ---------- 3. MCP hand-off: a Claude session connected over MCP picks tasks up and submits results ----------
export interface PendingTask { id: string; request: TaskRequest; createdAt: number; resolve(text: string): void; reject(e: Error): void; claimed: boolean }
export class McpBackend implements ClaudeBackend {
  readonly id = 'mcp'; readonly label = 'Claude over MCP'; readonly pending = new Map<string, PendingTask>(); lastSeen = 0; private seq = 0;
  constructor(private timeoutMs = 300000) {}
  connected() { return Date.now() - this.lastSeen < 120000; }
  next(): { id: string; task: string; system: string; context: string; user: string; jsonSchema: unknown; images: number } | null { this.lastSeen = Date.now(); for (const t of this.pending.values()) if (!t.claimed) { t.claimed = true; return { id: t.id, task: t.request.task, system: t.request.system, context: t.request.stable, user: t.request.user, jsonSchema: t.request.jsonSchema, images: t.request.images?.length ?? 0 }; } return null; }
  images(id: string) { return this.pending.get(id)?.request.images ?? []; }
  submit(id: string, text: string): boolean { const t = this.pending.get(id); if (!t) return false; t.resolve(text); return true; }
  private async *call(req: TaskRequest): AsyncGenerator<RawEvent> {
    const id = `task_${Date.now().toString(36)}_${this.seq++}`; let resolve!: (t: string) => void, reject!: (e: Error) => void; const p = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
    this.pending.set(id, { id, request: req, createdAt: Date.now(), resolve, reject, claimed: false });
    const timer = setTimeout(() => reject(new Error('No MCP-connected Claude picked up the task in time. In Claude Code, say: "work the Blockout task queue" (it will call next_claude_task).')), this.timeoutMs);
    yield { type: 'progress', text: this.connected() ? 'Queued for the connected Claude session…' : 'Queued. Waiting for a Claude session connected over MCP (ask it to "work the Blockout task queue")…' };
    try { yield { type: 'text', text: await p }; } finally { clearTimeout(timer); this.pending.delete(id); }
  }
  run<T extends TaskName>(task: T, input: TaskInputs[T], project: Project, opts?: { images?: TaskImage[] }): AsyncIterable<BackendEvent<TaskOutput<T>>> { return runValidated<T>(this.id, project, buildRequest(project, task, input, opts?.images), (r) => this.call(r)); }
}
