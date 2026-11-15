// Interface colour schemes.  The board/3D theme (walnut library, marble, …) is chosen separately;
// a scheme only decides the colours of panels, text and accents.  Every scheme must pass the
// contrast rules in themes.test.ts — add a scheme and the test tells you which pair is too weak.

export type Tokens = {
  bg: string; "bg-2": string; panel: string; "panel-2": string; line: string; "line-soft": string;
  ink: string; "ink-2": string; "ink-3": string;
  brass: string; "brass-2": string; emerald: string; "emerald-2": string;
  ruby: string; amber: string; sky: string; violet: string; danger: string;
  "on-accent": string; "bad-ink": string; "warn-ink": string; "sky-ink": string; "orange-ink": string; "violet-ink": string;
  shadow: string;
};
export type Scheme = { id: string; name: string; note: string; dark: boolean; group: "Light" | "Dark" | "High contrast" | "Matches the board theme"; tokens: Tokens };

const DARK_BASE: Tokens = {
  bg: "#0e0c0a", "bg-2": "#15120f", panel: "#1b1713", "panel-2": "#231e19", line: "#42372d", "line-soft": "#2b241d",
  ink: "#efe6d8", "ink-2": "#b9ab97", "ink-3": "#9a8c7c",
  brass: "#c9a45c", "brass-2": "#e2c88e", emerald: "#2fa37c", "emerald-2": "#55c79e",
  ruby: "#d2584f", amber: "#e0a23a", sky: "#5aa7e0", violet: "#9b82e6", danger: "#b3362d",
  "on-accent": "#1a1408", "bad-ink": "#f0968f", "warn-ink": "#f1c676", "sky-ink": "#a6d2f5", "orange-ink": "#f0a06a", "violet-ink": "#c5b6f7",
  shadow: "0 10px 30px rgba(0, 0, 0, 0.45)",
};
const LIGHT_BASE: Tokens = {
  bg: "#f4f5f7", "bg-2": "#eceef1", panel: "#ffffff", "panel-2": "#f1f3f6", line: "#b9c0cb", "line-soft": "#d9dde4",
  ink: "#14171c", "ink-2": "#3d4450", "ink-3": "#5a6270",
  brass: "#8a6212", "brass-2": "#6d4c0a", emerald: "#157a57", "emerald-2": "#0f6447",
  ruby: "#c23a31", amber: "#b87400", sky: "#1f6fb0", violet: "#6a4fc4", danger: "#b3362d",
  "on-accent": "#ffffff", "bad-ink": "#a3271f", "warn-ink": "#8a5200", "sky-ink": "#155a91", "orange-ink": "#a2480b", "violet-ink": "#5a3fb4",
  shadow: "0 8px 24px rgba(20, 30, 50, 0.14)",
};
const dark = (t: Partial<Tokens>): Tokens => ({ ...DARK_BASE, ...t });
const light = (t: Partial<Tokens>): Tokens => ({ ...LIGHT_BASE, ...t });

