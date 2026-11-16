// Stopwords and the concept lexicon (SPEC §6).
import type { ElementKind } from '../types.ts';

const STOP_EN = `a an the and or but nor so yet for of to in on at by with from into onto upon as is am are was were be been being
do does did done have has had having will would shall should can could may might must i me my mine myself you your yours yourself
he him his she her hers it its we us our ours they them their theirs this that these those there here then than when where why how
what which who whom whose if because while though although until unless since about above below under over between through during
before after up down out off again not no nor too very just only own same such both each few more most other some any all
i'm i've i'll i'd you're you've you'll you'd he's she's it's we're we've we'll we'd they're they've they'll they'd that's there's
what's let's don't doesn't didn't can't couldn't won't wouldn't shouldn't isn't aren't wasn't weren't haven't hasn't hadn't ain't
gonna wanna gotta cause 'cause til till em ya got get gets let`;
const STOP_ES = `el la los las un una unos unas y o pero de del al a en con por para sin sobre entre que como cuando donde
me te se nos mi tu su mis tus sus yo tú él ella nosotros ellos es son era fue ser estar está están no sí ya muy más este esta eso`;
const STOP_FR = `le la les un une des et ou mais de du au aux à en dans avec pour par sans sur sous que qui quoi comme quand
je tu il elle nous vous ils elles me te se mon ton ma ta mes tes ses ce cet cette ces est sont était être ne non oui très plus`;
const STOP_DE = `der das den dem des ein eine einen einem einer und oder aber von zu zum zur im am an auf aus bei mit nach für ohne über unter
dass wie wenn wo ich du er sie es wir ihr mich dich sich mein dein sein ist sind war sein nicht ja nein sehr mehr`;
const FILLERS = `oh ooh oooh ah ahh aah yeah yea yeh la na da hey ho whoa woah uh huh mm mmm hmm ha doo dum sha ba ay eh oh-oh na-na la-la`;

export const STOPWORDS = new Set<string>(
  [STOP_EN, STOP_ES, STOP_FR, STOP_DE, FILLERS].join(' ').split(/\s+/).filter(Boolean)
    // foreign stopwords that are English words stay content words
    .filter((w) => !['die', 'son', 'con', 'lo', 'pas'].includes(w)),
);

