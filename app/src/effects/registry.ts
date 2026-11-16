// Effect registry. SDK effects in effects/user/*.ts are discovered with import.meta.glob (SPEC §15).
import type { EffectClass, EffectMeta } from './types.ts';

const list: EffectClass[] = [];
const byId = new Map<string, EffectClass>();

export function registerEffect(cls: EffectClass): void {
  if (byId.has(cls.meta.id)) { const i = list.findIndex((c) => c.meta.id === cls.meta.id); list[i] = cls; }
  else list.push(cls);
  byId.set(cls.meta.id, cls);
}
export function effectClass(id: string): EffectClass | undefined { return byId.get(id); }
export function effectMeta(id: string): EffectMeta | undefined { return byId.get(id)?.meta; }
export function allEffects(): EffectClass[] { return list.slice(); }
export function effectIds(): string[] { return list.map((c) => c.meta.id); }
