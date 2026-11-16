/** Generation queue: concurrency limit, retries with exponential backoff, cancel, cost estimate, per-project budget cap. */
import type { GenContext, GenRequest, GenResult, ProviderPlugin } from './providers';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface Job { id: string; providerId: string; shotId: string; status: JobStatus; progress: number; note: string; attempts: number; estimate: number; cost: number; error?: string; result?: GenResult; request: GenRequest }
export interface BudgetState { cap: number; spent: number; committed: number }
export interface BudgetCheck { ok: boolean; warn: boolean; after: number; message: string }
/** Warn at 80% of the cap, refuse above 100%. A cap of 0 means "no cap". */
export function checkBudget(b: BudgetState, estimate: number): BudgetCheck {
  const after = b.spent + b.committed + estimate; if (b.cap <= 0) return { ok: true, warn: false, after, message: '' };
  if (after > b.cap + 1e-9) return { ok: false, warn: true, after, message: `This run ($${estimate.toFixed(2)}) would take the project to $${after.toFixed(2)}, over the $${b.cap.toFixed(2)} budget cap.` };
  const warn = after >= 0.8 * b.cap; return { ok: true, warn, after, message: warn ? `Budget warning: $${after.toFixed(2)} of $${b.cap.toFixed(2)} (${Math.round((after / b.cap) * 100)}%) after this run.` : '' };
}
export interface QueueOpts { concurrency?: number; retries?: number; backoffMs?: number; sleep?(ms: number): Promise<void>; secret?(name: string): Promise<string | undefined>; fetch?: typeof fetch; onChange?(job: Job): void; budget(): BudgetState }
export class GenerationQueue {
  readonly jobs = new Map<string, Job>(); private waiting: { job: Job; provider: ProviderPlugin; signal: { aborted: boolean }; resolve(j: Job): void }[] = []; private running = 0; private seq = 0;
  constructor(private o: QueueOpts) {}
  estimate(provider: ProviderPlugin, req: GenRequest) { const estimate = provider.estimate(req); return { estimate, budget: checkBudget(this.o.budget(), estimate) }; }
  /** Enqueue; throws when the run would exceed the budget cap. Resolves when the job settles (never rejects — inspect job.status). */
  enqueue(provider: ProviderPlugin, request: GenRequest, id = `job_${(this.seq++).toString(36)}_${request.seed}`): { job: Job; done: Promise<Job> } {
    const { estimate, budget } = this.estimate(provider, request); if (!budget.ok) throw new Error(budget.message);
    const job: Job = { id, providerId: provider.id, shotId: request.shotId, status: 'queued', progress: 0, note: '', attempts: 0, estimate, cost: 0, request };
    this.jobs.set(id, job); const signal = { aborted: false }; let resolve!: (j: Job) => void; const done = new Promise<Job>((r) => (resolve = r));
    this.waiting.push({ job, provider, signal, resolve }); this.signals.set(id, signal); this.o.onChange?.(job); queueMicrotask(() => this.pump()); return { job, done };
  }
  private signals = new Map<string, { aborted: boolean }>();
  cancel(id: string): boolean { const job = this.jobs.get(id), s = this.signals.get(id); if (!job || !s || ['done', 'failed', 'cancelled'].includes(job.status)) return false; s.aborted = true; if (job.status === 'queued') { const i = this.waiting.findIndex((w) => w.job.id === id); if (i >= 0) { const [w] = this.waiting.splice(i, 1); job.status = 'cancelled'; this.o.onChange?.(job); w.resolve(job); } } return true; }
  committed(): number { let c = 0; for (const j of this.jobs.values()) if (j.status === 'queued' || j.status === 'running') c += j.estimate; return c; }
  private pump() { while (this.running < (this.o.concurrency ?? 2) && this.waiting.length) { const w = this.waiting.shift()!; this.running++; void this.run(w).finally(() => { this.running--; this.pump(); }); } }
  private async run({ job, provider, signal, resolve }: { job: Job; provider: ProviderPlugin; signal: { aborted: boolean }; resolve(j: Job): void }) {
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))), max = (this.o.retries ?? 2) + 1;
    const ctx: GenContext = { signal, secret: this.o.secret ?? (async () => undefined), fetch: this.o.fetch, sleep: this.o.sleep, onProgress: (f, note) => { job.progress = f; if (note) job.note = note; this.o.onChange?.(job); } };
    job.status = 'running'; this.o.onChange?.(job);
    for (;;) {
      job.attempts++;
      try { if (signal.aborted) throw new Error('cancelled'); const result = await provider.generate(job.request, ctx); if (signal.aborted) throw new Error('cancelled'); job.result = result; job.cost = result.cost; job.status = 'done'; job.progress = 1; break; }
      catch (e) {
        const err = e as Error & { retryable?: boolean };
        if (signal.aborted || err.message === 'cancelled') { job.status = 'cancelled'; break; }
        if (job.attempts < max && err.retryable !== false && !/budget|secret .* is not set|needs /.test(err.message)) { job.note = `attempt ${job.attempts} failed (${err.message.slice(0, 80)}); retrying`; this.o.onChange?.(job); await sleep((this.o.backoffMs ?? 800) * 2 ** (job.attempts - 1)); continue; }
        job.status = 'failed'; job.error = err.message; break;
      }
    }
    this.o.onChange?.(job); resolve(job);
  }
}