export const SCHEMES: Scheme[] = [
  // ---- light
  { id: "daylight", name: "Daylight", note: "Clean white panels on soft grey, gold and green accents.", dark: false, group: "Light", tokens: light({}) },
  { id: "paper", name: "Paper", note: "Warm cream, like a printed opening manual.", dark: false, group: "Light",
    tokens: light({ bg: "#f3ecdd", "bg-2": "#ebe2cf", panel: "#fbf6ea", "panel-2": "#f1e8d5", line: "#bfae8c", "line-soft": "#dccfb2",
      ink: "#211a10", "ink-2": "#4a3f2e", "ink-3": "#665843", brass: "#8a5a14", "brass-2": "#6f450b", emerald: "#2f6f4a", "emerald-2": "#24583a",
      shadow: "0 8px 24px rgba(70, 50, 20, 0.16)" }) },
  { id: "glacier", name: "Glacier", note: "Bright cool blue-white with a blue accent.", dark: false, group: "Light",
    tokens: light({ bg: "#eef4fa", "bg-2": "#e3edf6", panel: "#ffffff", "panel-2": "#edf3f9", line: "#aebfd2", "line-soft": "#d3deea",
      ink: "#0f1b2a", "ink-2": "#34465a", "ink-3": "#506378", brass: "#1c62a8", "brass-2": "#154c85", emerald: "#0f7a6c", "emerald-2": "#0b6257" }) },
  { id: "meadow", name: "Meadow", note: "Fresh green-tinted white with a green accent.", dark: false, group: "Light",
    tokens: light({ bg: "#f0f6ef", "bg-2": "#e5efe3", panel: "#ffffff", "panel-2": "#eef5ec", line: "#afc3ac", "line-soft": "#d4e1d1",
      ink: "#122015", "ink-2": "#37493a", "ink-3": "#526655", brass: "#1f7a3d", "brass-2": "#17602f", emerald: "#1a6fa8", "emerald-2": "#135785" }) },
  { id: "blossom", name: "Blossom", note: "Bright and warm: rose-tinted white with a magenta accent.", dark: false, group: "Light",
    tokens: light({ bg: "#faf1f4", "bg-2": "#f4e6eb", panel: "#ffffff", "panel-2": "#f8edf1", line: "#d0b3bd", "line-soft": "#e8d5dc",
      ink: "#24121a", "ink-2": "#51363f", "ink-3": "#6e505a", brass: "#a32464", "brass-2": "#821a4f", emerald: "#1c7a66", "emerald-2": "#156252" }) },
  // ---- dark
  { id: "graphite", name: "Graphite", note: "Neutral dark grey, no colour cast.", dark: true, group: "Dark",
    tokens: dark({ bg: "#111214", "bg-2": "#17181b", panel: "#1d1f23", "panel-2": "#26282d", line: "#3d4047", "line-soft": "#2d2f35",
      ink: "#ececee", "ink-2": "#b4b7bf", "ink-3": "#9296a0", brass: "#d9b25f", "brass-2": "#ecd08f" }) },
  { id: "midnight", name: "Midnight", note: "Deep blue with sky-blue accents.", dark: true, group: "Dark",
    tokens: dark({ bg: "#0a0f1a", "bg-2": "#0f1626", panel: "#141d30", "panel-2": "#1b263c", line: "#2f3f5c", "line-soft": "#223049",
      ink: "#e6eefb", "ink-2": "#a9b9d3", "ink-3": "#8496b3", brass: "#6fb4f5", "brass-2": "#a8d3ff", emerald: "#3fcf9f", "emerald-2": "#79e6c1", "on-accent": "#06121f" }) },
  // ---- high contrast
  { id: "contrast-light", name: "High contrast — light", note: "Black on white, strong borders. For bright rooms and projectors.", dark: false, group: "High contrast",
    tokens: light({ bg: "#ffffff", "bg-2": "#f2f2f2", panel: "#ffffff", "panel-2": "#ececec", line: "#4d4d4d", "line-soft": "#8a8a8a",
      ink: "#000000", "ink-2": "#1f1f1f", "ink-3": "#3a3a3a", brass: "#6b4700", "brass-2": "#4f3400", emerald: "#005c3d", "emerald-2": "#004a31",
      "bad-ink": "#8a0f08", "warn-ink": "#6b3f00", "sky-ink": "#0b4777", "orange-ink": "#7d3300", "violet-ink": "#43298f", danger: "#9c1c14" }) },
  { id: "contrast-dark", name: "High contrast — dark", note: "White on black, strong borders.", dark: true, group: "High contrast",
    tokens: dark({ bg: "#000000", "bg-2": "#0a0a0a", panel: "#0d0d0d", "panel-2": "#1a1a1a", line: "#8c8c8c", "line-soft": "#5c5c5c",
      ink: "#ffffff", "ink-2": "#e2e2e2", "ink-3": "#c4c4c4", brass: "#ffd166", "brass-2": "#ffe29c", emerald: "#3fe0a5", "emerald-2": "#86f2cb",
      "bad-ink": "#ffaaa3", "warn-ink": "#ffd98a", "on-accent": "#000000" }) },
  // ---- the palettes that go with each board theme (what "Match the board theme" uses)
  { id: "library", name: "Walnut", note: "Walnut, brass and emerald.", dark: true, group: "Matches the board theme", tokens: dark({}) },
  { id: "marble", name: "Marble", note: "Charcoal with gold and steel blue.", dark: true, group: "Matches the board theme",
    tokens: dark({ bg: "#101114", "bg-2": "#17181c", panel: "#1d1f24", "panel-2": "#262930", line: "#42464f", "line-soft": "#2c2f37", "ink-3": "#a0a3ab", brass: "#d6b56a", emerald: "#6a9bd8", "emerald-2": "#9dc0ee" }) },
  { id: "observatory", name: "Observatory", note: "Deep navy with cyan.", dark: true, group: "Matches the board theme",
    tokens: dark({ bg: "#060b12", "bg-2": "#0a121c", panel: "#0e1824", "panel-2": "#132131", line: "#1f3850", "line-soft": "#16293b", ink: "#dff3ff", "ink-2": "#93b6cc", "ink-3": "#7798ae",
      brass: "#5fd4ff", "brass-2": "#a4e8ff", emerald: "#38e0b0", "emerald-2": "#7cf2d0", "on-accent": "#04121c" }) },
  { id: "arena", name: "Arena", note: "Black with amber and blue.", dark: true, group: "Matches the board theme",
    tokens: dark({ bg: "#0b0c10", "bg-2": "#12141a", panel: "#181b23", "panel-2": "#20242e", line: "#343a48", "line-soft": "#272c37", "ink-3": "#959aa6", brass: "#f0b429", "brass-2": "#ffd56b", emerald: "#3b82f6", "emerald-2": "#7fb0ff" }) },
  { id: "zen", name: "Zen", note: "Dark olive-brown with muted sand.", dark: true, group: "Matches the board theme",
    tokens: dark({ bg: "#12110e", "bg-2": "#191813", panel: "#201f19", "panel-2": "#29271f", line: "#403c2f", "line-soft": "#302d23", ink: "#ece7d8", "ink-3": "#9c9480", brass: "#b9a57a", "brass-2": "#d9c9a2", emerald: "#7c9a6a", "emerald-2": "#a5c092" }) },
  { id: "cosmic", name: "Cosmic", note: "Dark violet with lavender and teal.", dark: true, group: "Matches the board theme",
    tokens: dark({ bg: "#07060f", "bg-2": "#0d0b19", panel: "#131026", "panel-2": "#1a1733", line: "#2f2a57", "line-soft": "#221e42", ink: "#ebe8ff", "ink-2": "#aaa3d6", "ink-3": "#8d86bd",
      brass: "#b79cff", "brass-2": "#d8c8ff", emerald: "#4fd1c5", "emerald-2": "#8be9df", "on-accent": "#120b2b" }) },
];