export function isStopword(text: string): boolean {
  return STOPWORDS.has(text) || STOPWORDS.has(text.replace(/'/g, ''));
}
export function isFiller(text: string): boolean {
  return /^(o+h+|a+h+|o+o+h*|y(e+a+h*|ea)|la+|na+|da+|m+h?m+|u+h+|wh?o+a+h?|hey+|ha+|do+|ba+|sha+)(-(o+h+|a+h+|o+o+h*|la+|na+|da+))*$/.test(text);
}

export type LetterShape = 'ring' | 'stem' | 'tri';
export interface Concept {
  id: string;
  element: ElementKind;
  accent: string;
  icon: string;
  shape: LetterShape;
  stems: string[];
}

const C = (id: string, element: ElementKind, accent: string, icon: string, shape: LetterShape, stems: string): Concept =>
  ({ id, element, accent, icon, shape, stems: stems.split(/\s+/).filter(Boolean) });

export const CONCEPTS: Concept[] = [
  C('fire', 'fire', '#E5532D', 'flame', 'tri', 'fire burn burnt flame ember ash blaze heat hot spark torch ignite inferno scorch smolder match lit'),
  C('star', 'light', '#FFE7B0', 'star', 'ring', 'star heaven galaxy comet constellation cosmos universe'),
  C('moon', 'light', '#C9D1E8', 'moon', 'ring', 'moon moonlight lunar'),
  C('light', 'light', '#F4D58D', 'sun', 'ring', 'light shine shone glow sun dawn morning bright ray beam sunrise daylight lantern candle gleam flash day sunlight halo'),
  C('water', 'water', '#4A90D9', 'drop', 'ring', 'water rain tear ocean river storm sea wave flood drown tide pour drip stream lake swim flow shore harbor'),
  C('shock', 'shock', '#F2E94E', 'bolt', 'stem', 'thunder break broke broken crash shout lightning strike struck bang shatter smash scream explode blast slam crack split fight'),
  C('wind', 'wind', '#A8C5DA', 'wing', 'tri', 'wind air breath breathe fly flew whisper sky breeze blow blew float soar drift sigh'),
  C('vortex', 'vortex', '#9B6DD6', 'spiral', 'ring', 'spin turn around world again dance circle twist whirl swirl round wheel spiral dizzy loop orbit bend'),
  C('quake', 'quake', '#B5763A', 'mountain', 'tri', 'shake earth fall fell rise risen stone wall gate ground mountain rock tremble quake crumble collapse march edge'),
  C('ice', 'ice', '#BFE6F5', 'flake', 'stem', 'cold frozen freeze froze snow still quiet ice frost winter chill numb silent silence'),
  C('smoke', 'smoke', '#8E8E98', 'cloud', 'ring', 'ghost fade dream haze shadow night smoke fog mist dark darkness black vanish sleep midnight'),
  C('heart', 'fire', '#E0245E', 'heart', 'ring', 'heart love kiss lover beloved darling embrace'),
  C('home', 'none', '#D9A05B', 'house', 'tri', 'home house door window garden room roof kitchen'),
  C('time', 'ice', '#C3A36A', 'clock', 'ring', 'time clock hour wait counting count minute tomorrow yesterday forever moment hourglass year'),
  C('road', 'wind', '#8A8F98', 'road', 'stem', 'road street drive run ran journey path walk highway mile border line'),
  C('crown', 'light', '#E8B923', 'crown', 'tri', 'crown king queen gold golden throne royal tyrant kingdom'),
  C('bird', 'wind', '#7FB7E6', 'bird', 'tri', 'bird wing free freedom feather nest dove'),
  C('eye', 'light', '#5FBFA8', 'eye', 'ring', 'eye see saw seen look watch gaze stare blind'),
  C('music', 'vortex', '#D96BB5', 'note', 'stem', 'music song sing sang sung voice melody choir bell drum rhythm'),
  C('key', 'shock', '#B8B8C0', 'key', 'stem', 'key lock open chain cage unlock prison seal'),
  C('flower', 'water', '#E77FA3', 'flower', 'ring', 'flower rose bloom grow grew tree spring seed leaf petal root'),
  C('people', 'none', '#E0A458', 'people', 'stem', 'people crowd together friend friends family everyone children child brother sister father mother name hand'),
];

const BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));
export function conceptById(id: string | undefined): Concept | undefined { return id ? BY_ID.get(id) : undefined; }

const VOWEL = /[aeiou]/;
/** Is `word` a real inflection of `stem`? (+s/es/ed/d/ing/er/ers/y/ly/n/en/'s, doubling, e-drop, y→i) */
export function inflects(word: string, stem: string): boolean {
  if (word === stem) return true;
  if (!word.startsWith(stem.slice(0, Math.max(2, stem.length - 1)))) return false;
  const SUF = ['s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'y', 'ly', 'n', 'en', "'s", 'in', "in'", 'ings', 'est'];
  for (const suf of SUF) {
    if (!word.endsWith(suf)) continue;
    const base = word.slice(0, word.length - suf.length);
    if (base === stem) return true;
    // doubled final consonant: stop → stopped, spin → spinning
    if (base.length === stem.length + 1 && base.slice(0, -1) === stem && base[base.length - 1] === stem[stem.length - 1] && !VOWEL.test(stem[stem.length - 1])) return true;
    // e-drop: dance → dancing, shine → shining
    if (stem.endsWith('e') && base === stem.slice(0, -1) && /^(ing|ed|er|ers|en|y|in|in'|ings|est)$/.test(suf)) return true;
    // y → i: cry → cries, cried
    if (stem.endsWith('y') && base === stem.slice(0, -1) + 'i' && /^(es|ed|er|ers|est)$/.test(suf)) return true;
  }
  return false;
}

const cache = new Map<string, string | null>();
export function conceptOf(text: string): Concept | undefined {
  const w = text.replace(/'s$/, '');
  if (w.length < 3) return undefined;
  if (cache.has(w)) { const id = cache.get(w); return id ? BY_ID.get(id) : undefined; }
  let found: Concept | undefined;
  // exact stems win over inflections ("seed" is a seed, not see+d)
  exact: for (const c of CONCEPTS) for (const s of c.stems) if (w === s) { found = c; break exact; }
  if (!found) outer: for (const c of CONCEPTS) for (const s of c.stems) if (inflects(w, s)) { found = c; break outer; }
  cache.set(w, found ? found.id : null);
  return found;
}
