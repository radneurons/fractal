// Turns dist/ (vite build) into an Artifact-shaped page: dist-artifact/index.html holds only the page
// content (title, inlined CSS, body markup, module script); every other build file is published alongside.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const html = readFileSync('dist/index.html', 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const cssHref = html.match(/<link rel="stylesheet"[^>]*href="\.?\/?([^"]+)"/)[1];
const jsSrc = html.match(/<script type="module"[^>]*src="\.?\/?([^"]+)"/)[1];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script type="module"[^>]*><\/script>/g, '').trim();
const css = readFileSync(join('dist', cssHref), 'utf8');
const page = `${title}\n<style>\n${css}\n</style>\n${body}\n<script type="module" src="${jsSrc}"></script>\n`;
mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/index.html', page);
const files = {};
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else { const rel = p.slice('dist/'.length); if (rel !== 'index.html' && rel !== cssHref) files[rel] = 'app/' + p; } } };
walk('dist');
writeFileSync('dist-artifact/files.json', JSON.stringify(files, null, 1));
console.log('page', (page.length / 1024).toFixed(1), 'KB;', Object.keys(files).length, 'supporting files');
