// Original 2D piece artwork.  One set of hand-drawn silhouettes rendered in eight styles
// (plus a letter-token set built for low vision).  Everything is inline SVG — no external assets.
import { memo } from "react";

export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type PieceColor = "w" | "b";

export const PIECE_SETS_2D: { id: string; name: string; note: string }[] = [
  { id: "staunton", name: "Classic Staunton", note: "Ivory and ebony with engraved detail" },
  { id: "minimal", name: "Modern Minimal", note: "Flat shapes, no outlines" },
  { id: "tournament", name: "Tournament", note: "Bold print-style contrast" },
  { id: "contrast", name: "High-Contrast", note: "Yellow on black with heavy outlines" },
  { id: "mono", name: "Monochrome", note: "Outline and solid, like a diagram" },
  { id: "wood", name: "Wooden", note: "Maple and walnut gradients" },
  { id: "future", name: "Futuristic", note: "Neon wireframe glow" },
  { id: "access", name: "Accessibility", note: "Letter tokens with distinct shapes per side" },
];

const BASE = "M24 87h52v-6c0-3-3-5-6-5H30c-3 0-6 2-6 5z";
type Shape = { body: string[]; detail?: string[]; dots?: [number, number, number][] };
const SHAPES: Record<PieceType, Shape> = {
  p: { body: ["M50 20a12 12 0 1 1 0 24a12 12 0 1 1 0-24z", "M40 45h20v4H40z", "M43 49c1 10-5 17-11 27h36c-6-10-12-17-11-27z", BASE] },
  r: { body: ["M30 19h9v7h7v-7h8v7h7v-7h9v14l-6 6H36l-6-6z", "M36 39h28l3 37H33z", BASE], detail: ["M36 39h28", "M34 68h32"] },
  b: { body: ["M50 10a5 5 0 1 1 0 10a5 5 0 1 1 0-10z", "M50 21c10 8 16 18 16 28 0 7-4 12-9 15H43c-5-3-9-8-9-15 0-10 6-20 16-28z", "M40 64h20l3 12H37z", BASE],
       detail: ["M56 32l-9 14", "M40 64h20"] },
  n: { body: ["M33 76c1-14 5-24 14-31l-9 3c-5 2-10-1-12-5l-2-5 15-15 2-11 9 8c16 3 27 17 27 37v19z", BASE],
       detail: ["M52 20c8 8 11 18 9 30", "M26 43l5-3"], dots: [[40, 33, 2.2]] },
  q: { body: ["M25 35l9 30h32l9-30-11 14-5-21-9 19-9-19-5 21z", "M34 65h32l3 11H31z", BASE],
       dots: [[25, 31, 4.2], [40, 24, 4.2], [50, 22, 4.2], [60, 24, 4.2], [75, 31, 4.2]], detail: ["M34 65h32"] },
  k: { body: ["M47 6h6v7h7v6h-7v10h-6V19h-7v-6h7z", "M29 43c0-8 9-11 21-11s21 3 21 11c0 9-5 16-7 22H36c-2-6-7-13-7-22z", "M36 65h28l3 11H33z", BASE],
       detail: ["M36 65h28", "M50 34v30"] },
};
const LETTER: Record<PieceType, string> = { p: "P", n: "N", b: "B", r: "R", q: "Q", k: "K" };

type Style = { fill: string; stroke: string; sw: number; detail: string; filter?: string; opacity?: number };
function styleFor(set: string, c: PieceColor): Style {
  const w = c === "w";
  switch (set) {
    case "minimal": return { fill: w ? "#f4efe6" : "#2b2f38", stroke: "none", sw: 0, detail: "none" };
    case "tournament": return { fill: w ? "#ffffff" : "#111111", stroke: w ? "#111111" : "#f2f2f2", sw: 3.2, detail: w ? "#111111" : "#f2f2f2" };
    case "contrast": return { fill: w ? "#ffe600" : "#000000", stroke: w ? "#000000" : "#ffe600", sw: 4, detail: w ? "#000000" : "#ffe600" };
    case "mono": return { fill: w ? "none" : "currentColor", stroke: "currentColor", sw: 3, detail: w ? "currentColor" : "var(--sq-light)" };
    case "wood": return { fill: `url(#om-wood-${c})`, stroke: w ? "#6b4a22" : "#1c0f06", sw: 1.8, detail: w ? "#8a6332" : "#7a5a3c" };
    case "future": return { fill: w ? "rgba(120,235,255,0.14)" : "rgba(255,110,220,0.14)", stroke: w ? "#7bebff" : "#ff7ae0", sw: 2.4,
      detail: w ? "#7bebff" : "#ff7ae0", filter: "url(#om-glow)" };
    default: return { fill: `url(#om-st-${c})`, stroke: w ? "#3a2f22" : "#0b0906", sw: 2.2, detail: w ? "#7d6a52" : "#8d8478" };
  }
}

/** Shared gradients/filters — render once inside any <svg> that draws pieces. */
export function PieceDefs() {
  return (
    <defs>
      <linearGradient id="om-st-w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fffdf6" /><stop offset="1" stopColor="#d9cdb6" /></linearGradient>
      <linearGradient id="om-st-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#57504a" /><stop offset="1" stopColor="#15120f" /></linearGradient>
      <linearGradient id="om-wood-w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#e9c98f" /><stop offset=".5" stopColor="#f5dfb2" /><stop offset="1" stopColor="#c99c58" /></linearGradient>
      <linearGradient id="om-wood-b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4a2c16" /><stop offset=".5" stopColor="#6d4526" /><stop offset="1" stopColor="#2e190b" /></linearGradient>
      <filter id="om-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      <filter id="om-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2.5" stdDeviation="2" floodOpacity="0.38" /></filter>
    </defs>
  );
}

/** A piece drawn in a 100×100 box. */
export const Piece2D = memo(function Piece2D({ type, color, set }: { type: PieceType; color: PieceColor; set: string }) {
  if (set === "access") {
    const w = color === "w";
    return (
      <g>
        {w ? <circle cx="50" cy="50" r="38" fill="#ffffff" stroke="#000" strokeWidth="5" />
          : <rect x="13" y="13" width="74" height="74" rx="12" fill="#000" stroke="#fff" strokeWidth="5" />}
        <text x="50" y="68" textAnchor="middle" fontSize="52" fontWeight="800" fontFamily="system-ui, sans-serif" fill={w ? "#000" : "#fff"}>{LETTER[type]}</text>
      </g>
    );
  }
  const s = styleFor(set, color);
  const sh = SHAPES[type];
  return (
    <g filter={s.filter || (set === "mono" || set === "minimal" ? undefined : "url(#om-shadow)")} style={set === "mono" ? { color: "#14110e" } : undefined}>
      <path d={sh.body.join(" ")} fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} strokeLinejoin="round" />
      {sh.dots?.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={type === "n" ? s.detail : s.fill} stroke={type === "n" ? "none" : s.stroke} strokeWidth={s.sw * 0.8} />)}
      {s.detail !== "none" && sh.detail?.map((d, i) => <path key={i} d={d} fill="none" stroke={s.detail} strokeWidth={Math.max(1.6, s.sw * 0.8)} strokeLinecap="round" />)}
    </g>
  );
});

export function PieceIcon({ piece, set = "staunton", size = 28 }: { piece: string; set?: string; size?: number }) {
  const color: PieceColor = piece === piece.toUpperCase() ? "w" : "b";
  return <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block" }}><PieceDefs /><Piece2D type={piece.toLowerCase() as PieceType} color={color} set={set} /></svg>;
}
