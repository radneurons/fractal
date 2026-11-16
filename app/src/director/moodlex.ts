// Lyric valence/arousal lexicon (SPEC §4A.7): hand-curated for this project — not a licensed dataset.
// Groups are [valence −1..1, arousal 0..1, words…]; ~800 common lyric words.

const GROUPS: [number, number, string][] = [
  // --- bright, high energy ---
  [0.9, 0.85, `joy joyful ecstasy ecstatic thrill thrilled thrilling celebrate celebration party dancing dance jump jumping wild alive
    electric fireworks victory win winner winning triumph triumphant glory glorious amazing incredible wonderful fantastic euphoria
    laugh laughing laughter cheer cheering shine shining sparkle sparkling dazzle blazing soaring soar fly flying flight free freedom`],
  [0.8, 0.7, `love loving loved lover adore adored passion passionate kiss kissing desire wanted hot fever rush racing spin spinning
    summer sunshine sun golden gold bright brighter brightest glow glowing radiant rise rising risen higher high lift lifted
    hero brave bold strong stronger power powerful mighty unstoppable fearless proud pride champion crown king queen`],
  [0.7, 0.55, `happy happiness glad smile smiling fun play playing sing singing song music melody rhythm beat groove friend friends
    together family home welcome hello yes sweet sweetheart honey sugar darling baby angel beautiful beauty pretty lovely
    good better best great nice fine lucky luck hope hopeful dream dreaming dreams wish wishing magic magical wonder`],
  // --- bright, calm ---
  [0.7, 0.25, `peace peaceful calm quiet gentle gently soft softly tender tenderly warm warmth safe safety rest resting easy ease
    still stillness serene breeze breathe breathing slow slowly lullaby cradle embrace hold holding held comfort cozy
    morning dawn sunrise spring bloom blossom flower flowers garden meadow river ocean sea shore sky stars starlight moonlight`],
  [0.6, 0.3, `grace graceful blessed blessing bless faith faithful believe believing trust true truth honest kind kindness mercy
    forgive forgiven forgiveness heal healing healed mend whole pure clear light lighter heaven heavenly holy sacred pray prayer
    remember memory memories forever always promise promised belong belonging stay staying near close closer`],
  // --- neutral-positive motion ---
  [0.3, 0.6, `run running ride riding drive driving road highway journey travel wander wandering move moving go going come coming
    chase chasing follow turn turning roll rolling wheel wheels wind wave waves fast faster speed rush hurry leap climb climbing
    open opening begin beginning start new tomorrow future ready wake waking awake arise march marching forward onward`],
  // --- dark, high energy ---
  [-0.8, 0.9, `rage raging fury furious hate hatred hating war battle fight fighting fought kill killing killed murder blood bloody
    scream screaming shout shouting yell violence violent attack destroy destroyed destruction explode explosion crash crashing
    burn burning burned fire flames inferno hell devil demon demons monster terror terrified horror panic riot chaos storm thunder`],
  [-0.7, 0.75, `anger angry mad wrath revenge vengeance enemy enemies betray betrayed betrayal liar lies lying cheat cheated poison
    venom knife gun bullet bullets weapon weapons bomb break breaking broke broken shatter shattered smash tear tearing torn rip
    fear afraid scared danger dangerous threat trapped trap cage chains chained prison escape run tyrant tyrants conquer conquered`],
  [-0.6, 0.6, `pain painful hurt hurting hurts ache aching wound wounded scar scars bleed bleeding cry crying cried tears scream
    desperate desperation struggle struggling fall falling fell drown drowning sinking crush crushed pressure fever sick
    trouble troubled wrong guilty guilt shame blame curse cursed doom doomed wreck wrecked ruin ruined crumble collapse`],
  // --- dark, calm ---
  [-0.8, 0.25, `sad sadness sorrow sorrowful grief grieving mourn mourning misery miserable despair hopeless lonely loneliness alone
    empty emptiness hollow numb cold colder frozen dead death die dying died grave graves funeral ghost ghosts gone lost losing
    loss goodbye farewell leave leaving left abandoned forgotten forget fade fading faded wither withered dust ashes ash`],
  [-0.6, 0.2, `dark darkness shadow shadows night midnight black grey gray rain raining winter snow fog mist haze smoke silence silent
    tired weary weak weakness heavy burden bitter regret regrets sorry missing miss missed apart distance distant away far
    late end ending ended over never nothing nowhere nobody without wait waiting waited`],
  [-0.4, 0.4, `doubt doubts worry worried anxious nervous restless sleepless haunted haunt haunting secret secrets hide hiding hidden
    whisper whispers stranger strangers wall walls border borders line lines stone stones rust rusted broken-hearted
    cheap fake false pretend mask masks game games fool foolish blind lie`],
  // --- neutral intensity ---
  [0.0, 0.8, `now tonight loud louder crazy insane wild hard harder push pull hit hits bang beat drum drums bass shake shaking
    tremble trembling rock rocking roll thunderous lightning electric shock rush flash blast boom`],
  [0.0, 0.2, `slow quiet hush hushed sleep sleeping asleep dream drift drifting float floating low lower under beneath below deep
    deeper sleepy pale faint dim still waiting`],
  [0.5, 0.75, `tonight shout sing loud bounce clap hands fire lit burning bright spark sparks flame ignite blaze thunder roar roaring
    charge storming rebel rebels revolution uprising defiant defy unbroken unbreakable survive survivor rising reborn awaken
    conquer overcome breakthrough breaking-free release released unleash unleashed blast rocket lightning`],
  [0.4, 0.2, `autumn evening dusk twilight candle lantern harbor window rainfall drizzle snowfall hometown yesterday childhood
    letter letters photograph picture old older years ago once whisper whispering humming echo echoes tide tides drifting
    wandering quiet-night lull softness velvet silver paper lamplight firelight`],
  [-0.5, 0.5, `chain cage locked lock stolen steal stole thief buried bury sunk drowned swallowed hunger hungry starving thirst
    cold-hearted cruel cruelty wicked evil sin sins sinner fallen fate doom ending apocalypse plague famine tyranny
    surrender defeated defeat lose loser failing fail failed falling-apart wasted waste`],
  [0.2, 0.4, `heart hearts soul souls mind eyes hands hand face name names voice voices word words story stories time years days
    world earth land city town street house door window room road river mountain mountains tree trees sea`],
];

