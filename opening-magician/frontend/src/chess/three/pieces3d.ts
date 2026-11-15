// Original procedural 3D chess pieces.
// Bodies are turned on a virtual lathe from hand-tuned spline profiles (how real Staunton pieces
// are made); knights are sculpted from a bevelled horse-head extrusion on a turned base; rooks get
// real crenellations, queens a coronet, kings a cross.  No external models are loaded.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type PieceKind = "p" | "n" | "b" | "r" | "q" | "k";
export type PieceGeo = { body: THREE.BufferGeometry; accent?: THREE.BufferGeometry; height: number };
export type Family = "staunton" | "architectural";

export const PIECE_SETS_3D: { id: string; name: string; family: Family; note: string }[] = [
  { id: "staunton", name: "Sculpted Staunton", family: "staunton", note: "Lacquered boxwood and ebony" },
  { id: "wood", name: "Premium Wood", family: "staunton", note: "Maple and walnut with visible grain" },
  { id: "marble", name: "Marble & Gold", family: "staunton", note: "Veined stone with gilded crowns" },
  { id: "metal", name: "Brushed Metal", family: "staunton", note: "Steel and gunmetal" },
  { id: "ceramic", name: "Ceramic", family: "staunton", note: "Glazed porcelain with clear coat" },
  { id: "architectural", name: "Minimal Architectural", family: "architectural", note: "Faceted, stepped forms" },
  { id: "holo", name: "Sci-fi Holographic", family: "staunton", note: "Light-field pieces with rim glow" },
];

type P = [number, number]; // [radius, height]

function turned(points: P[], segments: number, smooth = true): THREE.BufferGeometry {
  let pts: THREE.Vector2[];
  if (smooth) {
    const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
    pts = curve.getPoints(points.length * 7);
    pts.forEach((p) => { if (p.x < 0) p.x = 0; });
  } else pts = points.map(([r, y]) => new THREE.Vector2(r, y));
  pts[0].x = 0.0001;
  pts[pts.length - 1].x = 0.0001;
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return g;
}

// A common turned foot keeps the set visually related.
const foot = (r: number): P[] => [[0, 0], [r, 0], [r * 1.02, 0.035], [r * 0.93, 0.085], [r * 0.8, 0.105], [r * 0.82, 0.14], [r * 0.62, 0.19]];

const PROFILES: Record<PieceKind, { pts: P[]; h: number }> = {
  p: { h: 0.78, pts: [...foot(0.3), [0.2, 0.3], [0.15, 0.42], [0.2, 0.47], [0.24, 0.5], [0.13, 0.535], [0.17, 0.6], [0.185, 0.67], [0.13, 0.75], [0, 0.78]] },
  r: { h: 0.9, pts: [...foot(0.34), [0.25, 0.32], [0.22, 0.5], [0.23, 0.6], [0.3, 0.66], [0.3, 0.7], [0.25, 0.72], [0.27, 0.78], [0.27, 0.82], [0, 0.82]] },
  n: { h: 1.0, pts: [...foot(0.34), [0.27, 0.27], [0.3, 0.32], [0.24, 0.36], [0, 0.37]] },
  b: { h: 1.12, pts: [...foot(0.33), [0.21, 0.34], [0.14, 0.52], [0.2, 0.58], [0.25, 0.61], [0.12, 0.65], [0.16, 0.72], [0.2, 0.82], [0.16, 0.93], [0.07, 1.02], [0.04, 1.04], [0.07, 1.07], [0.055, 1.105], [0, 1.12]] },
  q: { h: 1.28, pts: [...foot(0.36), [0.24, 0.36], [0.15, 0.62], [0.21, 0.7], [0.27, 0.73], [0.13, 0.78], [0.15, 0.86], [0.22, 1.0], [0.27, 1.08], [0.2, 1.1], [0.12, 1.12], [0.08, 1.16], [0.1, 1.2], [0.07, 1.25], [0, 1.28]] },
  k: { h: 1.42, pts: [...foot(0.37), [0.25, 0.38], [0.16, 0.66], [0.22, 0.74], [0.28, 0.77], [0.14, 0.82], [0.16, 0.9], [0.21, 1.04], [0.26, 1.13], [0.22, 1.16], [0.1, 1.18], [0.07, 1.2], [0, 1.2]] },
};

