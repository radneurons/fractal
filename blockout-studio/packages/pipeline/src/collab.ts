/** Collaboration over the op stream: a Yjs document holds an append-only Y.Array of ops plus a base snapshot.
 *  Every peer's project = snapshot + ops in Y.Array order. Yjs orders concurrent appends identically for every peer,
 *  so all peers converge; an op that no longer applies after a concurrent edit is skipped identically everywhere. */
import * as Y from 'yjs';
import { applyUntrusted, ProjectS, type Op, type Project } from '@blockout/core';

export interface LoggedOp { id: string; actor: string; op: Op }
export class OpStream {
  readonly doc: Y.Doc; readonly log: Y.Array<LoggedOp>; readonly meta: Y.Map<unknown>;
  private applied: string[] = []; private state: Project | null = null; private seq = 0; skipped = 0;
  constructor(readonly actor: string, doc = new Y.Doc(), private onChange?: (p: Project, remote: boolean) => void) {
    this.doc = doc; this.log = doc.getArray<LoggedOp>('ops'); this.meta = doc.getMap('meta');
    this.log.observe((e) => { const remote = e.transaction.origin !== this; this.rebuild(); if (this.state) this.onChange?.(this.state, remote); });
    this.meta.observe(() => { if (!this.state && this.meta.get('snapshot')) { this.rebuild(); if (this.state) this.onChange?.(this.state, true); } });
  }
  /** First peer seeds the room with its project. Later peers adopt the room's state. */
  init(project: Project): Project { if (!this.meta.get('snapshot')) this.doc.transact(() => this.meta.set('snapshot', JSON.stringify(project)), this); this.rebuild(); return this.state!; }
  get project(): Project | null { return this.state; }
  push(op: Op): void { this.doc.transact(() => this.log.push([{ id: `${this.actor}:${this.seq++}:${Date.now().toString(36)}`, actor: this.actor, op: JSON.parse(JSON.stringify(op)) }]), this); }
  private rebuild() {
    const snap = this.meta.get('snapshot') as string | undefined; if (!snap) return; const items = this.log.toArray();
    let i = 0; if (this.state) while (i < this.applied.length && i < items.length && this.applied[i] === items[i].id) i++;
    let p: Project; if (!this.state || i < this.applied.length) { p = ProjectS.parse(JSON.parse(snap)); i = 0; this.applied = []; this.skipped = 0; } else p = this.state;
    for (; i < items.length; i++) { try { p = applyUntrusted(p, items[i].op).project; } catch { this.skipped++; } this.applied.push(items[i].id); }
    this.state = p;
  }
}
export { Y };
