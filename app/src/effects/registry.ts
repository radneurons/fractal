import type { EffectFactory } from './types';
import { ElementsFactory } from './elements';
import { BroadsideFactory } from './broadside';
import { MissionFactory } from './mission';

export const EFFECTS: EffectFactory[] = [BroadsideFactory, ElementsFactory, MissionFactory];
export const effectById = (id: string) => EFFECTS.find(e => e.id === id);
