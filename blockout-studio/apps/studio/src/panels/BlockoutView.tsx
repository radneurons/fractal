import React, { useEffect, useMemo, useRef, useState } from 'react';
import { evalCamera, shotFacts, ASPECTS, SHOT_SIZE_NAMES, type Project } from '@blockout/core';
import { GLPassRenderer, PASSES, type PassName } from '@blockout/render';
import { S, useStudio, activeShot } from '../store';
import { Sel, Toggle } from '../ui';
import { assetUrl } from '../persist';
import { openPopout } from '../popout';
const isPopout = () => new URLSearchParams(location.search).has('view');

/** Live view through a camera using the *export* renderer, so what you see is exactly what the passes contain. */
export function BlockoutCanvas({ pass, cameraId, style, className, maxWidth = 960 }: { pass: PassName; cameraId: string | null; style?: React.CSSProperties; className?: string; maxWidth?: number }) {
  const ref = useRef<HTMLCanvasElement>(null), wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cv = ref.current!, gl = new GLPassRenderer(document.createElement('canvas')), ctx = cv.getContext('2d')!; let raf = 0, key = '', lastP: Project | null = null;
    const loop = () => {
      raf = requestAnimationFrame(loop); const s = S(), p = s.ghost ?? s.project, cam = cameraId ? p.cameras[cameraId] : null, box = wrap.current!.getBoundingClientRect(); if (!cam || box.width < 8) return;
      const a = ASPECTS[p.aspect]; let w = Math.min(maxWidth, box.width, box.height * a); w = Math.max(64, Math.round(w / 2) * 2); const h = Math.max(2, Math.round(w / a / 2) * 2);
      const k = `${s.t}|${pass}|${cameraId}|${w}|${h}`; if (k === key && p === lastP) return; key = k; lastP = p;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const prevT = Math.max(0, s.t - 1 / p.fps);
      gl.renderAt(p, s.t, evalCamera(p, cam, s.t), pass, w, h, { t: prevT, cam: evalCamera(p, cam, prevT) }); ctx.drawImage(gl.output as HTMLCanvasElement, 0, 0);
    };
    loop(); return () => { cancelAnimationFrame(raf); gl.dispose(); };
  }, [pass, cameraId, maxWidth]);
  return <div ref={wrap} className={`flex h-full w-full items-center justify-center ${className ?? ''}`} style={style}><canvas ref={ref} data-testid={`blockout-canvas-${pass}`} className="max-h-full max-w-full" /></div>;
}

export function FrameGuides() {
  const ov = useStudio((s) => s.overlays); const L = (k: string, x1: number, y1: number, x2: number, y2: number, c = 'white') => <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeOpacity={0.45} strokeWidth={0.25} vectorEffect="non-scaling-stroke" />;
  return <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
    {ov.thirds && [33.33, 66.67].flatMap((v) => [L('tv' + v, v, 0, v, 100), L('th' + v, 0, v, 100, v)])}
    {ov.golden && [38.2, 61.8].flatMap((v) => [L('gv' + v, v, 0, v, 100, '#f0b43c'), L('gh' + v, 0, v, 100, v, '#f0b43c')])}
    {ov.safe && [5, 10].map((m) => <rect key={m} x={m} y={m} width={100 - 2 * m} height={100 - 2 * m} fill="none" stroke={m === 5 ? '#50c88c' : '#f06060'} strokeOpacity={0.6} strokeWidth={0.25} vectorEffect="non-scaling-stroke" />)}
  </svg>;
}