const LEX = new Map<string, [number, number]>();
for (const [v, a, list] of GROUPS) for (const w of list.split(/\s+/)) if (w && !LEX.has(w)) LEX.set(w, [v, a]);

const NEGATORS = new Set(['not', 'no', 'never', "don't", "dont", "can't", "cant", "won't", "wont", "ain't", "aint", 'without', "isn't", "wasn't", "didn't", "couldn't", "wouldn't", 'nor', 'neither']);
const INTENSIFIERS = new Set(['so', 'very', 'really', 'too', 'much', 'more', 'most', 'all', 'ever', 'forever', 'always', 'deeply', 'truly']);

export const MOOD_LEXICON_SIZE = LEX.size;

function lookup(w: string): [number, number] | undefined {
  const hit = LEX.get(w);
  if (hit) return hit;
  // simple inflections
  for (const suf of ["'s", 's', 'ed', 'ing', 'ly', 'er', 'est', 'es', 'd']) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      const base = w.slice(0, -suf.length);
      const h = LEX.get(base) ?? LEX.get(base + 'e');
      if (h) return h;
    }
  }
  return undefined;
}

/** Valence (−1..1) and arousal (0..1) of a line: negation flips valence within 3 words; intensifiers × 1.3. */
export function lyricMood(words: string[]): { valence: number; arousal: number } {
  let v = 0, a = 0, n = 0;
  let neg = 0, boost = 1;
  for (const w of words) {
    if (NEGATORS.has(w)) { neg = 3; continue; }
    if (INTENSIFIERS.has(w)) { boost = 1.3; if (neg > 0) neg--; continue; }
    const hit = lookup(w);
    if (hit) {
      let [val, aro] = hit;
      if (neg > 0) val = -val * 0.8;
      val = Math.max(-1, Math.min(1, val * boost));
      aro = Math.min(1, aro * (boost > 1 ? 1.1 : 1));
      v += val; a += aro; n++;
      boost = 1;
    }
    if (neg > 0) neg--;
  }
  return n ? { valence: v / n, arousal: a / n } : { valence: 0, arousal: 0.4 };
}
