import type { EffectFactory } from './types';
import { ElementsFactory } from './elements';

export const EFFECTS: EffectFactory[] = [ElementsFactory];
export const effectById = (id: string) => EFFECTS.find(e => e.id === id);