export function BlockoutView() {
  const pass = useStudio((s) => s.blockoutPass), shot = useStudio(activeShot), sel = useStudio((s) => s.selection), project = useStudio((s) => s.ghost ?? s.project), focus = useStudio((s) => s.focus), ov = useStudio((s) => s.overlays);
  const cameraId = sel?.kind === 'camera' && project.cameras[sel.id] ? sel.id : shot?.cameraId ?? Object.keys(project.cameras)[0] ?? null;
  const facts = useMemo(() => { try { return shot && project.cameras[shot.cameraId] ? shotFacts(project, shot) : null; } catch { return null; } }, [project, shot]);
  const prim = facts?.subjects[0];
  return <div className={`flex h-full flex-col ${focus === 'blockout' ? 'ring-1 ring-inset ring-accent/40' : ''}`} onPointerDown={() => S().set({ focus: 'blockout' })} data-testid="blockout-view">
    <div className="panel-h"><span className="text-fg">Blockout</span><span className="truncate normal-case">{cameraId ? project.cameras[cameraId]?.name : 'no camera'}</span><span className="flex-1" />
      {(['thirds', 'golden', 'safe'] as const).map((o) => <Toggle key={o} on={ov[o]} onChange={(v) => S().set({ overlays: { ...ov, [o]: v } })}>{o}</Toggle>)}
      <div className="w-28"><Sel label="Pass" value={pass} options={PASSES} onChange={(v) => S().set({ blockoutPass: v })} /></div>{!isPopout() && <button className="btn !px-1" title="Pop out into its own window (e.g. a second monitor)" data-testid="popout-blockout" onClick={() => openPopout('blockout')}>⧉</button>}</div>
    <div className="relative min-h-0 flex-1 bg-black">
      <BlockoutCanvas pass={pass} cameraId={cameraId} /><div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="relative max-h-full max-w-full" style={{ aspectRatio: String(ASPECTS[project.aspect]), width: '100%' }}><FrameGuides /></div></div>
      {facts && <div className="absolute bottom-1 left-1 flex flex-wrap gap-1" data-testid="facts-badge">
        {prim && <span className="chip" title={SHOT_SIZE_NAMES[prim.sizeStart]}>{prim.sizeStart}{prim.sizeEnd !== prim.sizeStart ? `→${prim.sizeEnd}` : ''} · {prim.name}</span>}
        <span className="chip">{facts.camera.motion.type}{facts.camera.motion.secondary.length ? ' + ' + facts.camera.motion.secondary.join(' + ') : ''}</span>
        <span className="chip">{facts.camera.focal}mm {facts.camera.lens}</span><span className="chip">{facts.camera.angle}{facts.camera.dutch ? ' · dutch' : ''}</span>{facts.camera.ots && <span className="chip">OTS {facts.camera.ots}</span>}
      </div>}
    </div>
  </div>;
}

export function ResultView() {
  const shot = useStudio(activeShot), project = useStudio((s) => s.project), t = useStudio((s) => s.t), cur = useStudio((s) => s.currentTakeId), cmp = useStudio((s) => s.compareTakeId), opacity = useStudio((s) => s.resultOpacity);
  const [split, setSplit] = useState(50);
  const takes = Object.values(project.takes).filter((x) => x.shotId === shot?.id && x.status === 'done').sort((a, b) => a.at - b.at);
  const take = takes.find((x) => x.id === cur) ?? takes.find((x) => x.id === shot?.selectedTakeId) ?? takes.find((x) => x.circled) ?? takes[takes.length - 1], other = takes.find((x) => x.id === cmp && x.id !== take?.id);
  const frameOf = (tk: typeof take) => tk && shot ? tk.frames[Math.max(0, Math.min(tk.frames.length - 1, Math.round((t - shot.start) * tk.fps)))] : undefined;
  return <div className="flex h-full flex-col" data-testid="result-view">
    <div className="panel-h"><span className="text-fg">Result</span><span className="truncate normal-case">{take ? `${take.providerId} · seed ${take.seed}${take.circled ? ' · ◎' : ''}${other ? '  vs  ' + other.providerId + ' · seed ' + other.seed : ''}` : 'no take yet'}</span><span className="flex-1" />
      <span>blockout</span><input aria-label="Blockout overlay opacity" type="range" min={0} max={100} value={opacity * 100} onChange={(e) => S().set({ resultOpacity: +e.target.value / 100 })} className="w-20" />{!isPopout() && <button className="btn !px-1" title="Pop out into its own window" data-testid="popout-result" onClick={() => openPopout('result')}>⧉</button>}</div>
    <div className="relative min-h-0 flex-1 bg-black">
      {take ? <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative max-h-full max-w-full" style={{ aspectRatio: String(ASPECTS[project.aspect]), height: '100%' }}>
          <img data-testid="take-frame" alt={`Take frame`} src={assetUrl(frameOf(take))} className="absolute inset-0 h-full w-full object-contain" />
          {other && <img alt="Compare take" src={assetUrl(frameOf(other))} className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 0 0 ${split}%)` }} />}
          {other && <input aria-label="A/B split" type="range" min={0} max={100} value={split} onChange={(e) => setSplit(+e.target.value)} className="absolute bottom-1 left-0 w-full" />}
          {opacity > 0 && shot && <BlockoutCanvas pass="clay" cameraId={shot.cameraId} maxWidth={640} className="absolute inset-0" style={{ opacity, mixBlendMode: 'normal' }} />}
        </div></div> : <div className="flex h-full items-center justify-center text-dim">Generate a take from the Takes tab to see it here.</div>}
    </div>
  </div>;
}
