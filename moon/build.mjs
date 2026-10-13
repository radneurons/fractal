// Inline opentype.js and the four OFL fonts so the output HTML makes no network requests.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const src = readFileSync(new URL('moon.src.html', here), 'utf8');
const ot = readFileSync(new URL('vendor/opentype.min.js', here), 'utf8');
const fonts = {};
for (const f of readdirSync(new URL('fonts/', here))) if (f.endsWith('.ttf')) fonts[f.replace('.ttf', '')] = readFileSync(new URL('fonts/' + f, here)).toString('base64');
const out = src.replace('/*OPENTYPE*/', () => ot).replace('/*FONTDATA*/', () => JSON.stringify(fonts));
writeFileSync(new URL('because-they-are-hard.html', here), out);
console.log('wrote because-they-are-hard.html', (out.length / 1024).toFixed(0) + ' KB');
