import type { EffectFactory } from './types';
import { ElementsFactory } from './elements';
import { BroadsideFactory } from './broadside';
import { MissionFactory } from './mission';
import { SwarmFactory } from './swarm';
import { ChromeFactory } from './chrome';

export const EFFECTS: EffectFactory[] = [BroadsideFactory, ElementsFactory, MissionFactory, SwarmFactory, ChromeFactory];
export const effectById = (id: string) => EFFECTS.find(e => e.id === id);
