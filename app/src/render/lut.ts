// .cube 3D LUT parsing (SPEC §10.1): 17³–65³ into a TEXTURE_3D.
export interface Lut { size: number; data: Float32Array; title: string }

export function parseCube(text: string): Lut {
  let size = 0, title = '';
  const vals: number[] = [];
  let lo = [0, 0, 0], hi = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^TITLE/i.test(line)) { title = line.replace(/^TITLE\s*/i, '').replace(/"/g, ''); continue; }
    if (/^LUT_3D_SIZE/i.test(line)) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (/^DOMAIN_MIN/i.test(line)) { lo = line.split(/\s+/).slice(1).map(Number); continue; }
    if (/^DOMAIN_MAX/i.test(line)) { hi = line.split(/\s+/).slice(1).map(Number); continue; }
    if (/^[A-Z_]/i.test(line) && !/^[-+.\d]/.test(line)) continue;
    const p = line.split(/\s+/).map(Number);
    if (p.length >= 3 && p.every((x) => !Number.isNaN(x))) vals.push((p[0] - lo[0]) / (hi[0] - lo[0]), (p[1] - lo[1]) / (hi[1] - lo[1]), (p[2] - lo[2]) / (hi[2] - lo[2]));
  }
  if (size < 2 || size > 65) throw new Error('LUT size must be 2–65');
  if (vals.length !== size * size * size * 3) throw new Error(`LUT has ${vals.length / 3} entries, expected ${size ** 3}`);
  return { size, data: Float32Array.from(vals), title };
}

/** .cube order: red varies fastest → matches texImage3D with x = r, y = g, z = b. */
export function lutTexture(gl: WebGL2RenderingContext, lut: Lut): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_3D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const n = lut.size;
  // RGB8 keeps trilinear filtering available everywhere; 8 bits is ample for 17³–65³ grading LUTs
  const bytes = new Uint8Array(n * n * n * 3);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(lut.data[i] * 255)));
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, n, n, n, 0, gl.RGB, gl.UNSIGNED_BYTE, bytes);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  return t;
}

export const BUILTIN_LUTS = ['warm-film', 'bleach', 'teal-orange', 'mono'];