function knightHead(depth: number, bevel: number): THREE.BufferGeometry {
  // Side silhouette of the horse's head and neck (facing +x), in piece units.
  const s = new THREE.Shape();
  s.moveTo(-0.2, 0.34);
  s.bezierCurveTo(-0.26, 0.55, -0.2, 0.74, -0.06, 0.86);     // back of the neck (mane)
  s.lineTo(-0.03, 0.99);                                     // ear
  s.lineTo(0.05, 0.9);
  s.bezierCurveTo(0.16, 0.88, 0.24, 0.8, 0.3, 0.68);          // forehead to nose
  s.lineTo(0.34, 0.58);
  s.bezierCurveTo(0.35, 0.53, 0.3, 0.5, 0.25, 0.52);          // muzzle
  s.lineTo(0.2, 0.56);
  s.bezierCurveTo(0.14, 0.6, 0.1, 0.6, 0.07, 0.57);           // jaw
  s.bezierCurveTo(0.05, 0.5, 0.12, 0.44, 0.19, 0.34);         // chest
  s.lineTo(-0.2, 0.34);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 14 });
  g.translate(0, 0, -depth / 2);
  // taper the muzzle so the head reads as sculpted rather than cut from a plank
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const t = THREE.MathUtils.clamp((x + 0.05) / 0.4, 0, 1);
    const neck = THREE.MathUtils.clamp((0.75 - y) / 0.4, 0, 1);
    pos.setZ(i, pos.getZ(i) * (1 - 0.5 * t) * (0.78 + 0.34 * neck));
  }
  g.computeVertexNormals();
  return g;
}

function ring(count: number, radius: number, y: number, make: () => THREE.BufferGeometry): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const g = make();
    g.rotateY(-a);
    g.translate(Math.cos(a) * radius, y, Math.sin(a) * radius);
    out.push(g);
  }
  return out;
}

const cache = new Map<string, PieceGeo>();

