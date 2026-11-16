// Undo / redo (SPEC §12.2): every edit is a command; drags coalesce; 200 steps; per project, not persisted.
export interface Command { label: string; do(): void; undo(): void; coalesceKey?: string }

export class History {
  private stack: Command[] = [];
  private pos = 0;
  private lastTime = 0;
  onChange: (() => void) | null = null;
  constructor(readonly limit = 200) {}

  /** Record a command that has ALREADY been applied (or apply it with `run`). */
  push(cmd: Command, run = false): void {
    if (run) cmd.do();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const top = this.stack[this.pos - 1];
    if (top && cmd.coalesceKey && top.coalesceKey === cmd.coalesceKey && now - this.lastTime < 800) {
      // one step while the pointer is down: keep the first undo, take the latest do
      this.stack[this.pos - 1] = { ...cmd, undo: top.undo };
    } else {
      this.stack.length = this.pos;
      this.stack.push(cmd);
      if (this.stack.length > this.limit) this.stack.shift();
      this.pos = this.stack.length;
    }
    this.lastTime = now;
    this.onChange?.();
  }
  canUndo(): boolean { return this.pos > 0; }
  canRedo(): boolean { return this.pos < this.stack.length; }
  undo(): string | null { if (!this.canUndo()) return null; const c = this.stack[--this.pos]; c.undo(); this.onChange?.(); return c.label; }
  redo(): string | null { if (!this.canRedo()) return null; const c = this.stack[this.pos++]; c.do(); this.onChange?.(); return c.label; }
  list(): { label: string; done: boolean }[] { return this.stack.map((c, i) => ({ label: c.label, done: i < this.pos })); }
  clear(): void { this.stack = []; this.pos = 0; this.onChange?.(); }
  /** jump to a step in the history panel */
  goto(index: number): void { while (this.pos > index + 1) this.undo(); while (this.pos < index + 1) this.redo(); }
}

/**
 * Snapshot history: the editable state is plain JSON, so a command is "restore the snapshot before /
 * after". Coalescing merges a drag into one step.
 */
export class SnapshotHistory<T> {
  readonly history: History;
  private last: string;
  constructor(private get: () => T, private set: (s: T) => void, limit = 200) {
    this.history = new History(limit);
    this.last = JSON.stringify(get());
  }
  /** call after an edit */
  commit(label: string, coalesceKey?: string): void {
    const after = JSON.stringify(this.get());
    if (after === this.last) return;
    const before = this.last;
    this.last = after;
    this.history.push({ label, coalesceKey, do: () => { this.set(JSON.parse(after)); this.last = after; }, undo: () => { this.set(JSON.parse(before)); this.last = before; } });
  }
  reset(): void { this.last = JSON.stringify(this.get()); this.history.clear(); }
}
