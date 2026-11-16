/** One interface for every way of reaching Claude: Claude Code CLI, MCP, Anthropic API, recorded fixtures, or the offline director. */
import type { Project } from '@blockout/core';
import { TASKS, TaskValidationError, buildRequest, validateTask, type TaskImage, type TaskInputs, type TaskName, type TaskOutput, type TaskRequest } from './tasks';

export interface Usage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; model: string }
export type BackendEvent<T> = { type: 'progress'; text: string } | { type: 'result'; value: T; usage?: Usage; attempts: number; backend: string };
export interface RawEvent { type: 'progress' | 'text'; text: string; usage?: Usage }
export interface ClaudeBackend {
  readonly id: string; readonly label: string;
  run<T extends TaskName>(task: T, input: TaskInputs[T], project: Project, opts?: { images?: TaskImage[]; signal?: AbortSignal }): AsyncIterable<BackendEvent<TaskOutput<T>>>;
}
/** Shared contract: validate with zod; on failure retry ONCE with the validation error attached; then surface the failure. */
export async function* runValidated<T extends TaskName>(backend: string, project: Project, req: TaskRequest, call: (req: TaskRequest) => AsyncIterable<RawEvent>): AsyncGenerator<BackendEvent<TaskOutput<T>>> {
  let attempt = 0, request = req, lastErr = '', usage: Usage | undefined;
  while (attempt < 2) {
    attempt++; let text = '';
    for await (const ev of call(request)) { if (ev.type === 'progress') yield { type: 'progress', text: ev.text }; else text += ev.text; if (ev.usage) usage = usage ? { ...ev.usage, inputTokens: usage.inputTokens + ev.usage.inputTokens, outputTokens: usage.outputTokens + ev.usage.outputTokens, cacheReadTokens: usage.cacheReadTokens + ev.usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens + ev.usage.cacheWriteTokens, costUsd: usage.costUsd + ev.usage.costUsd } : ev.usage; }
    try { const value = validateTask(project, req.task as T, text); yield { type: 'result', value, usage, attempts: attempt, backend }; return; }
    catch (e) {
      if (!(e instanceof TaskValidationError)) throw e; lastErr = e.message;
      if (attempt < 2) { yield { type: 'progress', text: `Response failed validation (${lastErr.slice(0, 200)}); retrying once…` }; request = { ...req, user: `${req.user}\n\nYour previous reply was rejected by the validator:\n${lastErr}\nPrevious reply:\n${text.slice(0, 6000)}\nReturn a corrected JSON object only.` }; }
    }
  }
  throw new TaskValidationError(`${backend}: response failed schema validation twice — ${lastErr}`);
}
/** Offline director. Deterministic; no network. */
export class LocalBackend implements ClaudeBackend {
  readonly id = 'local'; readonly label = 'Offline director (rule-based)';
  async *run<T extends TaskName>(task: T, input: TaskInputs[T], project: Project): AsyncGenerator<BackendEvent<TaskOutput<T>>> {
    yield { type: 'progress', text: `${TASKS[task].title}: working from measured facts…` };
    yield { type: 'result', value: validateTask(project, task, TASKS[task].local(project, input)), attempts: 1, backend: this.id };
  }
}
/** Replays recorded responses so CI never calls Claude. `responses[task]` is a queue of raw model texts. */
export class FixtureBackend implements ClaudeBackend {
  readonly id = 'fixture'; readonly label = 'Recorded fixtures'; readonly requests: TaskRequest[] = [];
  constructor(private responses: Partial<Record<TaskName, string[]>>) {}
  async *run<T extends TaskName>(task: T, input: TaskInputs[T], project: Project, opts?: { images?: TaskImage[] }): AsyncGenerator<BackendEvent<TaskOutput<T>>> {
    const q = this.responses[task] ?? [], self = this;
    yield* runValidated<T>(this.id, project, buildRequest(project, task, input, opts?.images), async function* (req) { self.requests.push(req); const next = q.shift(); if (next === undefined) throw new Error(`no fixture left for task ${task}`); yield { type: 'progress', text: 'replaying fixture' }; yield { type: 'text', text: next }; });
  }
}
export async function runTask<T extends TaskName>(backend: ClaudeBackend, task: T, input: TaskInputs[T], project: Project, onProgress?: (t: string) => void, opts?: { images?: TaskImage[]; signal?: AbortSignal }): Promise<{ value: TaskOutput<T>; usage?: Usage; attempts: number; backend: string }> {
  for await (const ev of backend.run(task, input, project, opts)) { if (ev.type === 'progress') onProgress?.(ev.text); else return ev; }
  throw new Error('backend finished without a result');
}
/** Per-million-token prices (USD) for cost display in API mode. Source: Anthropic price list at time of writing; edit as needed. */
export const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 }, 'claude-fable-5-2': { in: 8, out: 40, cacheRead: 0.2, cacheWrite: 10 }, 'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 }, 'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
export function costOf(model: string, u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number { const p = PRICES[model] ?? PRICES['claude-opus-5-5']; return (u.inputTokens * p.in + u.outputTokens * p.out + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1e6; }
