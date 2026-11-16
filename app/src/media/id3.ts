// ID3v2 reader: title, artist, embedded (unsynchronised) lyrics and cover art.
// Lets a single MP3 fill the title, the lyrics editor and the artwork palette on load.
export interface Tags { title?: string; artist?: string; lyrics?: string; picture?: Blob }

function decode(bytes: Uint8Array, enc: number): string {
  const label = enc === 0 ? 'latin1' : enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : 'utf-8';
  try { return new TextDecoder(label).decode(bytes).replace(/\u0000+$/g, ''); } catch { return ''; }
}
function findTerminator(b: Uint8Array, start: number, enc: number): number {
  if (enc === 1 || enc === 2) { for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i; return b.length; }
  for (let i = start; i < b.length; i++) if (b[i] === 0) return i;
  return b.length;
}

export function readTags(buf: ArrayBuffer): Tags {
  const b = new Uint8Array(buf);
  const out: Tags = {};
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return out; // "ID3"
  const ver = b[3];
  const synch = (o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
  const be32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const end = Math.min(b.length, 10 + synch(6));
  let o = 10;
  if (b[5] & 0x40) o += ver === 4 ? synch(10) : be32(10) + 4; // extended header
  while (o + 10 <= end) {
    const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = ver === 4 ? synch(o + 4) : be32(o + 4);
    const body = b.subarray(o + 10, Math.min(end, o + 10 + size));
    o += 10 + size;
    if (!size) continue;
    if (id === 'TIT2') out.title = decode(body.subarray(1), body[0]);
    else if (id === 'TPE1') out.artist = decode(body.subarray(1), body[0]);
    else if (id === 'USLT') {
      const enc = body[0];
      const t = findTerminator(body, 4, enc);
      out.lyrics = decode(body.subarray(t + (enc === 1 || enc === 2 ? 2 : 1)), enc);
    } else if (id === 'TXXX') {
      const enc = body[0];
      const t = findTerminator(body, 1, enc);
      const desc = decode(body.subarray(1, t), enc).toLowerCase();
      if (!out.lyrics && /lyrics/.test(desc)) out.lyrics = decode(body.subarray(t + (enc === 1 || enc === 2 ? 2 : 1)), enc);
    } else if (id === 'APIC' && !out.picture) {
      const enc = body[0];
      let p = 1;
      const mEnd = findTerminator(body, p, 0);
      const mime = decode(body.subarray(p, mEnd), 0) || 'image/jpeg';
      p = mEnd + 1 + 1; // skip picture type
      const dEnd = findTerminator(body, p, enc);
      p = dEnd + (enc === 1 || enc === 2 ? 2 : 1);
      out.picture = new Blob([body.slice(p)], { type: mime.includes('/') ? mime : `image/${mime}` });
    }
  }
  return out;
}
