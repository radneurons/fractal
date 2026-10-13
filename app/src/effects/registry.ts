import type { EffectFactory } from './types';
import { ElementsFactory } from './elements';
import { BroadsideFactory } from './broadside';

export const EFFECTS: EffectFactory[] = [BroadsideFactory, ElementsFactory];
export const effectById = (id: string) => EFFECTS.find(e => e.id === id);
