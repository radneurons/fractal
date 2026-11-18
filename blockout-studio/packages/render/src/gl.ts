/** WebGL backend (three.js). `GLStage` mirrors the compiled drawable list into meshes and is shared by the
 *  editor viewport and the offscreen exporter; `GLPassRenderer` renders control passes frame-stepped. */
import * as THREE from 'three';
import { compileFrame, compileFrameShared, evalCamera, sunState, lightDir, terrainMesh, GROUND_ID, type CamState, type FrameScene, type Project, type Shot, type Terrain, type MeshKind } from '@blockout/core';
import { DEPTH_FAR, DEPTH_NEAR, flowMaxDisp, shotTime, type PassName, type PassRenderer } from './passes';
import { drawPose, poseKeypoints } from './soft';

const GEO: Record<MeshKind, () => THREE.BufferGeometry> = {
  box: () => new THREE.BoxGeometry(1, 1, 1), sphere: () => new THREE.SphereGeometry(0.5, 20, 14), cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
  cone: () => new THREE.CylinderGeometry(0.001, 0.5, 1, 14), plane: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
};
const geoCache: Partial<Record<MeshKind, THREE.BufferGeometry>> = {};
const geo = (k: MeshKind) => (geoCache[k] ??= GEO[k]());
const hexVec = (hex: string) => { const n = parseInt(hex.slice(1), 16); return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

const VERT = /* glsl */ `
uniform mat4 prevModel; uniform mat4 prevViewProj; varying vec3 vN; varying float vZ; varying vec4 vCur; varying vec4 vPrev; varying vec3 vColor;
#ifdef BATCH_PREV
attribute vec4 prevI0; attribute vec4 prevI1; attribute vec4 prevI2; attribute vec4 prevI3;
#endif
void main(){ vec4 lp = vec4(position,1.0); vec3 n = normal; vColor = vec3(1.0);
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp; n = mat3(instanceMatrix) * n;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
#endif
  vec4 mv = modelViewMatrix * lp; vN = normalize(normalMatrix * n); vZ = -mv.z; gl_Position = projectionMatrix * mv; vCur = gl_Position;
#ifdef BATCH_PREV
  vPrev = prevViewProj * mat4(prevI0, prevI1, prevI2, prevI3) * vec4(position, 1.0);
#else
  vPrev = prevViewProj * prevModel * lp;
#endif
}`;
const FRAG = /* glsl */ `
uniform int mode; uniform vec3 color; uniform float near; uniform float far; uniform vec2 res; uniform float maxDisp; varying vec3 vN; varying float vZ; varying vec4 vCur; varying vec4 vPrev; varying vec3 vColor;
void main(){
#ifdef BATCH_PREV
  if (mode == 0) gl_FragColor = vec4(vColor, 1.0);
#else
  if (mode == 0) gl_FragColor = vec4(color, 1.0);
#endif
  else if (mode == 1) { float v = clamp(1.0 - log(vZ / near) / log(far / near), 0.0, 1.0); gl_FragColor = vec4(vec3(v), 1.0); }
  else if (mode == 2) { float mm = min(16777215.0, floor(vZ * 1000.0 + 0.5)); gl_FragColor = vec4(floor(mm / 65536.0) / 255.0, floor(mod(mm, 65536.0) / 256.0) / 255.0, mod(mm, 256.0) / 255.0, 1.0); }
  else if (mode == 3) { vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }
  else { vec2 a = vCur.xy / vCur.w, b = vPrev.xy / vPrev.w; vec2 d = (a - b) * 0.5 * res; d.y = -d.y; gl_FragColor = vec4(0.5 + 0.498 * clamp(d / maxDisp, -1.0, 1.0), 0.502, 1.0); }
}`;
const MODES = { id: 0, fx: 0, depth: 1, depthMetric: 2, normals: 3, flow: 4 } as const;

export type StageLook = 'view' | PassName;
/** Imported models (GLB), normalised to fill the unit cube centred at the origin, i.e. exactly the proxy box they replace. */
export const modelRegistry = { map: new Map<string, THREE.Object3D>(), version: 0,
  register(id: string, obj: THREE.Object3D): { size: [number, number, number] } {
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3()), k = new THREE.Vector3(1 / Math.max(size.x, 1e-6), 1 / Math.max(size.y, 1e-6), 1 / Math.max(size.z, 1e-6));
    const wrap = new THREE.Group(); obj.position.sub(c); const inner = new THREE.Group(); inner.add(obj); inner.scale.copy(k); wrap.add(inner); wrap.updateMatrixWorld(true);
    this.map.set(id, wrap); this.version++; return { size: [size.x, size.y, size.z] };
  } };
