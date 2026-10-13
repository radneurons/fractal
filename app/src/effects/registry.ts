import type { EffectFactory } from './types';
import { ElementsFactory } from './elements';
import { BroadsideFactory } from './broadside';
import { MissionFactory } from './mission';
import { SwarmFactory } from './swarm';
import { ChromeFactory } from './chrome';
import { DrosteFactory } from './droste';
import { PressFactory } from './press';

export const EFFECTS: EffectFactory[] = [BroadsideFactory, ElementsFactory, MissionFactory, SwarmFactory, ChromeFactory, DrosteFactory, PressFactory];
export const effectById = (id: string) => EFFECTS.find(e => e.id === id);
