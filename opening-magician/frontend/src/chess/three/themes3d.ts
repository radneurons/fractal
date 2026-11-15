// Six complete 3D environments.  Each builds real geometry, materials and lighting around the
// board and returns the board's own materials so every theme keeps the squares clearly readable.
import * as THREE from "three";
import { brushedTexture, marbleTexture, woodTexture } from "./pieces3d";

export type ThemeId = "library" | "marble" | "observatory" | "arena" | "zen" | "cosmic";
export const THEMES_3D: { id: ThemeId; name: string; note: string }[] = [
  { id: "library", name: "The Grandmaster's Library", note: "Walnut, brass and emerald under warm lamplight" },
  { id: "marble", name: "The Marble Palace", note: "White marble, black stone and gold in daylight" },
  { id: "observatory", name: "The Tactical Observatory", note: "Holographic board with floating data" },
  { id: "arena", name: "The Tournament Broadcast Arena", note: "Stage lighting and clean broadcast look" },
  { id: "zen", name: "The Zen Chess Garden", note: "Natural wood, stone and soft daylight" },
  { id: "cosmic", name: "The Cosmic Chess Observatory", note: "Illuminated board among the stars" },
];

export type ThemeBuild = {
  group: THREE.Group;
  light: THREE.Material; dark: THREE.Material; frame: THREE.Material;
  background: THREE.Color | THREE.Texture; fog?: THREE.Fog | THREE.FogExp2;
  key: THREE.DirectionalLight;
  envIntensity: number; exposure: number; bloom: number;
  animated: boolean;
  update?: (t: number) => void;
  coordColor: string;
};

function gradientTexture(stops: [number, string][], vertical = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 16; c.height = 512;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, vertical ? 0 : 16, vertical ? 512 : 0);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function keyLight(color: string, intensity: number, pos: [number, number, number], shadows: boolean, mapSize: number): THREE.DirectionalLight {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.set(...pos);
  l.castShadow = shadows;
  l.shadow.mapSize.set(mapSize, mapSize);
  const c = l.shadow.camera;
  c.left = -7; c.right = 7; c.top = 7; c.bottom = -7; c.near = 1; c.far = 40;
  l.shadow.bias = -0.0004; l.shadow.normalBias = 0.02; l.shadow.radius = 4;
  return l;
}

const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
const phys = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);
function mesh(g: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number] = [0, 0, 0], shadow = true): THREE.Mesh {
  const x = new THREE.Mesh(g, m);
  x.position.set(...pos);
  x.castShadow = shadow; x.receiveShadow = true;
  return x;
}