export class GLStage {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>(); private inst = new Map<string, { mesh: THREE.InstancedMesh; src: unknown }>();
  private ground: THREE.Mesh | null = null; private groundSrc: Terrain | null = null;
  private clay = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 1, metalness: 0 });
  private clayGround = new THREE.MeshStandardMaterial({ color: 0x9d9d9d, roughness: 1, metalness: 0 });
  private tint = new Map<string, THREE.Material>(); private data = new Map<string, THREE.ShaderMaterial>();
  private black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  /** Batches: one InstancedMesh per mesh kind for all character parts and set pieces (draw-call count stays ~constant). */
  private batches = new Map<MeshKind, { mesh: THREE.InstancedMesh; cap: number; n: number; ids: Float32Array; tints: Float32Array; sel: Float32Array; white: Float32Array; entities: string[]; prev: THREE.InstancedInterleavedBuffer }>();
  private batchWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  look: StageLook = 'view'; uniforms = { near: DEPTH_NEAR, far: DEPTH_FAR, res: new THREE.Vector2(1, 1), maxDisp: 8, prevViewProj: new THREE.Matrix4() };
  selected: string | null = null;

  private dataMat(mode: number, idColor: string, batched = false): THREE.ShaderMaterial {
    const key = (mode === 0 ? `0:${batched ? 'batch' : idColor}` : `${mode}`) + (batched ? ':b' : ''); let m = this.data.get(key);
    if (!m) { m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, defines: batched ? { BATCH_PREV: 1 } : {}, uniforms: { mode: { value: mode }, color: { value: hexVec(idColor) }, near: { value: 0 }, far: { value: 0 }, res: { value: this.uniforms.res }, maxDisp: { value: 8 }, prevModel: { value: new THREE.Matrix4() }, prevViewProj: { value: this.uniforms.prevViewProj } } }); this.data.set(key, m); }
    m.uniforms.near.value = this.uniforms.near; m.uniforms.far.value = this.uniforms.far; m.uniforms.maxDisp.value = this.uniforms.maxDisp;
    return m;
  }
  private tintMat(idColor: string, fx: boolean, sel: boolean): THREE.Material {
    const key = `${idColor}${fx ? 'f' : ''}${sel ? 's' : ''}`; let m = this.tint.get(key);
    if (!m) { const c = new THREE.Color(idColor); m = fx ? new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, depthWrite: false }) : new THREE.MeshStandardMaterial({ color: new THREE.Color(0xd4d4d4).lerp(c, sel ? 0.75 : 0.42), roughness: 1, emissive: sel ? c.clone().multiplyScalar(0.25) : new THREE.Color(0) }); this.tint.set(key, m); }
    return m;
  }
  private materialFor(u: { idColor: string; layer: string; entityId: string }): THREE.Material | null {
    const fx = u.layer === 'fx', L = this.look;
    if (L === 'view') return u.layer === 'ground' ? this.clayGround : this.tintMat(u.idColor, fx, this.selected === u.entityId);
    if (L === 'fx') return fx ? this.dataMat(0, u.idColor) : this.black;
    if (fx) return null;
    if (L === 'clay' || L === 'pose' || L === 'canny') return u.layer === 'ground' ? this.clayGround : this.clay;
    return this.dataMat(MODES[L as keyof typeof MODES], u.idColor);
  }
  /** Colours for a batch under the current look (view tint / exact id colour / white for clay-like looks). */
  private batchLook(b: { mesh: THREE.InstancedMesh; n: number; ids: Float32Array; tints: Float32Array; sel: Float32Array; white: Float32Array; entities: string[] }) {
    const L = this.look, col = b.mesh.instanceColor!.array as Float32Array;
    if (L === 'view') { col.set(b.tints.subarray(0, b.n * 3)); if (this.selected) for (let i = 0; i < b.n; i++) if (b.entities[i] === this.selected) col.set(b.sel.subarray(i * 3, i * 3 + 3), i * 3); }
    else if (L === 'id') col.set(b.ids.subarray(0, b.n * 3)); else col.set(b.white.subarray(0, b.n * 3));
    b.mesh.instanceColor!.needsUpdate = true;
    const m: THREE.Material | null = L === 'view' || L === 'clay' || L === 'pose' || L === 'canny' ? this.batchWhite : L === 'fx' ? this.black : this.dataMat(MODES[L as keyof typeof MODES], '#000000', true);
    b.mesh.material = m;
  }
  private apply(mesh: THREE.Object3D) { if (mesh.userData.batch) { const b = this.batches.get(mesh.userData.batch); if (b) this.batchLook(b); return; } const m = this.materialFor(mesh.userData as never); mesh.visible = !!m; if (!m) return; if ((mesh as THREE.Mesh).isMesh) (mesh as THREE.Mesh).material = m; else mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = m; }); }
  setLook(look: StageLook, selected: string | null = null) { if (look === this.look && selected === this.selected) { for (const m of this.data.values()) { m.uniforms.near.value = this.uniforms.near; m.uniforms.far.value = this.uniforms.far; m.uniforms.maxDisp.value = this.uniforms.maxDisp; } return; } this.look = look; this.selected = selected; this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.apply(o as THREE.Mesh); }); }

  sync(scene: FrameScene, prev?: FrameScene) {
    const seen = new Set<string>(), prevM = prev ? new Map(prev.drawables.map((d) => [d.key, d.matrix])) : null, groups = new Map<MeshKind, typeof scene.drawables>();
    for (const d of scene.drawables) if (d.layer !== 'fx' && !d.assetId) { let g = groups.get(d.kind); if (!g) groups.set(d.kind, (g = [])); g.push(d); }
    for (const [kind, b] of this.batches) if (!groups.has(kind)) { b.n = 0; b.mesh.count = 0; }
    for (const [kind, list] of groups) this.syncBatch(kind, list, prevM);
    for (const d of scene.drawables) {
      if (d.layer !== 'fx' && !d.assetId) continue;
      seen.add(d.key); let mesh = this.meshes.get(d.key);
      const model = d.assetId ? modelRegistry.map.get(d.assetId) : undefined, mv = model ? modelRegistry.version : 0;
      if (!mesh || mesh.userData.kind !== d.kind || mesh.userData.idColor !== d.idColor || mesh.userData.modelVersion !== mv) {
        if (mesh) this.group.remove(mesh);
        if (model) { const g = model.clone(true) as unknown as THREE.Mesh; g.matrixAutoUpdate = false; g.userData = { kind: d.kind, idColor: d.idColor, layer: d.layer, entityId: d.entityId, prev: new THREE.Matrix4(), modelVersion: mv }; g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o !== g) o.userData = { ...o.userData, entityId: d.entityId }; }); this.apply(g); this.meshes.set(d.key, g); this.group.add(g); mesh = g; }
      }
      if (!mesh || mesh.userData.kind !== d.kind || mesh.userData.idColor !== d.idColor || mesh.userData.modelVersion !== mv) {
        if (mesh) this.group.remove(mesh);
        mesh = new THREE.Mesh(geo(d.kind)); mesh.matrixAutoUpdate = false; mesh.castShadow = d.layer !== 'fx'; mesh.receiveShadow = d.layer !== 'fx'; mesh.frustumCulled = false;
        mesh.userData = { kind: d.kind, idColor: d.idColor, layer: d.layer, entityId: d.entityId, prev: new THREE.Matrix4(), modelVersion: mv };
        mesh.onBeforeRender = (_r, _s, _c, _g, mat) => { const u = (mat as THREE.ShaderMaterial).uniforms; if (u?.prevModel) { u.prevModel.value = mesh!.userData.prev; (mat as THREE.ShaderMaterial).uniformsNeedUpdate = true; } };
        this.apply(mesh); this.meshes.set(d.key, mesh); this.group.add(mesh);
      }
      mesh.matrix.fromArray(d.matrix); mesh.matrixWorldNeedsUpdate = true;
      (mesh.userData.prev as THREE.Matrix4).fromArray(prevM?.get(d.key) ?? d.matrix);
    }
    for (const [k, m] of this.meshes) if (!seen.has(k)) { this.group.remove(m); this.meshes.delete(k); }
    const seenI = new Set<string>();
    for (const s of scene.instances) {
      seenI.add(s.key); const cur = this.inst.get(s.key); if (cur && cur.src === s.matrices) continue;
      if (cur) { this.group.remove(cur.mesh); cur.mesh.dispose(); }
      const im = new THREE.InstancedMesh(geo(s.kind), this.clay, s.matrices.length), m4 = new THREE.Matrix4();
      s.matrices.forEach((m, i) => im.setMatrixAt(i, m4.fromArray(m))); im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.castShadow = s.kind !== 'cone'; im.receiveShadow = true;
      im.userData = { idColor: s.idColor, layer: 'set', entityId: s.entityId, prev: new THREE.Matrix4() };
      im.onBeforeRender = (_r, _s, _c, _g, mat) => { const u = (mat as THREE.ShaderMaterial).uniforms; if (u?.prevModel) { u.prevModel.value = im.userData.prev; (mat as THREE.ShaderMaterial).uniformsNeedUpdate = true; } };
      this.apply(im); this.inst.set(s.key, { mesh: im, src: s.matrices }); this.group.add(im);
    }
    for (const [k, v] of this.inst) if (!seenI.has(k)) { this.group.remove(v.mesh); v.mesh.dispose(); this.inst.delete(k); }
    if (this.groundSrc !== scene.terrain) {
      if (this.ground) { this.group.remove(this.ground); this.ground.geometry.dispose(); }
      const tm = terrainMesh(scene.terrain), g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tm.pos, 3)); g.setIndex(tm.idx); g.computeVertexNormals();
      this.ground = new THREE.Mesh(g); this.ground.receiveShadow = true; this.ground.frustumCulled = false; this.ground.matrixAutoUpdate = false;
      this.ground.userData = { idColor: GROUND_ID, layer: 'ground', entityId: 'ground', prev: new THREE.Matrix4() };
      const gm = this.ground; gm.onBeforeRender = (_r, _s, _c, _g, mat) => { const u = (mat as THREE.ShaderMaterial).uniforms; if (u?.prevModel) { u.prevModel.value = gm.userData.prev; (mat as THREE.ShaderMaterial).uniformsNeedUpdate = true; } };
      this.apply(this.ground); this.group.add(this.ground); this.groundSrc = scene.terrain;
    }
  }
  private syncBatch(kind: MeshKind, list: FrameScene['drawables'], prevM: Map<string, number[]> | null) {
    let b = this.batches.get(kind); const n = list.length;
    if (!b || b.cap < n) {
      if (b) { this.group.remove(b.mesh); b.mesh.dispose(); }
      const cap = Math.max(64, 1 << Math.ceil(Math.log2(n))), mesh = new THREE.InstancedMesh(geo(kind), this.batchWhite, cap);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      const prev = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * 16), 16, 1); prev.setUsage(THREE.DynamicDrawUsage);
      const g = mesh.geometry = geo(kind).clone(); for (let c = 0; c < 4; c++) g.setAttribute(`prevI${c}`, new THREE.InterleavedBufferAttribute(prev, 4, c * 4));
      mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.userData = { batch: kind, layer: 'batch', entityIds: [] as string[] };
      b = { mesh, cap, n: 0, ids: new Float32Array(cap * 3), tints: new Float32Array(cap * 3), sel: new Float32Array(cap * 3), white: new Float32Array(cap * 3).fill(1), entities: [], prev };
      this.batches.set(kind, b); this.group.add(mesh);
    }
    const M = b.mesh.instanceMatrix.array as Float32Array, P = b.prev.array as Float32Array, tmp = new THREE.Color(), base = new THREE.Color(0xd4d4d4);
    for (let i = 0; i < n; i++) {
      const d = list[i]; M.set(d.matrix, i * 16); P.set(prevM?.get(d.key) ?? d.matrix, i * 16);
      if (b.entities[i] !== d.entityId || b.mesh.userData.colors?.[i] !== d.idColor) {
        const v = hexVec(d.idColor); b.ids[i * 3] = v.x; b.ids[i * 3 + 1] = v.y; b.ids[i * 3 + 2] = v.z; tmp.set(d.idColor);
        const t = base.clone().lerp(tmp, 0.42), sc = base.clone().lerp(tmp, 0.75).multiplyScalar(1.15);
        b.tints[i * 3] = t.r; b.tints[i * 3 + 1] = t.g; b.tints[i * 3 + 2] = t.b; b.sel[i * 3] = sc.r; b.sel[i * 3 + 1] = sc.g; b.sel[i * 3 + 2] = sc.b;
        b.entities[i] = d.entityId; (b.mesh.userData.colors ??= [])[i] = d.idColor;
      }
    }
    b.n = n; b.mesh.count = n; b.mesh.userData.entityIds = b.entities; b.mesh.instanceMatrix.needsUpdate = true; b.prev.needsUpdate = true;
    this.batchLook(b);
  }
  /** Entity id under a raycast hit (walks up userData; resolves instanced batches by instance id). */
  static entityAt(o: THREE.Object3D | null, instanceId?: number): string | null { if (o?.userData?.batch && instanceId !== undefined) return (o.userData.entityIds as string[])[instanceId] ?? null; return GLStage.entityOf(o); }
  static entityOf(o: THREE.Object3D | null): string | null { while (o) { if (o.userData?.entityId) return o.userData.entityId as string; o = o.parent; } return null; }
}

