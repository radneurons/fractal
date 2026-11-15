// The 3D board renderer: scene, pieces, overlays, camera work and post-processing.
// Chess rules never live here — the stage only shows positions and reports which square was hit.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Graphics } from "../../store";
import { holoUniforms, PIECE_SETS_3D, pieceGeometry, PieceKind, pieceMaterials } from "./pieces3d";
import { buildTheme, ThemeBuild, ThemeId } from "./themes3d";

const FILES = "abcdefgh";
export type Arrow3D = { from: string; to: string; color?: string; width?: number; opacity?: number };
export type CameraPreset = "player" | "top" | "broadcast" | "cinematic" | "intro";

export const sqToWorld = (sq: string): THREE.Vector3 => new THREE.Vector3(FILES.indexOf(sq[0]) - 3.5, 0, 3.5 - (parseInt(sq[1], 10) - 1));
export function worldToSq(p: THREE.Vector3): string | null {
  const f = Math.floor(p.x + 4), r = Math.floor(4 - p.z);
  return f < 0 || f > 7 || r < 0 || r > 7 ? null : FILES[f] + (r + 1);
}

type PieceObj = { id: number; sq: string; sym: string; group: THREE.Group; from?: THREE.Vector3; to?: THREE.Vector3; t?: number; dying?: boolean };

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  controls: OrbitControls;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private bokeh: BokehPass | null = null;
  private theme: ThemeBuild | null = null;
  private themeId: ThemeId = "library";
  private pieceSet = "staunton";
  private gfx: Graphics;
  private boardGroup = new THREE.Group();
  private squaresMesh: THREE.Mesh[] = [];
  private pieceLayer = new THREE.Group();
  private overlay = new THREE.Group();
  private pieces: PieceObj[] = [];
  private nextId = 1;
  private raf = 0;
  private clock = new THREE.Clock();
  private dirty = true;
  private disposed = false;
  private env: THREE.Texture | null = null;
  private orientation: "white" | "black" = "white";
  private camGoal: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private preset: CameraPreset = "player";
  private dragging: PieceObj | null = null;
  private ro: ResizeObserver;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private introT = 0;
  onFrame: (() => void) | null = null;

  constructor(private container: HTMLElement, gfx: Graphics) {
    this.gfx = gfx;
    this.renderer = new THREE.WebGLRenderer({ antialias: gfx.antialias, alpha: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = gfx.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5; this.controls.maxDistance = 30; this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.enablePan = false;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null as unknown as THREE.MOUSE };
    this.controls.addEventListener("change", () => { this.dirty = true; });
    this.controls.addEventListener("start", () => { this.camGoal = null; if (this.preset === "cinematic") this.preset = "player"; });
    this.scene.add(this.boardGroup, this.pieceLayer, this.overlay);
    this.buildBoard();
    if (gfx.reflections) {
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = this.env;
      pm.dispose();
    }
    this.setTheme("library");
    this.setCamera("player", true);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.loop();
  }

  // ---------------------------------------------------------------- board
  private buildBoard() {
    const sq = new THREE.BoxGeometry(1, 0.12, 1);
    for (let i = 0; i < 64; i++) {
      const f = i % 8, r = Math.floor(i / 8);
      const m = new THREE.Mesh(sq);
      m.position.set(f - 3.5, -0.06, 3.5 - r);
      m.receiveShadow = true;
      m.userData.light = (f + r) % 2 === 1;
      this.squaresMesh.push(m);
      this.boardGroup.add(m);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.3, 9.1));
    frame.position.y = -0.2; frame.receiveShadow = true; frame.castShadow = true; frame.name = "frame";
    this.boardGroup.add(frame);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(8.24, 0.02, 8.24), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.35 }));
    lip.position.y = -0.045; lip.name = "lip";
    this.boardGroup.add(lip);
  }

  private coordSprites: THREE.Sprite[] = [];
  private buildCoords(color: string) {
    this.coordSprites.forEach((s) => { this.boardGroup.remove(s); (s.material as THREE.SpriteMaterial).map?.dispose(); s.material.dispose(); });
    this.coordSprites = [];
    const mk = (txt: string) => {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const x = c.getContext("2d")!; x.fillStyle = color; x.font = "600 40px Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(txt, 32, 34);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.85, depthWrite: false }));
      s.scale.setScalar(0.34);
      return s;
    };
    for (let i = 0; i < 8; i++) {
      for (const z of [4.33, -4.33]) { const s = mk(FILES[i]); s.position.set(i - 3.5, -0.03, z); this.coordSprites.push(s); this.boardGroup.add(s); }
      for (const x of [-4.33, 4.33]) { const s = mk(String(i + 1)); s.position.set(x, -0.03, 3.5 - i); this.coordSprites.push(s); this.boardGroup.add(s); }
    }
  }

  setTheme(id: ThemeId) {
    if (this.theme) { this.scene.remove(this.theme.group); disposeTree(this.theme.group); }
    this.themeId = id;
    const quality = this.gfx.quality;
    const t = buildTheme(id, { shadows: this.gfx.shadows, mapSize: quality === "ultra" ? 4096 : quality === "cinematic" ? 2048 : 1024 });
    this.theme = t;
    this.scene.add(t.group);
    this.scene.background = t.background;
    this.scene.fog = t.fog ?? null;
    this.scene.environmentIntensity = this.gfx.reflections ? t.envIntensity : 0;
    this.renderer.toneMappingExposure = t.exposure;
    this.squaresMesh.forEach((m) => { m.material = m.userData.light ? t.light : t.dark; });
    (this.boardGroup.getObjectByName("frame") as THREE.Mesh).material = t.frame;
    this.buildCoords(t.coordColor);
    if (this.bloom) this.bloom.strength = t.bloom;
    this.rebuildPieces();
    this.dirty = true;
  }

  setPieceSet(set: string) { if (set !== this.pieceSet) { this.pieceSet = set; this.rebuildPieces(); } }

  setGraphics(g: Graphics) {
    const needRebuild = g.antialias !== this.gfx.antialias;
    this.gfx = g;
    this.renderer.shadowMap.enabled = g.shadows;
    if (this.theme) { this.theme.key.castShadow = g.shadows; this.scene.environmentIntensity = g.reflections ? this.theme.envIntensity : 0; }
    this.scene.environment = g.reflections ? this.env : null;
    this.buildComposer();
    this.resize();
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    this.dirty = true;
    return needRebuild;       // antialiasing can only change by recreating the WebGL context
  }

  private buildComposer() {
    this.composer?.dispose();
    this.composer = null; this.bloom = null; this.bokeh = null;
    const g = this.gfx;
    if (!g.bloom && !g.ao && !g.dof) return;
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (g.ao) { const ao = new SSAOPass(this.scene, this.camera, w, h); ao.kernelRadius = 0.6; ao.minDistance = 0.002; ao.maxDistance = 0.08; c.addPass(ao); }
    if (g.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), this.theme?.bloom ?? 0.3, 0.6, 0.82); c.addPass(this.bloom); }
    if (g.dof) { this.bokeh = new BokehPass(this.scene, this.camera, { focus: 12, aperture: 0.00012, maxblur: 0.006 }); c.addPass(this.bokeh); }
    c.addPass(new OutputPass());
    this.composer = c;
  }

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const pr = Math.min(window.devicePixelRatio || 1, 2) * Math.min(this.gfx.resolution, 2);
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(pr, 3)));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the whole board in view on narrow (portrait / phone) canvases
    this.camera.fov = w / h < 1 ? 38 + (1 - w / h) * 34 : 38;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.dirty = true;
  }

  // ---------------------------------------------------------------- pieces
  private makePiece(sym: string): THREE.Group {
    const white = sym === sym.toUpperCase();
    const set = PIECE_SETS_3D.find((s) => s.id === this.pieceSet) || PIECE_SETS_3D[0];
    const detail = this.gfx.quality === "performance" ? 20 : this.gfx.quality === "balanced" ? 36 : 56;
    const geo = pieceGeometry(sym.toLowerCase() as PieceKind, set.family, detail);
    const mats = pieceMaterials(set.id, white);
    const g = new THREE.Group();
    const body = new THREE.Mesh(geo.body, mats.body);
    body.castShadow = set.id !== "holo"; body.receiveShadow = set.id !== "holo";
    g.add(body);
    if (geo.accent) { const a = new THREE.Mesh(geo.accent, mats.accent); a.castShadow = set.id !== "holo"; g.add(a); }
    // Knights face the opponent, turned about 50° so their profile reads clearly from either player's seat.
    if (sym.toLowerCase() === "n") g.rotation.y = (white ? 0 : Math.PI) + 0.87;
    g.userData.height = geo.height;
    return g;
  }

  private rebuildPieces() {
    const snapshot = this.pieces.filter((p) => !p.dying).map((p) => ({ sq: p.sq, sym: p.sym }));
    this.pieces.forEach((p) => this.pieceLayer.remove(p.group));
    this.pieces = [];
    for (const s of snapshot) this.addPiece(s.sq, s.sym);
    this.dirty = true;
  }

  private addPiece(sq: string, sym: string): PieceObj {
    const group = this.makePiece(sym);
    group.position.copy(sqToWorld(sq));
    this.pieceLayer.add(group);
    const p: PieceObj = { id: this.nextId++, sq, sym, group };
    this.pieces.push(p);
    return p;
  }

  /** Move to a new placement, animating the pieces that changed square. */
  setPosition(placement: Record<string, string>, animate = true) {
    const anim = animate && this.gfx.animation !== "off";
    const live = this.pieces.filter((p) => !p.dying);
    const used = new Set<PieceObj>();
    const pending: [string, string][] = [];
    for (const [sq, sym] of Object.entries(placement)) {
      const same = live.find((p) => !used.has(p) && p.sq === sq && p.sym === sym);
      if (same) used.add(same); else pending.push([sq, sym]);
    }
    const dist = (a: string, b: string) => Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(+a[1] - +b[1]);
    for (const [sq, sym] of pending) {
      let best: PieceObj | null = null, bd = 99;
      for (const p of live) {
        if (used.has(p)) continue;
        const promo = p.sym.toLowerCase() === "p" && (p.sym === p.sym.toUpperCase()) === (sym === sym.toUpperCase()) && (sq[1] === "8" || sq[1] === "1");
        if ((p.sym === sym || promo) && dist(p.sq, sq) < bd) { bd = dist(p.sq, sq); best = p; }
      }
      if (best) {
        used.add(best);
        if (best.sym !== sym) {                     // promotion: swap the model, keep the motion
          this.pieceLayer.remove(best.group);
          const pos = best.group.position.clone();
          best.group = this.makePiece(sym); best.group.position.copy(pos); best.sym = sym;
          this.pieceLayer.add(best.group);
        }
        best.sq = sq;
        if (anim) { best.from = best.group.position.clone(); best.to = sqToWorld(sq); best.t = 0; } else best.group.position.copy(sqToWorld(sq));
      } else {
        const p = this.addPiece(sq, sym);
        used.add(p);
        if (anim) { p.group.scale.setScalar(0.01); p.t = -1; }
      }
    }
    for (const p of live) if (!used.has(p)) { if (anim) { p.dying = true; p.t = 0; } else { this.pieceLayer.remove(p.group); this.pieces = this.pieces.filter((x) => x !== p); } }
    this.dirty = true;
  }

  // ---------------------------------------------------------------- overlays
  setOverlays(o: { lastMove?: string | null; selected?: string | null; dests?: { to: string; capture: boolean }[]; check?: string | null;
    squares?: Record<string, string>; arrows?: Arrow3D[]; leds?: Record<string, number | string>; thickness?: number; opacity?: number }) {
    disposeTree(this.overlay);
    this.overlay.clear();
    const plate = (sq: string, color: string, opacity: number, size = 0.98, y = 0.006) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.copy(sqToWorld(sq)); m.position.y = y; m.renderOrder = 2;
      this.overlay.add(m);
    };
    if (o.lastMove) { plate(o.lastMove.slice(0, 2), "#e9d34a", 0.42); plate(o.lastMove.slice(2, 4), "#e9d34a", 0.42); }
    if (o.check) plate(o.check, "#ff3b2f", 0.6);
    for (const [sq, c] of Object.entries(o.squares || {})) plate(sq, c, 0.5, 0.94, 0.008);
    if (o.selected) plate(o.selected, "#2fa37c", 0.55);
    for (const d of o.dests || []) {
      const geo = d.capture ? new THREE.RingGeometry(0.36, 0.45, 40) : new THREE.CircleGeometry(0.15, 28);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: d.capture ? "#ff7a5c" : "#2fa37c", transparent: true, opacity: 0.8, depthWrite: false, depthTest: !d.capture }));
      m.rotation.x = -Math.PI / 2; m.position.copy(sqToWorld(d.to)); m.position.y = d.capture ? 0.012 : 0.01; m.renderOrder = 3;
      this.overlay.add(m);
    }
    const ledCol: Record<string, string> = { "1": "#ff4b3e", "2": "#35e06f", "3": "#4aa3ff", red: "#ff4b3e", green: "#35e06f", blue: "#4aa3ff" };
    for (const [sq, v] of Object.entries(o.leds || {})) {
      const c = ledCol[String(v)] || "#fff3c4";
      const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.68, 4, 1), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 4; m.position.copy(sqToWorld(sq)); m.position.y = 0.014; m.renderOrder = 4;
      this.overlay.add(m);
    }
    for (const a of o.arrows || []) this.overlay.add(this.arrowMesh(a, o.thickness ?? 1, o.opacity ?? 0.85));
    this.dirty = true;
  }

  private arrowMesh(a: Arrow3D, thickness: number, opacity: number): THREE.Mesh {
    const from = sqToWorld(a.from), to = sqToWorld(a.to);
    const dir = to.clone().sub(from); const len = dir.length() || 1;
    const w = 0.11 * (a.width ?? 1) * thickness, head = 0.3 * Math.min(1.4, (a.width ?? 1) * thickness + 0.3);
    const start = 0.22, end = len - 0.12;
    const s = new THREE.Shape();
    s.moveTo(start, -w); s.lineTo(end - head, -w); s.lineTo(end - head, -head * 0.75); s.lineTo(end, 0);
    s.lineTo(end - head, head * 0.75); s.lineTo(end - head, w); s.lineTo(start, w); s.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color: a.color || "#2fa37c", transparent: true, opacity: a.opacity ?? opacity, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(-dir.z, dir.x);
    m.position.set(from.x, 0.02, from.z);
    m.renderOrder = 5;
    return m;
  }

  // ---------------------------------------------------------------- camera
  setOrientation(o: "white" | "black", instant = false) {
    if (o === this.orientation && !instant) return;
    this.orientation = o;
    this.setCamera(this.preset === "intro" ? "player" : this.preset, instant);
  }

  setCamera(preset: CameraPreset, instant = false) {
    this.preset = preset;
    const s = this.orientation === "white" ? 1 : -1;
    const goals: Record<CameraPreset, [THREE.Vector3, THREE.Vector3]> = {
      player: [new THREE.Vector3(0, 10.4, 10.2 * s), new THREE.Vector3(0, -0.3, 0.35 * s)],
      top: [new THREE.Vector3(0, 15.5, 0.02 * s), new THREE.Vector3(0, 0, 0)],
      broadcast: [new THREE.Vector3(8.5 * s, 8.2, 8.8 * s), new THREE.Vector3(0, 0, 0)],
      cinematic: [new THREE.Vector3(9.5, 5.2, 9.5 * s), new THREE.Vector3(0, 0.5, 0)],
      intro: [new THREE.Vector3(0, 6.4, 13.5), new THREE.Vector3(0, 0.4, 0)],
    };
    const [pos, target] = goals[preset];
    if (preset === "intro") { this.camera.position.set(22, 17, 32); this.controls.target.set(0, 2, 0); this.introT = 0; }
    if (instant && preset !== "intro") { this.camera.position.copy(pos); this.controls.target.copy(target); this.camGoal = null; this.controls.update(); }
    else this.camGoal = { pos, target };
    this.dirty = true;
  }

  /** Piece inspection: glide the camera to one piece. */
  inspect(sq: string | null) {
    if (!sq) { this.setCamera("player"); return; }
    const p = sqToWorld(sq); const s = this.orientation === "white" ? 1 : -1;
    this.camGoal = { pos: new THREE.Vector3(p.x + 1.6, 2.3, p.z + 3.0 * s), target: new THREE.Vector3(p.x, 0.55, p.z) };
    this.controls.minDistance = 2;
  }

  // ---------------------------------------------------------------- picking / dragging
  pick(clientX: number, clientY: number): { sq: string | null; point: THREE.Vector3 | null } {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // prefer the piece under the cursor (tall pieces hide the squares behind them)
    const hits = this.raycaster.intersectObjects(this.pieces.filter((p) => !p.dying).map((p) => p.group), true);
    if (hits.length) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && o.parent !== this.pieceLayer) o = o.parent;
      const piece = this.pieces.find((p) => p.group === o);
      if (piece) return { sq: piece.sq, point: sqToWorld(piece.sq) };
    }
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, pt)) return { sq: null, point: null };
    return { sq: worldToSq(pt), point: pt };
  }
  private planePoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.plane, pt) ? pt : null;
  }
  squareUnder(clientX: number, clientY: number): string | null { const p = this.planePoint(clientX, clientY); return p ? worldToSq(p) : null; }

  beginDrag(sq: string) {
    const p = this.pieces.find((x) => x.sq === sq && !x.dying);
    if (!p) return;
    this.dragging = p; this.controls.enabled = false; p.t = undefined;
  }
  dragTo(clientX: number, clientY: number) {
    if (!this.dragging) return;
    const pt = this.planePoint(clientX, clientY);
    if (pt) { this.dragging.group.position.set(THREE.MathUtils.clamp(pt.x, -4.3, 4.3), 0.45, THREE.MathUtils.clamp(pt.z, -4.3, 4.3)); this.dirty = true; }
  }
  endDrag(snapBack: boolean) {
    const p = this.dragging;
    this.dragging = null; this.controls.enabled = true;
    if (p && snapBack) { p.from = p.group.position.clone(); p.to = sqToWorld(p.sq); p.t = 0; this.dirty = true; }
    else if (p) p.group.position.y = 0;
  }

  // ---------------------------------------------------------------- loop
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    let active = false;
    for (const p of [...this.pieces]) {
      if (p.dying) {
        p.t = (p.t ?? 0) + dt * 4.5;
        p.group.scale.setScalar(Math.max(0.001, 1 - p.t)); p.group.position.y = -p.t * 0.25;
        if (p.t >= 1) { this.pieceLayer.remove(p.group); this.pieces = this.pieces.filter((x) => x !== p); }
        active = true;
      } else if (p.t !== undefined && p.t < 0) {           // appearing
        const s = Math.min(1, p.group.scale.x + dt * 5); p.group.scale.setScalar(s);
        if (s >= 1) p.t = undefined;
        active = true;
      } else if (p.t !== undefined && p.from && p.to) {
        p.t = Math.min(1, p.t + dt * (this.gfx.animation === "reduced" ? 7 : 3.6));
        const e = p.t < 0.5 ? 2 * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 2) / 2;
        p.group.position.lerpVectors(p.from, p.to, e);
        const hop = p.sym.toLowerCase() === "n" ? 0.75 : 0.22;
        p.group.position.y += Math.sin(Math.PI * e) * hop * (this.gfx.animation === "reduced" ? 0.3 : 1);
        if (p.t >= 1) { p.group.position.copy(p.to); p.t = undefined; p.from = p.to = undefined; }
        active = true;
      }
    }
    if (this.preset === "intro") {
      this.introT = Math.min(1, this.introT + dt / 5.2);
      active = true;
    }
    if (this.camGoal) {
      const k = this.preset === "intro" ? 1 - Math.pow(1 - this.introT, 2) * 0.985 - 0.015 * (1 - this.introT) : 1 - Math.exp(-dt * 4.2);
      const rate = this.preset === "intro" ? Math.min(1, dt * (0.35 + this.introT * 1.4)) : k;
      this.camera.position.lerp(this.camGoal.pos, rate);
      this.controls.target.lerp(this.camGoal.target, rate);
      if (this.preset !== "intro" && this.camera.position.distanceTo(this.camGoal.pos) < 0.02) this.camGoal = null;
      active = true;
    }
    if (this.preset === "cinematic" && !this.camGoal && this.gfx.animation === "full") {
      const a = t * 0.07; const r = 13.4;
      this.camera.position.set(Math.sin(a) * r, 5.4 + Math.sin(t * 0.13) * 0.6, Math.cos(a) * r);
      active = true;
    }
    const themed = !!this.theme?.animated && this.gfx.animation === "full";
    if (themed) { this.theme!.update?.(t); holoUniforms.uTime.value = t; }
    if (this.pieceSet === "holo" && this.gfx.animation === "full") { holoUniforms.uTime.value = t; active = true; }
    if (this.controls.update()) active = true;
    if (active || themed || this.dirty) {
      this.dirty = false;
      if (this.bokeh) (this.bokeh.uniforms as any).focus.value = this.camera.position.distanceTo(this.controls.target);
      if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
      this.onFrame?.();
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.composer?.dispose();
    disposeTree(this.scene);
    this.env?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    // piece geometries/materials and procedural textures are cached and shared: only dispose one-off overlay/theme geometry
    if (m.geometry && !(m.geometry as any).__shared) m.geometry.dispose?.();
  });
}