export function buildTheme(id: ThemeId, opts: { shadows: boolean; mapSize: number }): ThemeBuild {
  const group = new THREE.Group();
  const { shadows, mapSize } = opts;
  switch (id) {
    // ------------------------------------------------------------------ library
    case "library": {
      const table = mesh(new THREE.CylinderGeometry(9.5, 9.5, 0.5, 64), phys({ map: woodTexture("#5b371b", "#1f0f05", 11, 3), roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.3 }), [0, -0.62, 0], false);
      group.add(table);
      const floor = mesh(new THREE.PlaneGeometry(90, 90), std({ color: "#120c08", roughness: 0.9 }), [0, -4.2, 0], false);
      floor.rotation.x = -Math.PI / 2; group.add(floor);
      // bookshelves: instanced books with varied spines
      const colors = ["#5b1f1b", "#1f3d2c", "#27304f", "#6a4a1c", "#3b2318", "#184043", "#4d2a3f", "#7a5a2a"];
      const book = new THREE.BoxGeometry(0.34, 1.5, 1.1);
      const books = new THREE.InstancedMesh(book, std({ roughness: 0.7 }), 2 * 3 * 64);
      const m4 = new THREE.Matrix4(); const col = new THREE.Color(); let n = 0; let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (const side of [-1, 1]) for (let shelf = 0; shelf < 3; shelf++) for (let i = 0; i < 64; i++) {
        const h = 0.8 + rnd() * 0.5;
        m4.compose(new THREE.Vector3(-13.5 + i * 0.42, -1.4 + shelf * 2.2 + (h * 1.5) / 2 - 0.75, side * 17 + (rnd() - 0.5) * 0.1),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rnd() < 0.06 ? 0.18 : 0)), new THREE.Vector3(0.75 + rnd() * 0.5, h, 1));
        books.setMatrixAt(n, m4); books.setColorAt(n, col.set(colors[Math.floor(rnd() * colors.length)]).multiplyScalar(0.7 + rnd() * 0.5)); n++;
      }
      books.instanceMatrix.needsUpdate = true; if (books.instanceColor) books.instanceColor.needsUpdate = true;
      group.add(books);
      const shelfMat = std({ map: woodTexture("#3a2212", "#120703", 13, 2), roughness: 0.6 });
      for (const side of [-1, 1]) for (let s = 0; s < 4; s++) group.add(mesh(new THREE.BoxGeometry(29, 0.16, 1.5), shelfMat, [0, -2.2 + s * 2.2, side * 17], false));
      // brass banker's lamp with emerald shade
      const brass = std({ color: "#c9a45c", metalness: 1, roughness: 0.25, roughnessMap: brushedTexture(3) });
      const lamp = new THREE.Group();
      lamp.add(mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.12, 32), brass, [0, 0.06, 0]));
      lamp.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 16), brass, [0, 1.1, 0]));
      const shade = mesh(new THREE.CylinderGeometry(0.5, 0.95, 0.55, 32, 1, true), phys({ color: "#0f5a3d", roughness: 0.25, clearcoat: 1, side: THREE.DoubleSide, emissive: "#0a3d29", emissiveIntensity: 0.6 }), [0, 2.25, 0]);
      lamp.add(shade);
      const bulb = mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: "#ffe2a8" }), [0, 2.1, 0], false);
      lamp.add(bulb);
      const glow = new THREE.PointLight("#ffcf8a", 60, 26, 1.8); glow.position.set(0, 2.0, 0); lamp.add(glow);
      lamp.position.set(-6.4, -0.37, -4.6); group.add(lamp);
      const hemi = new THREE.HemisphereLight("#ffe9c4", "#1a0f08", 0.55); group.add(hemi);
      const key = keyLight("#ffe1b0", 2.6, [-6, 11, 7], shadows, mapSize); group.add(key);
      const rim = new THREE.DirectionalLight("#7fb9a0", 0.5); rim.position.set(8, 5, -9); group.add(rim);
      return { group, key, light: phys({ map: woodTexture("#e6c692", "#a9793c", 21), roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
        dark: phys({ map: woodTexture("#6b4222", "#2a1407", 22), roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
        frame: phys({ map: woodTexture("#3b2110", "#120703", 23, 2), roughness: 0.35, clearcoat: 0.5 }),
        background: gradientTexture([[0, "#1a120b"], [0.55, "#0c0806"], [1, "#050302"]]), fog: new THREE.Fog("#0a0705", 22, 60),
        envIntensity: 0.55, exposure: 1.05, bloom: 0.25, animated: false, coordColor: "#d9c08a" };
    }
    // ------------------------------------------------------------------ marble palace
    case "marble": {
      const tiles = marbleTexture("#ece9e3", "#9a968f", 31, 6);
      const floor = mesh(new THREE.PlaneGeometry(120, 120), phys({ map: tiles, roughness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.1 }), [0, -1.4, 0], false);
      floor.rotation.x = -Math.PI / 2; group.add(floor);
      const plinth = mesh(new THREE.BoxGeometry(12, 1.0, 12), phys({ map: marbleTexture("#17181c", "#7a7d85", 32, 2), roughness: 0.15, clearcoat: 0.8 }), [0, -0.9, 0]);
      group.add(plinth);
      const gold = std({ color: "#d8b25a", metalness: 1, roughness: 0.2 });
      group.add(mesh(new THREE.BoxGeometry(9.5, 0.06, 9.5), gold, [0, -0.37, 0]));       // a thin gilded rim around the board
      group.add(mesh(new THREE.BoxGeometry(12.2, 0.05, 12.2), gold, [0, -1.36, 0], false));  // and at the foot of the plinth
      const colMat = phys({ map: marbleTexture("#f3f0ea", "#aaa69f", 33, 2), roughness: 0.25, clearcoat: 0.4 });
      const fluted = (() => {
        const sh = new THREE.Shape();
        const N = 20;
        for (let i = 0; i <= N * 2; i++) { const a = (i / (N * 2)) * Math.PI * 2; const r = i % 2 === 0 ? 1.0 : 0.9; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y); }
        const g = new THREE.ExtrudeGeometry(sh, { depth: 14, bevelEnabled: false, curveSegments: 4 });
        g.rotateX(-Math.PI / 2);
        return g;
      })();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        const x = Math.cos(a) * 24, z = Math.sin(a) * 24;
        group.add(mesh(fluted, colMat, [x, -1.4, z]));
        group.add(mesh(new THREE.BoxGeometry(2.8, 0.5, 2.8), colMat, [x, -1.15, z]));
        group.add(mesh(new THREE.BoxGeometry(2.8, 0.5, 2.8), gold, [x, 12.6, z], false));
      }
      const hemi = new THREE.HemisphereLight("#eaf2ff", "#c9b9a0", 1.0); group.add(hemi);
      const key = keyLight("#fff3dc", 3.4, [9, 16, 6], shadows, mapSize); group.add(key);
      return { group, key, light: phys({ map: marbleTexture("#f6f3ee", "#a09c95", 34), roughness: 0.12, clearcoat: 0.9, clearcoatRoughness: 0.08 }),
        dark: phys({ map: marbleTexture("#23252b", "#7d818b", 35), roughness: 0.12, clearcoat: 0.9, clearcoatRoughness: 0.08 }),
        frame: phys({ map: marbleTexture("#15161a", "#6f737c", 36, 2), roughness: 0.14, clearcoat: 0.9, clearcoatRoughness: 0.1 }),
        background: gradientTexture([[0, "#bcd3ea"], [0.5, "#e9eef2"], [1, "#d8cdbb"]]), fog: new THREE.Fog("#dfe6ea", 40, 110),
        envIntensity: 0.9, exposure: 0.95, bloom: 0.12, animated: false, coordColor: "#3a3f4a" };
    }
    // ------------------------------------------------------------------ tactical observatory
    case "observatory": {
      const grid = new THREE.GridHelper(80, 80, "#1f7fa8", "#0d3247");
      (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.55;
      grid.position.y = -0.8; group.add(grid);
      const ringMat = new THREE.MeshBasicMaterial({ color: "#38d6ff", transparent: true, opacity: 0.7 });
      const rings: THREE.Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const r = mesh(new THREE.TorusGeometry(7.2 + i * 1.5, 0.015 + i * 0.006, 8, 160), ringMat, [0, -0.4 + i * 0.12, 0], false);
        r.rotation.x = Math.PI / 2; rings.push(r); group.add(r);
      }
      // floating data panels
      const panelTex = (() => {
        const c = document.createElement("canvas"); c.width = 256; c.height = 160;
        const x = c.getContext("2d")!;
        x.fillStyle = "rgba(10,40,60,0.55)"; x.fillRect(0, 0, 256, 160);
        x.strokeStyle = "#5fd4ff"; x.lineWidth = 2; x.strokeRect(1, 1, 254, 158);
        x.strokeStyle = "#38e0b0"; x.beginPath();
        for (let i = 0; i < 24; i++) x.lineTo(12 + i * 10, 110 - Math.sin(i * 0.7) * 30 - i * 1.2);
        x.stroke();
        x.fillStyle = "#9fe8ff";
        for (let i = 0; i < 5; i++) x.fillRect(14, 16 + i * 9, 60 + ((i * 37) % 90), 3);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      const panels: THREE.Mesh[] = [];
      for (let i = 0; i < 5; i++) {
        const a = -0.9 + i * 0.45;
        const p = mesh(new THREE.PlaneGeometry(3.4, 2.1), new THREE.MeshBasicMaterial({ map: panelTex, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
          [Math.sin(a) * 11.5, 2.4 + (i % 2) * 0.8, -Math.cos(a) * 11.5], false);
        p.lookAt(0, 1.5, 0); panels.push(p); group.add(p);
      }
      const hemi = new THREE.HemisphereLight("#7fd8ff", "#02101a", 0.7); group.add(hemi);
      const key = keyLight("#bfeaff", 2.2, [5, 12, 8], shadows, mapSize); group.add(key);
      const glass = (c: string, e: string) => phys({ color: c, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.86, emissive: e, emissiveIntensity: 0.55 });
      return { group, key, light: glass("#2f7fa3", "#1c6f96"), dark: glass("#0c2c40", "#06202f"),
        frame: std({ color: "#0a1c28", metalness: 0.8, roughness: 0.3, emissive: "#0b5f80", emissiveIntensity: 0.6 }),
        background: gradientTexture([[0, "#02060b"], [0.6, "#061521"], [1, "#0a2233"]]), fog: new THREE.FogExp2("#04101a", 0.018),
        envIntensity: 0.35, exposure: 1.1, bloom: 0.75, animated: true, coordColor: "#8fe6ff",
        update: (t) => { rings.forEach((r, i) => { r.rotation.z = t * (0.05 + i * 0.03) * (i % 2 ? -1 : 1); }); panels.forEach((p, i) => { p.position.y = 2.4 + (i % 2) * 0.8 + Math.sin(t * 0.6 + i) * 0.12; }); } };
    }
    // ------------------------------------------------------------------ broadcast arena
    case "arena": {
      const stage = mesh(new THREE.CylinderGeometry(11, 11.6, 0.6, 72), std({ color: "#15171c", roughness: 0.35, metalness: 0.4 }), [0, -0.72, 0], false);
      group.add(stage);
      const edge = mesh(new THREE.TorusGeometry(11.1, 0.06, 8, 120), new THREE.MeshBasicMaterial({ color: "#f0b429" }), [0, -0.41, 0], false);
      edge.rotation.x = Math.PI / 2; group.add(edge);
      const floor = mesh(new THREE.PlaneGeometry(140, 140), std({ color: "#07080a", roughness: 0.6, metalness: 0.2 }), [0, -1.05, 0], false);
      floor.rotation.x = -Math.PI / 2; group.add(floor);
      const wall = mesh(new THREE.PlaneGeometry(70, 26), new THREE.MeshBasicMaterial({ map: gradientTexture([[0, "#10224a"], [0.5, "#0b1630"], [1, "#05070d"]]) }), [0, 10, -30], false);
      group.add(wall);
      for (let i = -4; i <= 4; i++) group.add(mesh(new THREE.BoxGeometry(0.25, 26, 0.25), std({ color: "#1b2233", metalness: 0.8, roughness: 0.3 }), [i * 7.5, 10, -29.7], false));
      const truss = std({ color: "#2b2f38", metalness: 0.9, roughness: 0.35 });
      group.add(mesh(new THREE.BoxGeometry(46, 0.35, 0.35), truss, [0, 15, -6], false));
      group.add(mesh(new THREE.BoxGeometry(46, 0.35, 0.35), truss, [0, 15, 6], false));
      const spots: THREE.SpotLight[] = [];
      [[-10, "#ffffff"], [0, "#ffe9c0"], [10, "#ffffff"]].forEach(([x, c], i) => {
        const s = new THREE.SpotLight(c as string, 900, 40, 0.42, 0.5, 1.6);
        s.position.set(x as number, 14.6, i === 1 ? 6 : -6); s.target.position.set(0, 0, 0);
        group.add(s, s.target); spots.push(s);
        const can = mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.9, 16), truss, [x as number, 14.5, i === 1 ? 6 : -6], false);
        can.lookAt(0, 0, 0); can.rotateX(Math.PI / 2); group.add(can);
        const cone = mesh(new THREE.ConeGeometry(4.4, 15, 32, 1, true), new THREE.MeshBasicMaterial({ color: c as string, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false }), [(x as number) / 2, 7.3, (i === 1 ? 6 : -6) / 2], false);
        cone.lookAt(x as number, 14.6, i === 1 ? 6 : -6); cone.rotateX(-Math.PI / 2); group.add(cone);
      });
      const hemi = new THREE.HemisphereLight("#9fb6ff", "#05060a", 0.35); group.add(hemi);
      const key = keyLight("#ffffff", 2.3, [3, 15, 9], shadows, mapSize); group.add(key);
      return { group, key, light: std({ color: "#e9ecf1", roughness: 0.35 }), dark: std({ color: "#55789f", roughness: 0.35 }),
        frame: std({ color: "#11141a", roughness: 0.3, metalness: 0.6 }), background: new THREE.Color("#04050a"), fog: new THREE.Fog("#04050a", 30, 90),
        envIntensity: 0.5, exposure: 1.0, bloom: 0.35, animated: false, coordColor: "#f0b429" };
    }
    // ------------------------------------------------------------------ zen garden
    case "zen": {
      const sandTex = (() => {
        const c = document.createElement("canvas"); c.width = c.height = 512; const x = c.getContext("2d")!;
        x.fillStyle = "#d9cfb6"; x.fillRect(0, 0, 512, 512);
        for (let y = 0; y < 512; y += 9) { x.strokeStyle = y % 18 === 0 ? "rgba(120,105,75,0.35)" : "rgba(255,250,235,0.5)"; x.lineWidth = 3; x.beginPath(); for (let i = 0; i <= 512; i += 16) x.lineTo(i, y + Math.sin(i * 0.035) * 5); x.stroke(); }
        const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 8); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      const sand = mesh(new THREE.PlaneGeometry(120, 120), std({ map: sandTex, roughness: 1 }), [0, -1.3, 0], false);
      sand.rotation.x = -Math.PI / 2; group.add(sand);
      const deck = mesh(new THREE.BoxGeometry(15, 0.4, 15), std({ map: woodTexture("#b99363", "#6c4a25", 41, 3), roughness: 0.65 }), [0, -0.58, 0]);
      group.add(deck);
      for (const [x, z] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]]) group.add(mesh(new THREE.BoxGeometry(0.7, 1.0, 0.7), std({ color: "#5c4023", roughness: 0.8 }), [x, -0.95, z]));
      const stoneMat = std({ color: "#6f716d", roughness: 0.95, flatShading: true });
      [[-11, -9, 1.7], [-13, -6.5, 1.0], [12, -11, 2.1], [14, -7.5, 1.1], [10, 10, 1.3]].forEach(([x, z, s], i) => {
        const g = new THREE.IcosahedronGeometry(s, 1);
        const p = g.attributes.position as THREE.BufferAttribute;
        for (let k = 0; k < p.count; k++) { const n = 1 + Math.sin(k * 12.9898 + i * 78.233) * 0.12; p.setXYZ(k, p.getX(k) * n, p.getY(k) * n * 0.7, p.getZ(k) * n); }
        g.computeVertexNormals();
        group.add(mesh(g, stoneMat, [x, -1.3 + s * 0.35, z]));
      });
      const bamboo = std({ color: "#7f9a52", roughness: 0.6 });
      for (let i = 0; i < 26; i++) { const x = -22 + i * 1.75 + Math.sin(i * 3.1) * 0.5; const h = 9 + Math.sin(i * 1.7) * 3; group.add(mesh(new THREE.CylinderGeometry(0.11, 0.14, h, 8), bamboo, [x, h / 2 - 1.3, -19 + Math.cos(i * 2.3) * 1.2])); }
      const hemi = new THREE.HemisphereLight("#f4f7ff", "#b9ad92", 1.15); group.add(hemi);
      const key = keyLight("#fff6e6", 2.2, [-7, 14, 9], shadows, mapSize); group.add(key);
      return { group, key, light: std({ map: woodTexture("#ead9b6", "#bfa371", 42), roughness: 0.55 }), dark: std({ map: woodTexture("#9b855a", "#5d4a2a", 43), roughness: 0.55 }),
        frame: std({ map: woodTexture("#6f5632", "#3a2a14", 44, 2), roughness: 0.6 }), background: gradientTexture([[0, "#cfe0e6"], [0.55, "#e8ecdf"], [1, "#d5ccb2"]]),
        fog: new THREE.Fog("#dfe6dc", 35, 95), envIntensity: 0.6, exposure: 0.95, bloom: 0.05, animated: false, coordColor: "#3a2f1b" };
    }
    // ------------------------------------------------------------------ cosmic
    default: {
      const starGeo = new THREE.BufferGeometry();
      const N = 3200; const pos = new Float32Array(N * 3); const colr = new Float32Array(N * 3);
      let seed = 99; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < N; i++) {
        const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), r = 70 + rnd() * 60;
        pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i * 3);
        const tint = rnd(); colr.set([0.8 + tint * 0.2, 0.8 + rnd() * 0.2, 1], i * 3);
      }
      starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); starGeo.setAttribute("color", new THREE.BufferAttribute(colr, 3));
      const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.42, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false }));
      group.add(stars);
      const nebTex = (() => {
        const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d")!;
        const g = x.createRadialGradient(128, 128, 8, 128, 128, 128); g.addColorStop(0, "rgba(160,120,255,0.55)"); g.addColorStop(0.45, "rgba(70,60,190,0.2)"); g.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = g; x.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      [[-40, 18, -70, 90, "#b79cff"], [50, -8, -80, 110, "#4fd1c5"], [10, 40, -90, 70, "#ff8fd0"]].forEach(([x, y, z, s, c]) => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: nebTex, color: c as string, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
        sp.position.set(x as number, y as number, z as number); sp.scale.setScalar(s as number); group.add(sp);
      });
      const planet = mesh(new THREE.SphereGeometry(13, 48, 32), std({ color: "#2a2550", roughness: 0.9, emissive: "#120f2e", emissiveIntensity: 0.6 }), [-34, -16, -52], false);
      group.add(planet);
      const halo = mesh(new THREE.TorusGeometry(19, 0.5, 2, 120), new THREE.MeshBasicMaterial({ color: "#8f7dff", transparent: true, opacity: 0.35, side: THREE.DoubleSide }), [-34, -16, -52], false);
      halo.rotation.x = 1.25; halo.scale.z = 0.05; group.add(halo);
      const plate = mesh(new THREE.CylinderGeometry(7.6, 7.2, 0.25, 64), std({ color: "#0d0b1c", metalness: 0.9, roughness: 0.25, emissive: "#3a2f8f", emissiveIntensity: 0.25 }), [0, -0.48, 0], false);
      group.add(plate);
      const glowRing = mesh(new THREE.TorusGeometry(7.45, 0.035, 8, 140), new THREE.MeshBasicMaterial({ color: "#b79cff" }), [0, -0.34, 0], false);
      glowRing.rotation.x = Math.PI / 2; group.add(glowRing);
      const hemi = new THREE.HemisphereLight("#b9b0ff", "#05040c", 0.6); group.add(hemi);
      const key = keyLight("#e9e4ff", 2.4, [6, 13, 7], shadows, mapSize); group.add(key);
      const rim = new THREE.DirectionalLight("#4fd1c5", 0.9); rim.position.set(-9, 4, -8); group.add(rim);
      return { group, key, light: std({ color: "#d6cff5", roughness: 0.3, metalness: 0.15, emissive: "#6a5cc0", emissiveIntensity: 0.16 }),
        dark: std({ color: "#3d3478", roughness: 0.3, metalness: 0.2, emissive: "#1a1447", emissiveIntensity: 0.3 }),
        frame: std({ color: "#15122b", metalness: 0.9, roughness: 0.25, emissive: "#6b5ad6", emissiveIntensity: 0.2 }), background: new THREE.Color("#04030a"),
        envIntensity: 0.4, exposure: 1.05, bloom: 0.6, animated: true, coordColor: "#d8c8ff",
        update: (t) => { stars.rotation.y = t * 0.004; planet.rotation.y = t * 0.02; } };
    }
  }
}