/** Lights derived from the project's lighting blockout; shared by viewport and exporter. */
export class LightRig {
  readonly group = new THREE.Group(); readonly sun = new THREE.DirectionalLight(); readonly hemi = new THREE.HemisphereLight(); private extra = [new THREE.DirectionalLight(), new THREE.DirectionalLight(), new THREE.DirectionalLight()];
  constructor(shadowSize = 2048) { this.sun.castShadow = true; this.sun.shadow.mapSize.set(shadowSize, shadowSize); this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.03; this.group.add(this.sun, this.sun.target, this.hemi, ...this.extra); }
  update(p: Project, focus: [number, number, number], radius = 22) {
    const L = p.lighting, s = sunState(L), sky = new THREE.Color(L.skyColor);
    this.sun.color.setRGB(s.color[0], s.color[1], s.color[2]); this.sun.intensity = 2.6 * s.intensity; this.sun.target.position.set(...focus); this.sun.position.set(focus[0] + s.dir[0] * 80, focus[1] + s.dir[1] * 80, focus[2] + s.dir[2] * 80);
    const c = this.sun.shadow.camera; c.left = c.bottom = -radius; c.right = c.top = radius; c.near = 1; c.far = 200; c.updateProjectionMatrix();
    this.hemi.color.copy(sky).lerp(new THREE.Color(0xffffff), 0.5); this.hemi.groundColor.set(0x6b6258); this.hemi.intensity = 2.4 * s.ambient;
    (['key', 'fill', 'rim'] as const).forEach((k, i) => { const l = L[k], d = lightDir(l.azimuth, l.elevation), e = this.extra[i]; e.visible = l.on; e.intensity = l.intensity * 2; e.color.set(l.color); e.position.set(focus[0] + d[0] * 50, focus[1] + d[1] * 50, focus[2] + d[2] * 50); });
    return sky;
  }
}
export function applyCamera(cam: THREE.PerspectiveCamera, cs: CamState) { cam.fov = (cs.fovY * 180) / Math.PI; cam.aspect = cs.aspect; cam.near = cs.near; cam.far = cs.far; cam.position.set(...cs.pos); cam.quaternion.set(...cs.quat); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); }

