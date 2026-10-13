// Inline the two OFL fonts as base64 so the film makes no network requests.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const fonts = {};
for (const f of readdirSync(new URL('fonts/', here))) if (f.endsWith('.ttf')) fonts[f.replace('.ttf', '')] = readFileSync(new URL('fonts/' + f, here)).toString('base64');
const out = readFileSync(new URL('fire.src.html', here), 'utf8').replace('/*FONTDATA*/', () => JSON.stringify(fonts));
writeFileSync(new URL('not-light-but-fire.html', here), out);
console.log('wrote not-light-but-fire.html', (out.length / 1024).toFixed(0) + ' KB');
