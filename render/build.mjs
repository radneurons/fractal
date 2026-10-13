// Inline the font files as base64 so the output HTML is fully self-contained.
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('./he-has.src.html', import.meta.url), 'utf8');
const out = src.replace(/url\((fonts\/[^)]+\.ttf)\)/g, (_, f) =>
  `url(data:font/ttf;base64,${readFileSync(new URL('./' + f, import.meta.url)).toString('base64')})`);
writeFileSync(new URL('./he-has.html', import.meta.url), out);
console.log('wrote he-has.html', (out.length / 1024).toFixed(0) + ' KB');