const QUAD_V = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const COPY_F = 'uniform sampler2D tex; varying vec2 vUv; void main(){ vec3 c = texture2D(tex, vUv).rgb; c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); gl_FragColor = vec4(c, 1.0); }';
const EDGE_F = `uniform sampler2D tn; uniform sampler2D td; uniform vec2 px; varying vec2 vUv;
float dz(vec2 o){ vec3 c = texture2D(td, vUv + o * px).rgb; return c.r * 65536.0 + c.g * 256.0 + c.b; }
void main(){ float e = 0.0; vec3 n = texture2D(tn, vUv).rgb * 2.0 - 1.0; float z = dz(vec2(0.0));
  for (int i = 0; i < 4; i++) { vec2 o = i == 0 ? vec2(1.,0.) : i == 1 ? vec2(0.,1.) : i == 2 ? vec2(-1.,0.) : vec2(0.,-1.); float z2 = dz(o); vec3 n2 = texture2D(tn, vUv + o * px).rgb * 2.0 - 1.0;
    if ((z == 0.0) != (z2 == 0.0)) e = 1.0; else if (z > 0.0 && abs(z - z2) / min(z, z2) > 0.06 && abs(n.y) < 0.92) e = 1.0; else if (z > 0.0 && dot(n, n2) < 0.8) e = 1.0; }
  gl_FragColor = vec4(vec3(e), 1.0); }`;

