// The edit: scene windows, the eight eras and the global "events" that drive
// camera shake, flashes, chromatic aberration and the soundtrack.

export const FPS = 60;
export const DURATION = 15;

export const ERAS = [
  { year: 1968, t0: 2.0, t1: 3.5, n: '01', kicker: 'DUAL RESONANCE',
    head: ['An 18th-century formula', 'fits the strong force'],
    names: 'Gabriele Veneziano  ·  Euler beta function' },
  { year: 1970, t0: 3.5, t1: 5.0, n: '02', kicker: 'THE STRING PICTURE',
    head: ['Particles are notes', 'on a vibrating string'],
    names: 'Nambu  ·  Nielsen  ·  Susskind' },
  { year: 1974, t0: 5.0, t1: 6.5, n: '03', kicker: 'QUANTUM GRAVITY',
    head: ['A massless spin-2 mode:', 'the graviton'],
    names: 'Scherk  ·  Schwarz  ·  Yoneya' },
  { year: 1984, t0: 6.5, t1: 8.0, n: '04', kicker: 'FIRST SUPERSTRING REVOLUTION',
    head: ['Anomalies cancel', 'in ten dimensions'],
    names: 'Green & Schwarz  ·  SO(32) or E₈ × E₈' },
  { year: 1985, t0: 8.0, t1: 9.5, n: '05', kicker: 'COMPACTIFICATION',
    head: ['Six dimensions,', 'curled up small'],
    names: 'Candelas  ·  Horowitz  ·  Strominger  ·  Witten' },
  { year: 1995, t0: 9.5, t1: 11.0, n: '06', kicker: 'SECOND SUPERSTRING REVOLUTION',
    head: ['Five theories,', 'one M'],
    names: 'Witten  ·  Hull  ·  Townsend  ·  Polchinski' },
  { year: 1997, t0: 11.0, t1: 12.5, n: '07', kicker: 'HOLOGRAPHY',
    head: ['Gravity inside is a quantum', 'theory on the boundary'],
    names: 'Juan Maldacena  ·  AdS / CFT' },
  { year: 2003, t0: 12.5, t1: 13.5, n: '08', kicker: 'THE LANDSCAPE',
    head: ['A landscape of', 'possible universes'],
    names: 'KKLT  ·  Susskind  ·  Bousso – Polchinski' },
];

export const OUTRO = 13.5;
export const NOW = 2026;

// Impact events: [time, strength]. Shared by picture (shake/flash/CA) and sound.
export const HITS = [
  [0.78, 0.35], // first pluck
  [2.0, 0.45], // string lands on the timeline
  [6.5, 1.0], // hard cut: 1984
  [7.0, 0.6], // E8 snaps into symmetry
  [9.5, 0.55], // whip pan into 1995
  [10.05, 0.7], // "M"
  [13.5, 0.6], // implosion -> outro
  [13.92, 0.5], // final pluck
];
