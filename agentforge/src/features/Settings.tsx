import { useRef, useState } from 'react';
import { useLearner, exportData } from '@/store/learner';
import { DEFAULT_MODELS, complete, providerReady } from '@/core/ai/provider';
import { CURRICULUM_VERSION, validateCurriculum } from '@/core/registry';
import type { Settings as S } from '@/core/types';
import { Icon, Modal, PageHeader, Seg, useToast } from '@/ui/kit';
import { navigate } from '@/ui/router';

export default function Settings() {
  const settings = useLearner((s) => s.settings);
  const set = useLearner((s) => s.setSettings);
  const provider = useLearner((s) => s.provider);
  const setProvider = useLearner((s) => s.setProvider);
  const profile = useLearner((s) => s.profile);
  const importAll = useLearner((s) => s.importAll);
  const resetAll = useLearner((s) => s.resetAll);
  const { toast } = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const report = validateCurriculum();

  return (
    <div className="stack lg" style={{ maxWidth: 900 }}>
      <PageHeader eyebrow="Settings" title="Preferences, AI provider & data" />

      <section className="card stack">
        <div className="card-title">Display & accessibility</div>
        <div className="field">Theme<Seg label="Theme" value={settings.theme} onChange={(theme: S['theme']) => set({ theme })} options={[{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'contrast', label: 'High contrast' }]} /></div>
        <label className="field">Text size: {Math.round(settings.textScale * 100)}%<input type="range" min={0.9} max={1.3} step={0.05} value={settings.textScale} onChange={(e) => set({ textScale: +e.target.value })} /></label>
        <label className="switch"><input type="checkbox" checked={settings.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.checked })} /> Reduced motion (also respects your OS setting)</label>
        <label className="switch"><input type="checkbox" checked={settings.focusMode} onChange={(e) => set({ focusMode: e.target.checked })} /> Focus Mode — narrower reading column, no ambient animation</label>
        <label className="switch"><input type="checkbox" checked={settings.sound} onChange={(e) => set({ sound: e.target.checked })} /> Subtle sound effects</label>
        <div className="field">Knowledge Universe default view<Seg label="Universe view" value={settings.universeView} onChange={(universeView: S['universeView']) => set({ universeView })} options={[{ id: '3d', label: '3D' }, { id: '2d', label: 'Accessible list' }]} /></div>
        <div className="field">Hints<Seg label="Hint policy" value={settings.hintPolicy} onChange={(hintPolicy: S['hintPolicy']) => set({ hintPolicy })} options={[{ id: 'ladder', label: 'Graduated hint ladder' }, { id: 'off', label: 'No hints (harder)' }]} /></div>
        <div className="tiny faint">Keyboard: <span className="kbd">Ctrl/⌘ K</span> search · <span className="kbd">Ctrl/⌘ .</span> Forge Guide · <span className="kbd">A–D</span> choose options · <span className="kbd">Tab</span> moves focus. Every drag interaction has buttons.</div>
      </section>

      <section className="card stack">
        <div className="card-title">Learning profile</div>
        {profile ? (
          <div className="row">
            <span className="chip">Level: {profile.level}</span><span className="chip">Path: {profile.path}</span><span className="chip">{profile.minutesPerSession} min × {profile.sessionsPerWeek}/week</span>
            <button className="btn sm" onClick={() => navigate('/onboarding')}>Change goals / retake diagnostic</button>
          </div>
        ) : <button className="btn primary" onClick={() => navigate('/onboarding')}>Set up profile</button>}
      </section>

      <section className="card stack">
        <div className="card-title">AI provider (optional)</div>
        <div className="callout warn small">
          <b>Everything works without this.</b> If you add a key, it is stored only in this browser (IndexedDB), sent only to the provider you choose, and never exported. Browser-held keys can be read by anyone with access to this device or by malicious browser extensions — use a key with a spending limit, and for anything public use a backend proxy (see docs/PROVIDERS.md). When connected, lesson context and your text are sent to the provider for mentor replies, live prompt runs and optional interview grading.
        </div>
        <div className="field">Provider<Seg label="Provider" value={provider.provider} onChange={(p) => setProvider({ provider: p, model: p === 'anthropic' ? provider.model || DEFAULT_MODELS.anthropic : p === 'openai' ? '' : '' })} options={[{ id: 'none', label: 'None (offline)' }, { id: 'anthropic', label: 'Anthropic (Claude)' }, { id: 'openai', label: 'OpenAI' }]} /></div>
        {provider.provider !== 'none' && (
          <>
            <label className="field">API key<input className="input mono" type="password" autoComplete="off" value={provider.apiKey} onChange={(e) => setProvider({ apiKey: e.target.value })} placeholder={provider.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'} /></label>
            <label className="field">Model id<input className="input mono" value={provider.model} onChange={(e) => setProvider({ model: e.target.value })} placeholder={provider.provider === 'anthropic' ? DEFAULT_MODELS.anthropic : 'enter a model id your key can use'} /></label>
            <div className="tiny faint">{provider.provider === 'anthropic' ? `Default: ${DEFAULT_MODELS.anthropic}. Check the Claude docs for current model ids.` : 'We don\'t guess OpenAI model names — enter one listed in your OpenAI dashboard / docs.'}</div>
            <label className="switch"><input type="checkbox" checked={provider.consent} onChange={(e) => setProvider({ consent: e.target.checked })} /> I understand my text and lesson context will be sent to {provider.provider} when I use AI features.</label>
            <div className="row">
              <button className="btn" disabled={!providerReady(provider)} onClick={async () => { setTestMsg('Testing…'); try { const r = await complete(provider, { system: 'Reply with exactly: OK', messages: [{ role: 'user', content: 'Connection test' }], maxTokens: 50 }); setTestMsg(`✓ Connected · ${r.model} replied "${r.text.slice(0, 40)}"`); } catch (e) { setTestMsg(`✗ ${(e as Error).message}`); } }}>Test connection</button>
              <button className="btn ghost" onClick={() => { setProvider({ provider: 'none', apiKey: '', model: '', consent: false }); setTestMsg(''); toast('Key removed'); }}><Icon name="trash" /> Remove key</button>
              <span className="small">{testMsg}</span>
            </div>
          </>
        )}
      </section>

      <section className="card stack">
        <div className="card-title">Your data</div>
        <p className="small muted" style={{ margin: 0 }}>Progress, notes and projects are stored locally in this browser. Export to back up or move devices; the export never includes API keys.</p>
        <div className="row">
          <button className="btn" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportData()], { type: 'application/json' })); a.download = `agentforge-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); }}><Icon name="download" /> Export everything (JSON)</button>
          <button className="btn" onClick={() => file.current?.click()}><Icon name="upload" /> Import backup</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { const j = JSON.parse(await f.text()); if (j.app !== 'agentforge') throw new Error('Not an AgentForge export'); importAll(j.data); toast('Backup imported'); } catch (err) { toast(`Import failed: ${(err as Error).message}`); }
            e.target.value = '';
          }} />
          <button className="btn danger" onClick={() => setConfirmReset(true)}><Icon name="trash" /> Delete all my data</button>
        </div>
      </section>

      <section className="card stack sm">
        <div className="card-title">About this build</div>
        <div className="small">Curriculum {CURRICULUM_VERSION} · {report.counts.schools} schools · {report.counts.skills} skills · {report.counts.lessons} lessons · {report.counts.items} assessment items ({Object.entries(report.counts.itemTypes).map(([k, v]) => `${v} ${k}`).join(', ')})</div>
        <div className="small">{report.errors.length ? `⚠ ${report.errors.length} curriculum validation errors` : '✓ Curriculum validated at startup (schema, prerequisites DAG, answer keys).'}</div>
      </section>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Delete all data?">
        <p className="small">This permanently removes your progress, evidence, notes, projects and saved key from this browser. Consider exporting first.</p>
        <div className="row"><button className="btn danger" onClick={() => { resetAll(); setConfirmReset(false); toast('All data deleted'); navigate('/'); }}>Delete everything</button><button className="btn ghost" onClick={() => setConfirmReset(false)}>Cancel</button></div>
      </Modal>
    </div>
  );
}
