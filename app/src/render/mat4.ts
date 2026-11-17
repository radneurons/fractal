// Hand-written column-major mat4 helpers (no 3D library).
export type M4 = Float32Array;
export const ident = (): M4 => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
export function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
export function perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = (2 * far * near) / (near - far);
  return o;
}
export function lookAt(eye: number[], at: number[], up: number[]): M4 {
  const z = norm([eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]]);
  const x = norm(cross(up, z)), y = cross(z, x);
  const o = ident();
  o[0] = x[0]; o[4] = x[1]; o[8] = x[2];
  o[1] = y[0]; o[5] = y[1]; o[9] = y[2];
  o[2] = z[0]; o[6] = z[1]; o[10] = z[2];
  o[12] = -dot(x, eye); o[13] = -dot(y, eye); o[14] = -dot(z, eye);
  return o;
}
export function translate(x: number, y: number, z: number): M4 { const o = ident(); o[12] = x; o[13] = y; o[14] = z; return o; }
export function scale(x: number, y: number, z: number): M4 { const o = ident(); o[0] = x; o[5] = y; o[10] = z; return o; }
export function rotX(a: number): M4 { const o = ident(), c = Math.cos(a), s = Math.sin(a); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; }
export function rotY(a: number): M4 { const o = ident(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; }
export function rotZ(a: number): M4 { const o = ident(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o; }
/** translate · rotZ · rotX · scale, about an optional pivot */
export function model(t: number[], rz: number, rx: number, s: number[], pivot: number[] = [0, 0, 0]): M4 {
  return mul(translate(t[0], t[1], t[2]), mul(rotZ(rz), mul(rotX(rx), mul(scale(s[0], s[1], s[2]), translate(-pivot[0], -pivot[1], -pivot[2])))));
}
export const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
