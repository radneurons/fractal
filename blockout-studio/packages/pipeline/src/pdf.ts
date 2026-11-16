/** Minimal PDF writer (no dependencies): text in Helvetica + Flate-compressed RGB images. Used for the storyboard. */
import { zlibSync } from 'fflate';
import type { Image } from '@blockout/render';

const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, (c) => ({ '—': '-', '–': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '·': '-', '→': '->', '°': ' deg', '×': 'x', '…': '...' }[c] ?? '?'));
export function wrapText(text: string, maxChars: number): string[] { const out: string[] = []; for (const para of text.split('\n')) { let line = ''; for (const w of para.split(/\s+/)) { if ((line + ' ' + w).trim().length > maxChars && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); } out.push(line); } return out; }
export interface PdfPanel { title: string; size: string; action: string; camera: string; image?: Image; meta?: string }
export function storyboardPDF(title: string, subtitle: string, panels: PdfPanel[]): Uint8Array {
  const objs: (Uint8Array | string)[] = [], enc = new TextEncoder(), add = (o: Uint8Array | string) => (objs.push(o), objs.length);
  const W = 842, H = 595, cols = 3, rows = 2, mx = 36, my = 64, gx = 16, cw = (W - 2 * mx - (cols - 1) * gx) / cols, chh = (H - my - 40) / rows;
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pagesId = add(''), pageIds: number[] = [];
  for (let pg = 0; pg * cols * rows < Math.max(1, panels.length); pg++) {
    const slice = panels.slice(pg * cols * rows, (pg + 1) * cols * rows), xobj: string[] = []; let c = `BT /F2 16 Tf ${mx} ${H - 34} Td (${esc(title)}) Tj ET\nBT /F1 9 Tf 0.4 g ${mx} ${H - 48} Td (${esc(subtitle)}  -  page ${pg + 1}) Tj ET\n0 g\n`;
    slice.forEach((p, i) => {
      const x = mx + (i % cols) * (cw + gx), top = H - my - Math.floor(i / cols) * chh; let ih = 0;
      if (p.image) {
        const im = p.image, rgb = new Uint8Array(im.width * im.height * 3); for (let k = 0, j = 0; k < im.data.length; k += 4) { rgb[j++] = im.data[k]; rgb[j++] = im.data[k + 1]; rgb[j++] = im.data[k + 2]; }
        const z = zlibSync(rgb, { level: 6 }), head = enc.encode(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${z.length} >>\nstream\n`), tail = enc.encode('\nendstream'), buf = new Uint8Array(head.length + z.length + tail.length); buf.set(head); buf.set(z, head.length); buf.set(tail, head.length + z.length);
        const id = add(buf), name = `Im${pg}_${i}`; xobj.push(`/${name} ${id} 0 R`); ih = Math.min(chh * 0.52, (cw * im.height) / im.width); const iw = (ih * im.width) / im.height;
        c += `q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${x.toFixed(2)} ${(top - ih).toFixed(2)} cm /${name} Do Q\n0.6 G 0.5 w ${x.toFixed(2)} ${(top - ih).toFixed(2)} ${iw.toFixed(2)} ${ih.toFixed(2)} re S\n`;
      }
      let y = top - ih - 13; const line = (f: string, sz: number, txt: string, grey = 0) => { c += `BT /${f} ${sz} Tf ${grey} g ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(txt)}) Tj ET\n`; y -= sz + 2.5; };
      line('F2', 10, p.title); line('F1', 8, `${p.size}${p.meta ? '   ' + p.meta : ''}`, 0.35);
      for (const l of wrapText(p.action, Math.floor(cw / 4.1)).slice(0, 6)) line('F1', 8, l); for (const l of wrapText('Camera: ' + p.camera, Math.floor(cw / 4.1)).slice(0, 3)) line('F1', 8, l, 0.25);
    });
    const body = enc.encode(c), content = add(`<< /Length ${body.length} >>\nstream\n${c}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> /XObject << ${xobj.join(' ')} >> >> >>`));
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const chunks: Uint8Array[] = [enc.encode('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')], offsets: number[] = []; let pos = chunks[0].length;
  objs.forEach((o, i) => { offsets.push(pos); const head = enc.encode(`${i + 1} 0 obj\n`), body = typeof o === 'string' ? enc.encode(o) : o, tail = enc.encode('\nendobj\n'); chunks.push(head, body, tail); pos += head.length + body.length + tail.length; });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`; chunks.push(enc.encode(xref));
  const out = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0)); let o = 0; for (const ch of chunks) { out.set(ch, o); o += ch.length; } return out;
}
