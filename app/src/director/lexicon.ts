// Stopwords, concept lexicon and element mapping. Concepts drive pictograms and ELEMENTS treatments.
import type { ElementKind } from '../types';

export const STOPWORDS = new Set(`a an the and or but nor so yet for of to in on at by with from up down out over under into onto off about as than then
that this these those there here where when while if because though although whether
i me my mine myself you your yours yourself he him his she her hers it its itself we us our ours they them their theirs
is am are was were be been being do does did done have has had having will would shall should can could may might must
not no just very too also only even still all any some each every both either neither such what which who whom whose how why
oh ooh ah yeah la na hey uh mm whoa let lets let's i'm you're we're they're it's that's there's i'll you'll we'll i've you've we've don't can't won't ain't isn't
el la los las un una y o de del en con por para que se lo le les mi tu su al es son
le la les un une et ou de du des en au aux que qui ne pas je tu il elle nous vous ils
der die das ein eine und oder zu im am ist ich du er sie wir ihr`.split(/\s+/));

export interface Concept { id: string; words: string[]; element?: ElementKind; color?: string; icon?: string; shape?: 'ring' | 'stem' | 'tri' }

// Each concept lists stems; matching uses prefix-of-stem on normalised words.
export const CONCEPTS: Concept[] = [
  { id: 'fire', words: ['fire', 'flame', 'burn', 'blaze', 'ember', 'ash', 'spark', 'ignite', 'inferno', 'heat', 'hot'], element: 'fire', color: '#D9562A', icon: 'flame', shape: 'tri' },
  { id: 'light', words: ['light', 'shine', 'glow', 'bright', 'gleam', 'shimmer', 'sun', 'sunlight', 'dawn', 'morning', 'lamp', 'candle', 'star', 'glitter'], element: 'light', color: '#BFD7E6', icon: 'sun', shape: 'ring' },
  { id: 'water', words: ['rain', 'tear', 'cry', 'crying', 'ocean', 'sea', 'river', 'water', 'wave', 'drown', 'flood', 'drip', 'wet', 'shower', 'pour', 'storm'], element: 'water', color: '#5E8FB5', icon: 'drop', shape: 'ring' },
  { id: 'shock', words: ['thunder', 'boom', 'break', 'broke', 'broken', 'shout', 'scream', 'crash', 'bang', 'explode', 'shatter', 'strike', 'hit', 'loud'], element: 'shock', color: '#F1E9D6', icon: 'bolt', shape: 'stem' },
  { id: 'wind', words: ['wind', 'air', 'breath', 'breathe', 'blow', 'fly', 'flying', 'float', 'whisper', 'sigh', 'gust', 'breeze', 'sky'], element: 'wind', color: '#9DB0BE', icon: 'wing', shape: 'tri' },
  { id: 'vortex', words: ['spin', 'turn', 'round', 'around', 'circle', 'world', 'whirl', 'twist', 'dizzy', 'orbit', 'again', 'forever', 'cycle', 'dance'], element: 'vortex', color: '#C7B8E8', icon: 'spiral', shape: 'ring' },
  { id: 'quake', words: ['shake', 'earth', 'ground', 'fall', 'falling', 'fell', 'crumble', 'quake', 'tremble', 'rise', 'rising', 'mountain', 'stone', 'rock', 'wall', 'gate'], element: 'quake', color: '#C98A4B', icon: 'mountain', shape: 'tri' },
  { id: 'ice', words: ['cold', 'ice', 'freeze', 'frozen', 'winter', 'snow', 'frost', 'still', 'silence', 'silent', 'quiet', 'numb'], element: 'ice', color: '#CFE6F2', icon: 'flake', shape: 'stem' },
  { id: 'smoke', words: ['smoke', 'ghost', 'fade', 'faded', 'gone', 'memory', 'dream', 'dreams', 'haze', 'mist', 'fog', 'shadow', 'vanish', 'night'], element: 'smoke', color: '#8F8A86', icon: 'cloud', shape: 'ring' },
  { id: 'heart', words: ['heart', 'love', 'lover', 'loved', 'loving', 'kiss', 'darling', 'baby'], color: '#C2324A', icon: 'heart', shape: 'ring' },
  { id: 'home', words: ['home', 'house', 'door', 'window', 'room', 'roof', 'garden'], icon: 'house', shape: 'tri' },
  { id: 'moon', words: ['moon', 'lunar'], icon: 'moon', shape: 'ring' },
  { id: 'time', words: ['time', 'clock', 'hour', 'minute', 'forever', 'wait', 'waiting', 'counting'], icon: 'clock', shape: 'ring' },
  { id: 'road', words: ['road', 'street', 'highway', 'drive', 'run', 'running', 'journey', 'way', 'path', 'walk'], icon: 'road', shape: 'stem' },
  { id: 'crown', words: ['king', 'queen', 'crown', 'throne', 'gold', 'golden', 'rich'], color: '#C3A36A', icon: 'crown', shape: 'tri' },
  { id: 'bird', words: ['bird', 'wing', 'wings', 'feather', 'free', 'freedom'], icon: 'bird', shape: 'tri' },
  { id: 'eye', words: ['eye', 'eyes', 'see', 'look', 'watch', 'vision'], icon: 'eye', shape: 'ring' },
  { id: 'music', words: ['song', 'sing', 'music', 'melody', 'voice', 'sound'], icon: 'note', shape: 'stem' },
  { id: 'key', words: ['key', 'lock', 'open', 'chain', 'chains', 'cage'], icon: 'key', shape: 'stem' },
  { id: 'people', words: ['people', 'crowd', 'everybody', 'everyone', 'together', 'friends', 'family', 'nation', 'children', 'brother', 'brothers', 'sister', 'sisters', 'stranger', 'strangers'], icon: 'people', shape: 'stem' },
  { id: 'star', words: ['stars', 'starlight', 'galaxy', 'heaven', 'heavens', 'cosmos', 'universe'], element: 'light', icon: 'star', shape: 'ring' },
  { id: 'flower', words: ['flower', 'rose', 'bloom', 'grow', 'seed', 'tree', 'leaf', 'spring'], color: '#D7889B', icon: 'flower', shape: 'ring' }
];

const stemIndex: { stem: string; c: Concept }[] = [];
for (const c of CONCEPTS) for (const w of c.words) stemIndex.push({ stem: w, c });
stemIndex.sort((a, b) => b.stem.length - a.stem.length);

export function conceptOf(norm: string): Concept | undefined {
  if (norm.length < 3) return undefined;
  for (const { stem, c } of stemIndex) {
    if (norm === stem) return c;
    if (norm.startsWith(stem) && norm.length - stem.length <= 3 && stem.length >= 3) return c;   // burn → burning, rain → rains
  }
  return undefined;
}