export class GLPassRenderer implements PassRenderer {
  readonly kind = 'webgl' as const; readonly info: string; readonly renderer: THREE.WebGLRenderer;
  readonly stage = new GLStage(); private scene = new THREE.Scene(); private lights = new LightRig(); private cam = new THREE.PerspectiveCamera();
  private rtClay: THREE.WebGLRenderTarget | null = null; private rtA: THREE.WebGLRenderTarget | null = null; private rtB: THREE.WebGLRenderTarget | null = null;
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); private quadScene = new THREE.Scene(); private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private copy = new THREE.ShaderMaterial({ vertexShader: QUAD_V, fragmentShader: COPY_F, uniforms: { tex: { value: null } }, depthTest: false });
  private edge = new THREE.ShaderMaterial({ vertexShader: QUAD_V, fragmentShader: EDGE_F, uniforms: { tn: { value: null }, td: { value: null }, px: { value: new THREE.Vector2() } }, depthTest: false });
  private last: { project: Project; t: number; scene: FrameScene } | null = null; private pose2d: HTMLCanvasElement | OffscreenCanvas | null = null;
  /** After render(): the canvas holding the frame (the GL canvas, or a 2D canvas for the pose pass). Feed to VideoFrame. */
  output: HTMLCanvasElement | OffscreenCanvas;
  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas as HTMLCanvasElement, antialias: false, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; this.renderer.setPixelRatio(1); this.renderer.toneMapping = THREE.NoToneMapping;
    this.scene.add(this.stage.group, this.lights.group); this.quadScene.add(this.quad); this.output = canvas;
    const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    this.info = `three r${THREE.REVISION} / ${ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`;
  }
  private targets(w: number, h: number) {
    if (this.rtClay?.width === w && this.rtClay.height === h) return;
    this.rtClay?.dispose(); this.rtA?.dispose(); this.rtB?.dispose();
    this.rtClay = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType });
    this.rtA = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }); this.rtB = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.renderer.setSize(w, h, false);
  }
  private sceneAt(p: Project, t: number): FrameScene { if (this.last && this.last.project === p && this.last.t === t) return this.last.scene; const scene = compileFrameShared(p, t); this.last = { project: p, t, scene }; return scene; }
  /** Render one pass at scene time t onto `output`. `prev` enables optical flow. */
  renderAt(p: Project, t: number, cs: CamState, pass: PassName, w: number, h: number, prev?: { t: number; cam: CamState }): void {
    const scene = this.sceneAt(p, t), r = this.renderer;
    if (pass === 'pose') {
      const px = drawPose(poseKeypoints(p, scene, cs, w, h), w, h);
      if (!this.pose2d || this.pose2d.width !== w || this.pose2d.height !== h) this.pose2d = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      (this.pose2d.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0); this.output = this.pose2d; return;
    }
    this.output = this.canvas; this.targets(w, h);
    const st = this.stage; st.uniforms.res.set(w, h); st.uniforms.maxDisp = flowMaxDisp(w);
    applyCamera(this.cam, cs);
    if (pass === 'flow') { const pc = new THREE.PerspectiveCamera(); applyCamera(pc, prev?.cam ?? cs); st.uniforms.prevViewProj.multiplyMatrices(pc.projectionMatrix, pc.matrixWorldInverse); st.sync(scene, prev ? compileFrame(p, prev.t) : scene); } else st.sync(scene);
    const sky = this.lights.update(p, cs.target as [number, number, number], Math.min(60, Math.max(12, Math.hypot(cs.pos[0] - cs.target[0], cs.pos[1] - cs.target[1], cs.pos[2] - cs.target[2]) * 1.5)));
    const draw = (look: PassName, target: THREE.WebGLRenderTarget | null, bg: THREE.Color) => { st.setLook(look); this.scene.background = bg; r.setRenderTarget(target); r.render(this.scene, this.cam); };
    if (pass === 'clay') { draw('clay', this.rtClay, sky); this.copy.uniforms.tex.value = this.rtClay!.texture; this.quad.material = this.copy; r.setRenderTarget(null); r.render(this.quadScene, this.quadCam); }
    else if (pass === 'canny') { draw('normals', this.rtA, new THREE.Color(0.5, 0.5, 1)); draw('depthMetric', this.rtB, new THREE.Color(0, 0, 0)); this.edge.uniforms.tn.value = this.rtA!.texture; this.edge.uniforms.td.value = this.rtB!.texture; this.edge.uniforms.px.value.set(1 / w, 1 / h); this.quad.material = this.edge; r.setRenderTarget(null); r.render(this.quadScene, this.quadCam); }
    else draw(pass, null, pass === 'normals' ? new THREE.Color(0.5, 0.5, 1) : pass === 'flow' ? new THREE.Color(0.5, 0.5, 0) : new THREE.Color(0, 0, 0));
    r.setRenderTarget(null);
  }
  readPixels(w: number, h: number): Uint8ClampedArray {
    if (this.output !== this.canvas) return (this.output.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, w, h).data;
    const gl = this.renderer.getContext(), buf = new Uint8Array(w * h * 4), out = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return out;
  }
  renderShotFrame(p: Project, shot: Shot, frame: number, pass: PassName, w: number, h: number): void {
    const c = p.cameras[shot.cameraId], t = shotTime(p, shot, frame), tp = shotTime(p, shot, Math.max(0, frame - 1));
    this.renderAt(p, t, evalCamera(p, c, t), pass, w, h, { t: tp, cam: evalCamera(p, c, tp) });
  }
  render(p: Project, shot: Shot, frame: number, pass: PassName, w: number, h: number): Uint8ClampedArray { this.renderShotFrame(p, shot, frame, pass, w, h); return this.readPixels(w, h); }
  dispose() { this.renderer.dispose(); this.rtClay?.dispose(); this.rtA?.dispose(); this.rtB?.dispose(); }
}