/** Geometry for one piece.  `detail` = radial segments (quality tier). */
export function pieceGeometry(kind: PieceKind, family: Family, detail = 40): PieceGeo {
  const key = `${kind}:${family}:${detail}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const geo = family === "architectural" ? architectural(kind) : staunton(kind, detail);
  cache.set(key, geo);
  return geo;
}

function nonIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(name)) n.deleteAttribute(name);
  return n;
}
const merge = (parts: THREE.BufferGeometry[]) => { const m = mergeGeometries(parts.map(nonIndexed), false)!; m.computeVertexNormals(); return m; };

function staunton(kind: PieceKind, seg: number): PieceGeo {
  const { pts, h } = PROFILES[kind];
  const body = turned(pts, seg);
  if (kind === "r") {
    const merlons = ring(6, 0.215, 0.865, () => new THREE.BoxGeometry(0.1, 0.11, 0.13));
    return { body: merge([body, ...merlons]), height: h };
  }
  if (kind === "n") {
    const head = knightHead(0.2, 0.035);
    const eyeL = new THREE.SphereGeometry(0.022, 10, 8); eyeL.translate(0.12, 0.76, 0.085);
    const eyeR = new THREE.SphereGeometry(0.022, 10, 8); eyeR.translate(0.12, 0.76, -0.085);
    const body2 = merge([body, head]);
    body2.rotateY(Math.PI / 2);                       // face "forward" (towards -z for white before colour flip)
    const acc = merge([eyeL, eyeR]); acc.rotateY(Math.PI / 2);
    return { body: body2, accent: acc, height: h };
  }
  if (kind === "b") {
    const slit = new THREE.BoxGeometry(0.34, 0.035, 0.34);
    slit.rotateZ(-0.85); slit.translate(0.07, 0.9, 0);
    return { body, accent: slit, height: h };
  }
  if (kind === "q") {
    const pearls = ring(8, 0.255, 1.1, () => new THREE.SphereGeometry(0.038, 10, 8));
    const band = new THREE.TorusGeometry(0.2, 0.022, 8, 28); band.rotateX(Math.PI / 2); band.translate(0, 0.74, 0);
    return { body, accent: merge([...pearls, band]), height: h };
  }
  if (kind === "k") {
    const up = new THREE.BoxGeometry(0.07, 0.24, 0.05); up.translate(0, 1.31, 0);
    const across = new THREE.BoxGeometry(0.19, 0.065, 0.05); across.translate(0, 1.33, 0);
    const band = new THREE.TorusGeometry(0.21, 0.022, 8, 28); band.rotateX(Math.PI / 2); band.translate(0, 0.78, 0);
    return { body, accent: merge([up, across, band]), height: h };
  }
  return { body, height: h };
}

/** Faceted, stepped forms: octagonal turnings with a distinct, readable top for every piece. */
function architectural(kind: PieceKind): PieceGeo {
  const oct = (pts: P[]) => { const g = turned(pts, 8, false); return g; };
  const plinth: P[] = [[0, 0], [0.31, 0], [0.31, 0.07], [0.25, 0.07], [0.25, 0.12]];
  switch (kind) {
    case "p": return { body: merge([oct([...plinth, [0.14, 0.42], [0.2, 0.42], [0.2, 0.62], [0, 0.62]])]), height: 0.62 };
    case "r": {
      const b = oct([...plinth, [0.22, 0.6], [0.28, 0.6], [0.28, 0.8], [0.18, 0.8], [0.18, 0.72], [0, 0.72]]);
      return { body: merge([b]), height: 0.8 };
    }
    case "n": {
      const base = oct([...plinth, [0.2, 0.34], [0, 0.34]]);
      const wedge = new THREE.BoxGeometry(0.22, 0.56, 0.42);
      const pos = wedge.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) { pos.setZ(i, pos.getZ(i) * 0.55 - 0.12); pos.setX(i, pos.getX(i) * 0.8); }
      wedge.translate(0, 0.62, 0.02);
      const snout = new THREE.BoxGeometry(0.17, 0.16, 0.26); snout.translate(0, 0.74, -0.24);
      return { body: merge([base, wedge, snout]), height: 0.92 };
    }
    case "b": {
      const b = oct([...plinth, [0.13, 0.62], [0.2, 0.7], [0, 1.02]]);
      const notch = new THREE.BoxGeometry(0.3, 0.03, 0.3); notch.rotateZ(-0.8); notch.translate(0.05, 0.84, 0);
      return { body: merge([b]), accent: notch, height: 1.02 };
    }
    case "q": {
      const b = oct([...plinth, [0.13, 0.7], [0.27, 1.02], [0.2, 1.02], [0.2, 0.95], [0, 0.95]]);
      const gem = new THREE.OctahedronGeometry(0.09); gem.translate(0, 1.12, 0);
      return { body: merge([b]), accent: gem, height: 1.2 };
    }
    default: {
      const b = oct([...plinth, [0.14, 0.76], [0.26, 1.04], [0.26, 1.12], [0, 1.12]]);
      const up = new THREE.BoxGeometry(0.07, 0.26, 0.07); up.translate(0, 1.26, 0);
      const across = new THREE.BoxGeometry(0.2, 0.07, 0.07); across.translate(0, 1.28, 0);
      return { body: merge([b]), accent: merge([up, across]), height: 1.4 };
    }
  }
}

// ---------------------------------------------------------------------------- procedural textures
function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function rng(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

const texCache = new Map<string, THREE.Texture>();
const memo = (key: string, make: () => THREE.Texture) => { let t = texCache.get(key); if (!t) { t = make(); texCache.set(key, t); } return t; };

export function woodTexture(base: string, dark: string, seed = 1, repeat = 1) {
  return memo(`wood:${base}:${dark}:${seed}:${repeat}`, () => canvasTex(512, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = r() * s; const w = 1 + r() * 5;
      ctx.strokeStyle = dark; ctx.globalAlpha = 0.07 + r() * 0.2; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x, 0);
      let cx = x;
      for (let y = 0; y <= s; y += 32) { cx += (r() - 0.5) * 14; ctx.lineTo(cx, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = r() * s, y = r() * s;
      ctx.globalAlpha = 0.16; ctx.strokeStyle = dark;
      for (let k = 1; k < 7; k++) { ctx.beginPath(); ctx.ellipse(x, y, k * 5, k * 13, 0, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }, repeat));
}

export function marbleTexture(base: string, vein: string, seed = 1, repeat = 1) {
  return memo(`marble:${base}:${vein}:${seed}:${repeat}`, () => canvasTex(512, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 400; i++) { ctx.globalAlpha = 0.03; ctx.fillStyle = r() > 0.5 ? "#fff" : "#000"; ctx.beginPath(); ctx.arc(r() * s, r() * s, 6 + r() * 40, 0, 7); ctx.fill(); }
    for (let i = 0; i < 16; i++) {
      ctx.strokeStyle = vein; ctx.globalAlpha = 0.12 + r() * 0.35; ctx.lineWidth = 0.6 + r() * 2.4;
      ctx.beginPath();
      let x = r() * s, y = r() * s; ctx.moveTo(x, y);
      for (let k = 0; k < 18; k++) { x += (r() - 0.35) * 60; y += (r() - 0.5) * 60; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, repeat));
}

export function brushedTexture(seed = 1) {
  return memo(`brushed:${seed}`, () => {
    const t = canvasTex(256, (ctx, s) => {
      const r = rng(seed);
      ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y++) { const v = 96 + Math.floor(r() * 80); ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(0, y, s, 1); }
    }, 3);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });
}

// ---------------------------------------------------------------------------- materials per set
export type PieceMaterials = { body: THREE.Material; accent: THREE.Material };

const HOLO_VERT = `varying vec3 vN; varying vec3 vV; varying float vY;
void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix * mv; }`;
const HOLO_FRAG = `uniform vec3 uColor; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY;
void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float scan = 0.5 + 0.5 * sin(vY * 70.0 - uTime * 3.0);
  float a = clamp(0.16 + f * 0.95 + scan * 0.07, 0.0, 1.0);
  gl_FragColor = vec4(uColor * (0.45 + f * 1.6 + scan * 0.12), a); }`;

export const holoUniforms = { uTime: { value: 0 } };

export function pieceMaterials(set: string, white: boolean): PieceMaterials {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const phys = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);
  switch (set) {
    case "wood": {
      const body = std({ map: white ? woodTexture("#e7c58c", "#8a5a22", 3) : woodTexture("#5a3418", "#1d0d04", 4), roughness: 0.42, metalness: 0 });
      return { body, accent: std({ color: white ? "#6a4416" : "#c79a55", roughness: 0.4 }) };
    }
    case "marble": {
      const body = phys({ map: white ? marbleTexture("#f4f1ea", "#8d8a86", 5) : marbleTexture("#1b1c20", "#6d7078", 6), roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.2 });
      return { body, accent: std({ color: "#d9b25a", metalness: 1, roughness: 0.22 }) };
    }
    case "metal": {
      const body = std({ color: white ? "#d5d8dd" : "#3a3d44", metalness: 1, roughness: 0.34, roughnessMap: brushedTexture(2) });
      return { body, accent: std({ color: white ? "#8d9199" : "#b98a3a", metalness: 1, roughness: 0.25 }) };
    }
    case "ceramic": {
      const body = phys({ color: white ? "#f6f3ec" : "#16233a", roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.3 });
      return { body, accent: std({ color: white ? "#2b4a7a" : "#e8e2d2", roughness: 0.2 }) };
    }
    case "architectural": {
      const body = std({ color: white ? "#ece8df" : "#2a2c31", roughness: 0.75, metalness: 0, flatShading: true });
      return { body, accent: std({ color: white ? "#c9a45c" : "#c9a45c", roughness: 0.35, metalness: 0.8, flatShading: true }) };
    }
    case "holo": {
      const mk = (c: string) => new THREE.ShaderMaterial({ vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uColor: { value: new THREE.Color(c) }, uTime: holoUniforms.uTime } });
      return { body: mk(white ? "#6fe9ff" : "#ff6fd8"), accent: mk(white ? "#ffffff" : "#ffd0f4") };
    }
    default: {
      const body = phys({ color: white ? "#efe2c4" : "#1c1917", roughness: white ? 0.32 : 0.26, clearcoat: 0.55, clearcoatRoughness: 0.25 });
      return { body, accent: std({ color: white ? "#4a3a24" : "#9a8a72", roughness: 0.4 }) };
    }
  }
}
