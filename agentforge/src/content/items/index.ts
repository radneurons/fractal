import type { Item } from '@/core/types';
import { FOUNDATION_ITEMS } from './foundations';
import { CODING_ITEMS } from './coding';
import { AGENT_ITEMS } from './agents';
import { ADVANCED_ITEMS } from './advanced';

export const ITEMS: Item[] = [...FOUNDATION_ITEMS, ...CODING_ITEMS, ...AGENT_ITEMS, ...ADVANCED_ITEMS];
export const itemById = new Map(ITEMS.map((i) => [i.id, i]));
export const getItem = (id: string) => {
  const it = itemById.get(id);
  if (!it) throw new Error(`Unknown item: ${id}`);
  return it;
};
export const itemsForSkill = (skillId: string) => ITEMS.filter((i) => i.skillId === skillId);
