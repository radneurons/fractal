// Knowledge Universe renderer. Geometry is generated from the curriculum skill graph; colours come from skill states.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface UNode {
  id: string;
  label: string;
  group: string;
  groupLabel: string;
  hue: number;
  color: string; // css colour for state
  size: number;
}
export interface UEdge {
  from: string;
  to: string;
}
export interface UniverseOptions {
  nodes: UNode[];
  edges: UEdge[];
  highlight?: string[];
  autoRotate?: boolean;
  reducedMotion?: boolean;
  interactive?: boolean;
  onHover?: (id: string | null, x: number, y: number) => void;
  onSelect?: (id: string) => void;
  labels?: HTMLElement | null;
  cameraDistance?: number;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fib(i: number, n: number, r: number) {
  const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
  const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
  return new THREE.Vector3(r * Math.cos(theta) * Math.sin(phi), r * Math.cos(phi) * 0.72, r * Math.sin(theta) * Math.sin(phi));
}

export function layout(nodes: UNode[]): Map<string, THREE.Vector3> {
  const groups = [...new Set(nodes.map((n) => n.group))];
  const centers = new Map(groups.map((g, i) => [g, fib(i, groups.length, 46)]));
  const pos = new Map<string, THREE.Vector3>();
  for (const g of groups) {
    const members = nodes.filter((n) => n.group === g);
    const c = centers.get(g)!;
    members.forEach((m, i) => {
      const r = seeded(m.id);
      const local = fib(i, Math.max(members.length, 2), 3.6 + members.length * 0.22);
      pos.set(m.id, c.clone().add(local).add(new THREE.Vector3((r() - 0.5) * 1.2, (r() - 0.5) * 1.2, (r() - 0.5) * 1.2)));
    });
  }
  return pos;
}

export function createUniverse(container: HTMLElement, opts: UniverseOptions) {
  const width = () => container.clientWidth || 800;
  const height = () => container.clientHeight || 600;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width(), height());
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070b12, 0.006);
  const camera = new THREE.PerspectiveCamera(50, width() / height(), 0.1, 1200);
  const dist = opts.cameraDistance ?? 118;
  camera.position.set(0, dist * 0.32, dist);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !opts.reducedMotion;
  controls.dampingFactor = 0.08;
  controls.minDistance = 12;
  controls.maxDistance = 220;
  controls.autoRotate = !!opts.autoRotate && !opts.reducedMotion;
  controls.autoRotateSpeed = 0.35;
  controls.enabled = opts.interactive !== false;
  controls.enablePan = opts.interactive !== false;

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.PointLight(0x9fffe6, 120, 0, 1.6);
  key.position.set(20, 40, 30);
  scene.add(key);
  const rim = new THREE.PointLight(0xffc27a, 80, 0, 1.6);
  rim.position.set(-40, -10, -30);
  scene.add(rim);

  // Starfield (static, decorative depth only)
  const starGeo = new THREE.BufferGeometry();
  const sr = seeded('stars');
  const starPos = new Float32Array(1800 * 3);
  for (let i = 0; i < 1800; i++) {
    const v = new THREE.Vector3(sr() - 0.5, sr() - 0.5, sr() - 0.5).normalize().multiplyScalar(260 + sr() * 300);
    starPos.set([v.x, v.y, v.z], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8aa0c0, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(stars);

  const positions = layout(opts.nodes);
  const idx = new Map(opts.nodes.map((n, i) => [n.id, i]));

  // Nodes: instanced spheres + additive glow points
  const sphere = new THREE.IcosahedronGeometry(1, 3);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.25, emissive: 0x111111, emissiveIntensity: 0.6 });
  const mesh = new THREE.InstancedMesh(sphere, mat, opts.nodes.length);
  const dummy = new THREE.Object3D();
  const glowGeo = new THREE.BufferGeometry();
  const glowPos = new Float32Array(opts.nodes.length * 3);
  const glowCol = new Float32Array(opts.nodes.length * 3);
  const col = new THREE.Color();
  const baseScale: number[] = [];
  opts.nodes.forEach((n, i) => {
    const p = positions.get(n.id)!;
    const s = n.size;
    baseScale[i] = s;
    dummy.position.copy(p);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    col.set(n.color);
    mesh.setColorAt(i, col);
    glowPos.set([p.x, p.y, p.z], i * 3);
    glowCol.set([col.r, col.g, col.b], i * 3);
  });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  glowGeo.setAttribute('color', new THREE.BufferAttribute(glowCol, 3));
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ size: 6.5, map: glowTex, vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(glow);

  // Edges: prerequisite relationships
  const edgeGeo = new THREE.BufferGeometry();
  const ePos: number[] = [];
  const eCol: number[] = [];
  const hl = new Set(opts.highlight ?? []);
  for (const e of opts.edges) {
    const a = positions.get(e.from);
    const b = positions.get(e.to);
    if (!a || !b) continue;
    ePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const onPath = hl.has(e.from) && hl.has(e.to);
    const sameGroup = opts.nodes[idx.get(e.from)!]?.group === opts.nodes[idx.get(e.to)!]?.group;
    const c = onPath ? new THREE.Color(0x5fe3c0) : sameGroup ? new THREE.Color(0x3a5680) : new THREE.Color(0x1d2b42);
    eCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(ePos, 3));
  edgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(eCol, 3));
  const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }));
  scene.add(edges);

  // Group labels as HTML overlay
  const groups = [...new Set(opts.nodes.map((n) => n.group))];
  const groupCenters = groups.map((g) => {
    const ms = opts.nodes.filter((n) => n.group === g).map((n) => positions.get(n.id)!);
    const c = ms.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / ms.length);
    return { g, c, label: opts.nodes.find((n) => n.group === g)!.groupLabel };
  });
  const labelEls: HTMLDivElement[] = [];
  if (opts.labels) {
    opts.labels.innerHTML = '';
    for (const gc of groupCenters) {
      const d = document.createElement('div');
      d.textContent = gc.label;
      d.style.cssText = 'position:absolute;left:0;top:0;font:600 11px Inter,system-ui;letter-spacing:.08em;text-transform:uppercase;color:var(--text-2);white-space:nowrap;pointer-events:none;text-shadow:0 1px 6px var(--bg);will-change:transform;';
      opts.labels.appendChild(d);
      labelEls.push(d);
    }
  }

  // Interaction
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hovered: number | null = null;
  let downAt = { x: 0, y: 0 };
  const pick = (ev: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObject(mesh)[0];
    return hit?.instanceId ?? null;
  };
  const onMove = (ev: PointerEvent) => {
    if (!opts.onHover) return;
    const id = pick(ev);
    if (id !== hovered) {
      hovered = id;
      renderer.domElement.style.cursor = id === null ? 'grab' : 'pointer';
    }
    const r = renderer.domElement.getBoundingClientRect();
    opts.onHover(id === null ? null : opts.nodes[id].id, ev.clientX - r.left, ev.clientY - r.top);
  };
  const onDown = (ev: PointerEvent) => (downAt = { x: ev.clientX, y: ev.clientY });
  const onUp = (ev: PointerEvent) => {
    if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 5) return;
    const id = pick(ev);
    if (id !== null) opts.onSelect?.(opts.nodes[id].id);
  };
  if (opts.interactive !== false) {
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
  }

  // Camera fly-to
  let flyTarget: THREE.Vector3 | null = null;
  let flyPos: THREE.Vector3 | null = null;
  controls.addEventListener('start', () => {
    flyTarget = null;
    flyPos = null;
  });
  let selected: number | null = null;
  const focus = (id: string | null) => {
    selected = id ? idx.get(id) ?? null : null;
    if (!id) {
      flyTarget = new THREE.Vector3();
      flyPos = new THREE.Vector3(0, dist * 0.32, dist);
    } else {
      const p = positions.get(id);
      if (!p) return;
      flyTarget = p.clone();
      const dir = camera.position.clone().sub(controls.target).normalize();
      flyPos = p.clone().add(dir.multiplyScalar(26));
    }
    if (opts.reducedMotion && flyTarget && flyPos) {
      controls.target.copy(flyTarget);
      camera.position.copy(flyPos);
      flyTarget = flyPos = null;
    }
  };

  const setColors = (colors: Record<string, string>) => {
    opts.nodes.forEach((n, i) => {
      const c = colors[n.id];
      if (!c) return;
      col.set(c);
      mesh.setColorAt(i, col);
      glowCol.set([col.r, col.g, col.b], i * 3);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    glowGeo.attributes.color.needsUpdate = true;
  };

  const v = new THREE.Vector3();
  let raf = 0;
  let t = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    t += 0.016;
    if (flyTarget && flyPos) {
      controls.target.lerp(flyTarget, 0.08);
      camera.position.lerp(flyPos, 0.08);
      if (camera.position.distanceTo(flyPos) < 0.2) flyTarget = flyPos = null;
    }
    // Pulse the selected node (only motion tied to a real selection)
    if (!opts.reducedMotion) {
      opts.nodes.forEach((n, i) => {
        const s = baseScale[i] * (i === selected ? 1.35 + Math.sin(t * 4) * 0.12 : i === hovered ? 1.25 : 1);
        dummy.position.copy(positions.get(n.id)!);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    controls.update();
    renderer.render(scene, camera);
    if (labelEls.length) {
      const w = width();
      const h = height();
      groupCenters.forEach((gc, i) => {
        v.copy(gc.c).add(new THREE.Vector3(0, 7.5, 0)).project(camera);
        const vis = v.z < 1;
        labelEls[i].style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        labelEls[i].style.opacity = vis ? String(Math.max(0.15, Math.min(1, 1.6 - camera.position.distanceTo(gc.c) / 90))) : '0';
      });
    }
  };
  tick();

  const ro = new ResizeObserver(() => {
    renderer.setSize(width(), height());
    camera.aspect = width() / height();
    camera.updateProjectionMatrix();
  });
  ro.observe(container);

  return {
    focus,
    setColors,
    screenPos(id: string) {
      const p = positions.get(id);
      if (!p) return null;
      v.copy(p).project(camera);
      return { x: ((v.x + 1) / 2) * width(), y: ((1 - v.y) / 2) * height() };
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      sphere.dispose();
      mat.dispose();
      glowGeo.dispose();
      edgeGeo.dispose();
      starGeo.dispose();
      glowTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      if (opts.labels) opts.labels.innerHTML = '';
    },
  };
}

export const STATE_COLOR: Record<string, string> = {
  'locked-soft': '#4b5b74',
  ready: '#60a5fa',
  'in-progress': '#a48bff',
  practiced: '#5fe3c0',
  mastered: '#f6b65a',
  'review-due': '#f472b6',
  remediation: '#f87171',
};