/** "auto" = the palette that goes with the board theme; "system" = Daylight or the board palette, following the OS. */
export function resolveScheme(ui: string | undefined, boardTheme: string, systemPrefersLight = false): Scheme {
  const byId = (id: string) => SCHEMES.find((s) => s.id === id);
  const board = byId(boardTheme) || byId("library")!;
  if (!ui || ui === "auto") return board;
  if (ui === "system") return systemPrefersLight ? byId("daylight")! : board;
  return byId(ui) || board;
}

export function applyScheme(s: Scheme, root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(s.tokens)) root.style.setProperty(`--${k}`, v);
  root.style.colorScheme = s.dark ? "dark" : "light";
  root.dataset.ui = s.dark ? "dark" : "light";
}

// ---------------------------------------------------------------------------- contrast (WCAG 2.x)
export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** Mix `fg` over `bg` at `alpha` — for the tinted note and pill backgrounds built with color-mix(). */
export function mix(fg: string, bg: string, alpha: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [f, b] = [p(fg), p(bg)];
  return "#" + f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}

/** Every text/background pair the interface actually uses, with the minimum ratio it must reach. */
export function contrastPairs(t: Tokens): { name: string; fg: string; bg: string; min: number }[] {
  const surfaces: [string, string][] = [["bg", t.bg], ["bg-2", t["bg-2"]], ["panel", t.panel], ["panel-2", t["panel-2"]]];
  const out: { name: string; fg: string; bg: string; min: number }[] = [];
  for (const [sn, s] of surfaces) {
    out.push({ name: `body text on ${sn}`, fg: t.ink, bg: s, min: 7 });
    out.push({ name: `secondary text on ${sn}`, fg: t["ink-2"], bg: s, min: 4.5 });
    out.push({ name: `muted text on ${sn}`, fg: t["ink-3"], bg: s, min: 4.5 });
    out.push({ name: `accent text on ${sn}`, fg: t["brass-2"], bg: s, min: 4.5 });
    out.push({ name: `good text on ${sn}`, fg: t["emerald-2"], bg: s, min: 4.5 });
    out.push({ name: `bad text on ${sn}`, fg: t["bad-ink"], bg: s, min: 4.5 });
    out.push({ name: `warning text on ${sn}`, fg: t["warn-ink"], bg: s, min: 4.5 });
    out.push({ name: `info text on ${sn}`, fg: t["sky-ink"], bg: s, min: 4.5 });
    out.push({ name: `mistake text on ${sn}`, fg: t["orange-ink"], bg: s, min: 4.5 });
    out.push({ name: `interesting-move text on ${sn}`, fg: t["violet-ink"], bg: s, min: 4.5 });
  }
  out.push({ name: "primary button label", fg: t["on-accent"], bg: t.brass, min: 4.5 });
  out.push({ name: "primary button label (top of gradient)", fg: t["on-accent"], bg: t["brass-2"], min: 4.5 });
  out.push({ name: "stop / danger button label", fg: "#ffffff", bg: t.danger, min: 4.5 });
  // tinted callouts: 8–10% of a colour over a panel, with secondary text on top
  for (const [n, c] of [["note", t.brass], ["good note", t.emerald], ["bad note", t.ruby], ["warning note", t.amber]] as const)
    out.push({ name: `${n} text`, fg: t["ink-2"], bg: mix(c, t.panel, 0.1), min: 4.5 });
  out.push({ name: "selected row text", fg: t.ink, bg: mix(t.brass, t.panel, 0.22), min: 7 });
  // non-text: input and panel borders must be visible against what they sit on
  out.push({ name: "control border on panel", fg: t.line, bg: t.panel, min: 1.4 });
  out.push({ name: "accent fill on panel (meters, active tab)", fg: t.brass, bg: t.panel, min: 3 });
  out.push({ name: "good fill on panel (meters)", fg: t.emerald, bg: t.panel, min: 3 });
  return out;
}
