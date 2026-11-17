import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ASPECTS, type Take } from '@blockout/core';
import { S, useStudio, activeShot } from '../store';
import { autoScore, cancelJob, critique, estimate, frameUrl, generate, loadHttpProviders, providers, useJobs } from '../generate';
import { exportEDL, exportFCPXML, exportGLTF, exportOTIO, exportStoryboard, exportUSD, renderCut } from '../assembly';
import { rpc, useGateway } from '../gateway';
import { download, Section } from '../ui';

function MaskPainter({ take, onDone }: { take: Take; onDone: (mask: Uint8Array | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null), down = useRef(false);
  useEffect(() => { const c = ref.current!; c.width = take.width; c.height = take.height; const g = c.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); }, [take]);
  const paint = (e: React.PointerEvent) => { if (!down.current) return; const c = ref.current!, r = c.getBoundingClientRect(), g = c.getContext('2d')!; g.fillStyle = '#fff'; g.beginPath(); g.arc(((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height, c.width / 18, 0, 7); g.fill(); };
  return <div className="mt-1 rounded border border-claude/60 p-1"><p className="text-xxs text-dim">Paint the region to regenerate (white). Everything else is kept.</p>
    <div className="relative" style={{ aspectRatio: `${take.width}/${take.height}` }}><img alt="" src={frameUrl(take.frames[0])} className="absolute inset-0 h-full w-full" /><canvas ref={ref} data-testid="mask-canvas" className="absolute inset-0 h-full w-full opacity-50" onPointerDown={(e) => { down.current = true; paint(e); }} onPointerMove={paint} onPointerUp={() => (down.current = false)} onPointerLeave={() => (down.current = false)} /></div>
    <div className="mt-1 flex gap-1"><button className="btn-claude" onClick={async () => { const c = ref.current!, b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png')); onDone(b ? new Uint8Array(await b.arrayBuffer()) : null); }}>Regenerate region</button><button className="btn" onClick={() => onDone(null)}>Cancel</button></div></div>;
}
function TakeCard({ t, n }: { t: Take; n: number }) {
  const cur = useStudio((s) => s.currentTakeId), cmp = useStudio((s) => s.compareTakeId), shot = useStudio(activeShot), [mask, setMask] = useState(false), [open, setOpen] = useState(false), up = (patch: Partial<Take>, label: string) => S().dispatch({ type: 'updateTake', id: t.id, patch }, { label });
  const fix = (kind: 'upscale' | 'interpolate') => { const pr = providers(kind)[0]; if (pr) void generate(t.shotId, pr.id, { source: t, parentTakeId: t.id, seed: t.seed, height: t.height }); };
  const job = useJobs((s) => s.jobs.find((j) => j.takeId === t.id));
  return <div className={`rounded border p-1 ${cur === t.id ? 'border-accent' : cmp === t.id ? 'border-claude' : 'border-line'}`} data-testid="take-card" data-status={t.status}>
    <button className="relative block w-full" style={{ aspectRatio: String(ASPECTS[S().project.aspect]) }} onClick={() => S().set({ currentTakeId: t.id })} title="Show in Result view">
      {t.frames.length ? <img alt={`Take ${n}`} src={frameUrl(t.frames[Math.floor(t.frames.length / 2)])} className="h-full w-full rounded object-cover" /> : t.videoUrl ? <video src={t.videoUrl} className="h-full w-full rounded object-cover" muted loop autoPlay /> : <div className="flex h-full items-center justify-center rounded bg-raised text-xxs text-dim">{t.status}{job && t.status === 'running' ? ` ${Math.round(job.progress * 100)}%` : ''}</div>}
      {t.circled && <span className="absolute left-1 top-1 rounded-full border-2 border-warn px-1 text-xxs text-warn">◎</span>}
      {t.critique && <span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-xxs text-white">{t.critique.overall.toFixed(1)}</span>}
    </button>
    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xxs"><b>#{n}</b><span className="text-dim">{t.providerId} · seed {t.seed}{t.cost ? ` · $${t.cost.toFixed(2)}` : ''}</span>{t.iou !== undefined && <span className="chip" title="Mask IoU vs the blockout (local, model-free)">IoU {(t.iou * 100).toFixed(0)}%</span>}{t.parentTakeId && <span className="chip">derived</span>}</div>
    {t.error && <p className="text-xxs text-bad">{t.error}</p>}
    <div className="mt-0.5 flex flex-wrap gap-0.5">
      {t.status === 'done' && <><button className={`btn !px-1 ${t.circled ? 'text-warn' : ''}`} data-testid="circle-take" onClick={() => up({ circled: !t.circled }, t.circled ? 'Uncircle take' : 'Circle take')}>◎</button>
        <button className="btn !px-1" title="Use in the cut" data-testid="select-take" onClick={() => shot && S().dispatch({ type: 'updateShot', id: shot.id, patch: { selectedTakeId: t.id } }, { label: 'Select take for the cut' })}>{shot?.selectedTakeId === t.id ? '✓ in cut' : 'Use'}</button>
        <button className="btn !px-1" title="A/B compare with the current take" onClick={() => S().set({ compareTakeId: cmp === t.id ? null : t.id })}>A/B</button>
        <button className="btn-claude !px-1" data-testid="critique-take" onClick={() => void critique(t.id)}>Critique</button>
        <button className="btn !px-1" onClick={() => setOpen(!open)}>⋯</button></>}
      {(t.status === 'queued' || t.status === 'running') && job && <button className="btn !px-1" onClick={() => cancelJob(job.id)}>Cancel</button>}
    </div>
    {open && <div className="mt-0.5 flex flex-wrap gap-0.5"><button className="btn !px-1" onClick={() => void generate(t.shotId, t.providerId, { seed: t.seed + 1 })}>New seed</button><button className="btn !px-1" onClick={() => fix('upscale')}>Upscale</button><button className="btn !px-1" onClick={() => fix('interpolate')}>Interpolate</button><button className="btn !px-1" onClick={() => setMask(true)}>Inpaint…</button><button className="btn !px-1" onClick={() => void autoScore(t.id)}>Rescore</button><button className="btn !px-1 text-bad" onClick={() => S().dispatch({ type: 'removeTake', id: t.id })}>Delete</button></div>}
    {mask && <MaskPainter take={t} onDone={(m) => { setMask(false); if (m) void generate(t.shotId, 'mock-inpaint', { source: t, mask: m, parentTakeId: t.id, seed: t.seed + 17, height: t.height }); }} />}
    {t.critique && <details className="mt-0.5 text-xxs"><summary className="cursor-pointer text-claude">Critique {t.critique.overall}/10</summary><p>{t.critique.summary}</p><p className="text-dim">staging {t.critique.staging} · character {t.critique.character} · style {t.critique.style} · artifacts {t.critique.artifacts}</p><ul className="list-disc pl-3">{t.critique.issues.map((i, k) => <li key={k} className={i.severity === 'high' ? 'text-bad' : ''}>{i.t !== undefined ? `${i.t}s · ` : ''}{i.note}</li>)}</ul><ul className="list-disc pl-3 text-good">{t.critique.fixes.map((f, k) => <li key={k}>{f.kind}: {f.description}{f.kind === 'seed' && <button className="ml-1 underline" onClick={() => void generate(t.shotId, t.providerId, { seed: t.seed + 101 })}>try</button>}</li>)}</ul></details>}
    <textarea aria-label="Take notes" className="inp mt-0.5 !text-xxs" rows={1} placeholder="notes" defaultValue={t.notes} onBlur={(e) => e.target.value !== t.notes && up({ notes: e.target.value }, 'Take notes')} onKeyDown={(e) => e.stopPropagation()} />
  </div>;
}
export function TakesPanel() {
  const project = useStudio((s) => s.project), shot = useStudio(activeShot), connected = useGateway((g) => g.connected), [prov, setProv] = useState('mock'), [height, setHeight] = useState(360), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState<string | null>(null), jobs = useJobs((s) => s.jobs), httpN = useJobs((s) => s.httpConfigs.length), [cfg, setCfg] = useState<string | null>(null);
  useEffect(() => { if (connected) void loadHttpProviders(); }, [connected]);
  const list = useMemo(() => providers('video'), [httpN]), pr = list.find((x) => x.id === prov) ?? list[0], imgPr = providers('image')[0];
  const takes = useMemo(() => Object.values(project.takes).filter((t) => t.shotId === shot?.id).sort((a, b) => a.at - b.at), [project.takes, shot?.id]);
  const spent = Object.values(project.takes).reduce((a, t) => a + t.cost, 0), est = shot && pr ? estimate(shot, pr, height) : null, allProposals = useStudio((s) => s.proposals), pendingGen = useMemo(() => allProposals.filter((p) => p.status === 'pending' && p.kind === 'generation'), [allProposals]);
  const keyTake = takes.find((t) => t.providerId === imgPr?.id && t.status === 'done' && t.id === shot?.keyframeApproved);
  const run = async () => { if (!shot || !pr) return; setConfirm(false); await generate(shot.id, pr.id, { height, keyframeTakeId: shot.twoStage ? shot.keyframeApproved : undefined }); };
  if (!shot) return <div className="p-3 text-dim">Select a shot.</div>;
  return <div className="h-full overflow-auto" data-testid="takes-panel">
    <Section title={`Generate · ${shot.name}`}>
      {pendingGen.map((g) => <div key={g.id} className="mb-1 rounded border border-claude/60 p-1 text-xxs">Claude asked to generate {project.shots.find((s) => s.id === g.meta?.shotId)?.name} with {String(g.meta?.providerId)}. <button className="btn-claude !px-1" onClick={() => { S().applyProposal(g.id, []); void generate(String(g.meta!.shotId), String(g.meta!.providerId)); }}>Confirm</button> <button className="btn !px-1" onClick={() => S().rejectProposal(g.id)}>Decline</button></div>)}
      <div className="flex gap-1"><select aria-label="Provider" data-testid="provider-select" className="inp" value={pr?.id} onChange={(e) => setProv(e.target.value)}>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><select aria-label="Resolution" className="inp !w-20" value={height} onChange={(e) => setHeight(+e.target.value)}>{[180, 360, 540, 720, 1080].map((v) => <option key={v} value={v}>{v}p</option>)}</select></div>
      {pr && <p className="mt-0.5 text-xxs text-dim">{pr.description} Controls: {pr.caps.controls.join(', ')}. Max {pr.caps.maxDuration}s.{shot.end - shot.start > pr.caps.maxDuration ? <span className="text-warn"> Shot is longer than this provider allows.</span> : null}</p>}
      {shot.twoStage && imgPr && <div className="mt-1 rounded border border-line p-1 text-xxs"><b>Two-stage:</b> {keyTake ? <>keyframe approved <img alt="" src={frameUrl(keyTake.frames[0])} className="inline h-8 rounded" /></> : <>generate a styled keyframe, then approve it.</>}
        <div className="mt-0.5 flex flex-wrap gap-1"><button className="btn !px-1" onClick={() => void generate(shot.id, imgPr.id, { height })}>Keyframe with {imgPr.name}</button>{takes.filter((t) => t.providerId === imgPr.id && t.status === 'done').map((t) => <button key={t.id} className={`rounded border ${shot.keyframeApproved === t.id ? 'border-good' : 'border-line'}`} title="Approve this keyframe" onClick={() => S().dispatch({ type: 'updateShot', id: shot.id, patch: { keyframeApproved: t.id } }, { label: 'Approve keyframe' })}><img alt="keyframe" src={frameUrl(t.frames[0])} className="h-10 rounded" /></button>)}</div></div>}
      {est && <p className={`mt-1 text-xxs ${!est.ok ? 'text-bad' : est.warn ? 'text-warn' : 'text-dim'}`} data-testid="cost-estimate">Estimate ${est.estimate.toFixed(2)} · project ${spent.toFixed(2)} of ${project.budgetCap.toFixed(2)} cap{est.message ? ` — ${est.message}` : ''}</p>}
      {!confirm ? <button className="btn-primary mt-1" data-testid="generate" disabled={!pr || !est?.ok || (shot.twoStage && !shot.keyframeApproved && pr.caps.modes.includes('image-to-video') && false)} onClick={() => setConfirm(true)}>Generate take…</button>
        : <div className="mt-1 flex items-center gap-1 rounded border border-warn/60 p-1 text-xxs"><span>Run {pr?.name} for ~${est?.estimate.toFixed(2)}?</span><button className="btn-primary" data-testid="generate-confirm" onClick={() => void run()}>Confirm</button><button className="btn" onClick={() => setConfirm(false)}>Cancel</button></div>}
      {jobs.filter((j) => j.status === 'queued' || j.status === 'running').length > 0 && <ul className="mt-1 text-xxs">{jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => <li key={j.id}>{project.shots.find((s) => s.id === j.shotId)?.name} · {j.providerId} · {j.status} {Math.round(j.progress * 100)}% {j.note} <button className="text-bad underline" onClick={() => cancelJob(j.id)}>cancel</button></li>)}</ul>}
    </Section>
    <Section title={`Takes (${takes.length})`}>{takes.length ? <div className="grid grid-cols-2 gap-1" data-testid="takes-grid">{takes.map((t, i) => <TakeCard key={t.id} t={t} n={i + 1} />)}</div> : <p className="text-dim">No takes yet.</p>}
      {takes.length > 0 && <p className="mt-1 text-xxs text-dim">Click a take to view it; A/B sets the comparison (drag the split in Result); the Result header slider overlays the blockout.</p>}</Section>
    <Section title="Assembly & export">
      <p className="mb-1 text-xxs text-dim">The cut uses each shot's selected (✓) or circled (◎) take, falling back to the blockout clay pass, with the shot strip's trims and crossfades.</p>
      <div className="flex flex-wrap gap-1">
        <button className="btn-primary" data-testid="render-cut" disabled={!!busy} onClick={async () => { setBusy('cut'); try { const r = await renderCut(540, (d, t) => S().notify(`Rendering cut ${Math.round((d / t) * 100)}%`)); download(`${project.name.replace(/\W+/g, '-')}-cut.${r.ext}`, r.bytes); S().notify(`Cut rendered: ${r.frames} frames (${r.ext}${r.audio ? `, audio ${r.audio}` : ', no audio tracks'}).`); } catch (e) { S().notify((e as Error).message, 'error'); } setBusy(null); }}>{busy === 'cut' ? 'Rendering…' : 'Render final cut'}</button>
        <button className="btn" data-testid="export-otio" onClick={() => download('cut.otio', exportOTIO(), 'application/json')}>OTIO</button>
        <button className="btn" onClick={() => download('cut.fcpxml', exportFCPXML(), 'application/xml')}>FCPXML</button>
        <button className="btn" onClick={() => download('cut.edl', exportEDL(), 'text/plain')}>EDL</button>
        <button className="btn" onClick={() => download('scene.usda', exportUSD(), 'text/plain')}>USD</button>
        <button className="btn" onClick={async () => download('scene.glb', new Uint8Array(await exportGLTF()))}>glTF</button>
        <button className="btn-claude" data-testid="export-storyboard" disabled={!!busy} onClick={async () => { setBusy('sb'); try { download('storyboard.pdf', await exportStoryboard(), 'application/pdf'); } finally { setBusy(null); } }}>{busy === 'sb' ? 'Writing…' : 'Storyboard PDF'}</button>
      </div>
    </Section>
    <Section title="Providers" right={connected ? <button className="btn" onClick={() => setCfg(cfg === null ? JSON.stringify({ id: 'my-video', name: 'My video API', dialect: 'seedance', controls: ['firstFrame'], maxDuration: 10, costPerSecond: 0.1, submit: { url: 'https://api.example.com/v1/video', headers: { authorization: 'Bearer {{secret:MY_VIDEO_KEY}}' }, body: { prompt: '{{prompt}}', negative_prompt: '{{negative}}', seed: '{{seed}}', duration: '{{duration}}', image: 'data:image/png;base64,{{firstFrame}}' } }, poll: { url: 'https://api.example.com/v1/video/{{id}}', idPath: 'id', statusPath: 'status' }, resultPath: 'output.url' }, null, 1) : null)}>+ HTTP provider</button> : undefined}>
      <ul className="text-xxs">{list.map((x) => <li key={x.id}><b>{x.name}</b> <span className="text-dim">({x.id}, dialect {x.dialect})</span></li>)}</ul>
      {!connected && <p className="text-xxs text-dim">Start the bridge to add your own HTTP providers (Seedance, H3, …); their keys live in the bridge keychain and are referenced as {'{{secret:NAME}}'}.</p>}
      {cfg !== null && <div className="mt-1"><textarea aria-label="HTTP provider config" className="inp h-48 font-mono !text-xxs" value={cfg} onChange={(e) => setCfg(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <div className="mt-1 flex gap-1"><button className="btn-primary" onClick={async () => { try { await rpc('providers.save', { config: JSON.parse(cfg) }); await loadHttpProviders(); setCfg(null); S().notify('Provider saved in the bridge.'); } catch (e) { S().notify((e as Error).message, 'error'); } }}>Save</button><SecretSetter /></div></div>}
    </Section>
  </div>;
}
function SecretSetter() { const [n, setN] = useState(''), [v, setV] = useState(''); return <span className="flex gap-1"><input aria-label="Secret name" className="inp !w-28" placeholder="SECRET_NAME" value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /><input aria-label="Secret value" type="password" className="inp !w-28" placeholder="value" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /><button className="btn" disabled={!n || !v} onClick={async () => { await rpc('secrets.set', { name: n, value: v }); setV(''); S().notify(`${n} stored in the bridge keychain.`); }}>Store key</button></span>; }
