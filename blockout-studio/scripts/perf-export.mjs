// Main-thread CPU cost per exported 1080p clay frame (scene compile + GPU command submission + VideoFrame + encoder enqueue).
// GPU raster and video encoding run in other processes (pinned to other cores here) and are not counted.
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
const url = process.argv[2] ?? 'http://localhost:4174/?fresh&nobridge', height = +(process.argv[3] ?? 1080), frames = +(process.argv[4] ?? 24);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 560 } }), cdp = await p.context().newCDPSession(p);
await p.goto(url); await p.getByTestId('scene-view').waitFor(); await p.waitForTimeout(1000);
for (const l of execSync('ps -eo pid,args').toString().split('\n')) { const pid = l.trim().split(/\s+/)[0]; if (/--type=gpu-process|--type=utility/.test(l)) execSync(`taskset -a -p -c 2,3 ${pid}`); else if (/--type=renderer/.test(l)) execSync(`taskset -a -p -c 0,1 ${pid}`); }
await p.evaluate(() => window.__studio.getState().set({ playing: false }));
await p.evaluate(([h]) => window.__blockout.benchClay(h, 4, true), [height]); // warm-up: shaders, targets, encoder
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start');
const r = await p.evaluate(([h, n]) => window.__blockout.benchClay(h, n, true), [height, frames]);
const { profile } = await cdp.send('Profiler.stop'), byId = new Map(profile.nodes.map((n) => [n.id, n])); let js = 0, gc = 0, nat = 0, idle = 0;
profile.samples.forEach((id, i) => { const c = byId.get(id).callFrame, d = profile.timeDeltas[i] ?? 0; if (c.functionName === '(garbage collector)') gc += d; else if (/^\((idle|program)\)$/.test(c.functionName)) idle += d; else if (c.url) js += d; else nat += d; });
if (process.env.TOP) { const self = new Map(); profile.samples.forEach((id, i) => { const c = byId.get(id).callFrame; if (/^\((idle|program)\)$/.test(c.functionName)) return; const k = `${c.functionName}@${c.url.split('/').pop()?.split('?')[0]}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0)); }); console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${(v / 1000 / frames).toFixed(2)}ms ${k}`).join('\n')); }
const n = frames; console.log(JSON.stringify({ height, frames: n, encoded: r.encoded, wallFpsHere: +r.fps.toFixed(2), mainThreadCpuMsPerFrame: +((js + gc + nat) / 1000 / n).toFixed(2), jsMs: +(js / 1000 / n).toFixed(2), gcMs: +(gc / 1000 / n).toFixed(2), nativeMs: +(nat / 1000 / n).toFixed(2), waitingMs: +(idle / 1000 / n).toFixed(2), cpuBoundFps: +(1000 / ((js + gc + nat) / 1000 / n)).toFixed(0), renderer: r.renderer }));
await b.close();
