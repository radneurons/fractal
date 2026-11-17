// Application core: song loading, lyrics, project state changes and the render loop. No DOM widgets here.
import type { Analysis, GlobalSettings, Layer, Lane, Lyrics, ModRoute, ParamValue, PlanSegment, Post, Section, Song, TransitionKind } from './types.ts';
import { Stage } from './stage.ts';
import { Player } from './player.ts';
import { type AppState, defaultState, ensureInstance, planInstance } from './project/state.ts';
import { analyseBuffer, sha256 } from './analysis/client.ts';
import { parseLyrics } from './lyrics/parse.ts';
import { buildLyrics, attachTranslation, refreshLines, finaliseWords, toEnhancedLrc } from './lyrics/build.ts';
import { direct, fuseLyricStructure } from './director/director.ts';
import { readTags } from './media/id3.ts';
import { paletteFromImage } from './media/artwork.ts';
import { effectMeta, effectIds } from './effects/registry.ts';
import { loadFonts } from './render/sdf.ts';

export type Listener = (what: string) => void;

export class App {
  state: AppState = defaultState();
  readonly stage: Stage;
  readonly player = new Player();
  song: Song | null = null;
  audioBlob: Blob | null = null;
  audioHash = '';
  lyricsText = '';
  translationText = '';
  /** sections straight from the audio analysis (before lyric fusion) */
  private baseSections: Section[] = [];
  private listeners = new Set<Listener>();
  private prepTimer = 0;
  private raf = 0;
  busy: { msg: string; p: number } | null = null;
  ready: Promise<void>;
  lastError = '';
  /** export in progress: the preview loop stays out of the way */
  exporting = false;
  /** live mode owns the stage (live/runtime.ts drives it) */
  live = false;

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas, this.state);
    this.ready = loadFonts().then(() => this.stage.prepare());
    this.player.onState = () => { this.stage.playing = this.player.playing; this.emit('transport'); };
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (this.exporting || this.live || !this.song) return;
      this.stage.media.syncPreview(this.state.layers, this.player.time, this.player.playing);
      this.stage.renderAt(this.player.time);
      this.emit('frame');
    };
    this.raf = requestAnimationFrame(loop);
  }

  on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what: string): void { for (const l of this.listeners) l(what); }
  setBusy(msg: string | null, p = 0): void { this.busy = msg ? { msg, p } : null; this.emit('busy'); }

  // ---------- loading ----------
  async loadAudio(blob: Blob, name: string, opts: { lyricsText?: string; keepLyrics?: boolean } = {}): Promise<void> {
    this.setBusy('Decoding audio…', 0);
    try {
      const bytes = await blob.arrayBuffer();
      const tags = readTags(bytes);
      const hash = await sha256(bytes);
      const audio = await this.player.ctx.decodeAudioData(bytes.slice(0));
      const analysis = await analyseBuffer(audio, { hash, onProgress: (stage, p) => this.setBusy(`Analysing: ${stage}`, p) });
      this.baseSections = analysis.sections;
      this.audioBlob = blob; this.audioHash = hash;
      const s = this.state.settings;
      s.title = tags.title ?? name.replace(/\.[a-z0-9]+$/i, '');
      s.artist = tags.artist ?? '';
      this.song = { name, audio, analysis, lyrics: { words: [], lines: [], source: 'plain' }, stamp: Date.now() };
      this.stage.artwork = null;
      if (tags.picture) {
        try { const bmp = await createImageBitmap(tags.picture); this.stage.artwork = paletteFromImage(bmp); this.song.artwork = bmp; this.stage.media.addBitmap('artwork', bmp); } catch { /* unreadable artwork */ }
      }
      this.player.setBuffer(audio);
      this.player.beats = analysis.beats; this.player.downbeats = analysis.downbeats;
      const text = opts.lyricsText ?? (opts.keepLyrics ? this.lyricsText : tags.lyrics ?? '');
      this.lyricsText = text;
      this.setLyricsFromText(text, false);
      this.stage.setSong(this.song);
      await this.stage.prepare();
      this.emit('song');
    } catch (e) {
      this.lastError = String((e as Error).message ?? e);
      this.emit('error');
      throw e;
    } finally { this.setBusy(null); }
  }

  async loadDemo(name = 'demo-song'): Promise<void> {
    const base = `./demo/${name}`;
    const [wav, lrc] = await Promise.all([fetch(`${base}.wav`).then((r) => r.blob()), fetch(`${base}.lrc`).then((r) => r.text())]);
    await this.loadAudio(wav, `${name}.wav`, { lyricsText: lrc });
    if (this.song) this.song.lyrics.source = 'demo';
    if (name === 'demo-waltz') {
      const tr = await fetch(`${base}.translation.txt`).then((r) => (r.ok ? r.text() : ''));
      if (tr) this.applyTranslation(tr);
    }
  }

  // ---------- lyrics ----------
  private setLyricsFromText(text: string, notify = true): void {
    const song = this.song;
    if (!song) return;
    const parsed = parseLyrics(text);
    const a0: Analysis = { ...song.analysis, sections: this.baseSections };
    const ly = buildLyrics(parsed, a0);
    if (parsed.meta.title) this.state.settings.title = parsed.meta.title;
    if (parsed.meta.artist) this.state.settings.artist = parsed.meta.artist;
    this.commitLyrics(ly, parsed.format !== 'plain', notify);
  }

  /** Install lyrics: fuse lyric structure into the sections, run the Director, bump the stamp. */
  commitLyrics(ly: Lyrics, trustTiming: boolean, notify = true): void {
    const song = this.song;
    if (!song) return;
    const a0: Analysis = { ...song.analysis, sections: this.baseSections };
    refreshLines(ly, a0);
    const sections = ly.lines.length ? fuseLyricStructure(a0, ly, trustTiming) : this.baseSections;
    song.analysis = { ...a0, sections };
    refreshLines(ly, song.analysis);
    direct(ly, song.analysis);
    if (this.translationText) attachTranslation(ly, this.translationText);
    song.lyrics = ly;
    song.stamp++;
    this.stage.setSong(song);
    if (notify) { this.schedulePrepare(0); this.emit('lyrics'); }
  }

  applyLyrics(text: string): void { this.lyricsText = text; this.setLyricsFromText(text); }
  applyTranslation(text: string): void {
    this.translationText = text;
    if (!this.song) return;
    attachTranslation(this.song.lyrics, text);
    if (text && this.state.settings.showTranslation === 'off') this.state.settings.showTranslation = 'under';
    this.touchLyrics(false);
  }
  /** Call after editing word times / roles in place. */
  touchLyrics(redirect = true): void {
    const song = this.song;
    if (!song) return;
    refreshLines(song.lyrics, song.analysis);
    if (redirect) { finaliseWords(song.lyrics, song.analysis); direct(song.lyrics, song.analysis); }
    song.stamp++;
    this.stage.setSong(song);
    this.schedulePrepare();
    this.emit('lyrics');
  }
  exportLrc(): string { return this.song ? toEnhancedLrc(this.song.lyrics, { title: this.state.settings.title, artist: this.state.settings.artist }) : ''; }

  // ---------- state changes ----------
  /** Debounced re-prepare (non-live parameters, size, lyrics…). */
  schedulePrepare(ms = 250): void {
    clearTimeout(this.prepTimer);
    this.prepTimer = window.setTimeout(() => { void this.stage.prepare().then(() => this.emit('prepared')); }, ms);
  }
  whenReady(): Promise<void> {
    return new Promise((res) => setTimeout(res, 0)).then(() => { clearTimeout(this.prepTimer); return this.stage.prepare(); });
  }

  setEffect(id: string): void {
    if (!effectIds().includes(id)) throw new Error(`unknown effect ${id}`);
    this.state.plan.effect = id; this.state.plan.mode = 'single';
    ensureInstance(this.state, planInstance(id), id);
    this.schedulePrepare(0); this.emit('plan');
  }
  setMode(mode: 'single' | 'director' | 'custom', transition?: TransitionKind): void {
    this.state.plan.mode = mode;
    if (transition) this.state.plan.transition = transition;
    this.schedulePrepare(0); this.emit('plan');
  }
  setPlan(segments: PlanSegment[], transition?: TransitionKind): void {
    this.state.plan.mode = 'custom';
    this.state.plan.segments = segments.map((s) => ({ ...s }));
    if (transition) this.state.plan.transition = transition;
    for (const s of segments) ensureInstance(this.state, planInstance(s.effect), s.effect);
    this.schedulePrepare(0); this.emit('plan');
  }
  /** `target` is an instance id ("plan:broadside", a layer instance) or a bare effect id. */
  setParam(target: string, key: string, value: ParamValue): void {
    const instanceId = this.state.instances[target] || target.includes(':') ? target : planInstance(target);
    const effect = this.state.instances[instanceId]?.effect ?? target.replace(/^plan:/, '');
    const inst = ensureInstance(this.state, instanceId, effect);
    inst.params[key] = value;
    const spec = effectMeta(effect)?.params.find((p) => p.key === key);
    if (!spec || !spec.live) this.schedulePrepare();
    this.emit('param');
  }
  setSetting<K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]): void {
    this.state.settings[key] = value;
    const live: (keyof GlobalSettings)[] = ['intensity', 'cameraEnergy', 'reactivity', 'flashGuard'];
    if (!live.includes(key)) this.schedulePrepare();
    if (key === 'seed' || key === 'syncOffsetMs') this.stage.setSong(this.song);
    this.emit('settings');
  }
  setLayers(layers: Layer[]): void {
    this.state.layers = layers;
    this.stage.state = this.state;
    for (const l of layers) if (l.kind === 'effect' && l.effect) ensureInstance(this.state, l.instanceId, l.effect);
    this.schedulePrepare(0); this.emit('layers');
  }
  setPost(p: Partial<Post>): void { Object.assign(this.state.post, p); this.emit('post'); }
  addRoute(r: ModRoute): void { this.state.routes = [...this.state.routes.filter((x) => x.id !== r.id), r]; this.emit('routes'); }
  removeRoute(id: string): void { this.state.routes = this.state.routes.filter((x) => x.id !== id); this.emit('routes'); }
  setLane(lane: Lane): void {
    const same = (x: Lane) => x.target.instanceId === lane.target.instanceId && x.target.key === lane.target.key;
    this.state.lanes = [...this.state.lanes.filter((x) => !same(x)), ...(lane.keys.length ? [lane] : [])];
    this.emit('lanes');
  }
  /** Replace the whole project state (project open, undo, preset apply). */
  replaceState(next: AppState): void {
    this.state = next;
    this.stage.state = next;
    this.stage.setSong(this.song);
    this.schedulePrepare(0);
    this.emit('state');
  }

  renderAt(t: number): void { this.stage.renderAt(t); }
  dispose(): void { cancelAnimationFrame(this.raf); this.stage.dispose(); }
}
