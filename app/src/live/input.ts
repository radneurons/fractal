// Live input (SPEC §14.1): microphone / line in (echo cancellation, noise suppression and AGC off), a browser tab's
// audio (getDisplayMedia), or — for rehearsal and tests — the loaded song played through the speakers.
export type LiveSourceKind = 'mic' | 'tab' | 'file';

export interface LiveInput {
  kind: LiveSourceKind;
  label: string;
  ctx: AudioContext;
  node: AudioNode;
  /** seconds from sound at the input to the analyser seeing it, before analysis look-ahead */
  inputLatency(): number;
  /** start the source (rehearsal playback starts here, after the analysis tap is connected, so clocks agree) */
  begin(): void;
  stop(): void;
}

export async function listInputs(): Promise<MediaDeviceInfo[]> {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch { return []; }
}

export async function openInput(kind: LiveSourceKind, opts: { deviceId?: string; buffer?: AudioBuffer | null; offset?: number } = {}): Promise<LiveInput> {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') await ctx.resume();
  const base = () => (ctx.baseLatency || 128 / ctx.sampleRate) + 512 / ctx.sampleRate; // worklet batching
  if (kind === 'file') {
    if (!opts.buffer) { await ctx.close(); throw new Error('Load a song first to rehearse with it.'); }
    const src = ctx.createBufferSource();
    src.buffer = opts.buffer;
    src.connect(ctx.destination); // the operator hears the rehearsal
    let started = false;
    return { kind, label: 'Rehearsal (loaded song)', ctx, node: src, inputLatency: base, begin: () => { if (!started) { started = true; src.start(0, opts.offset ?? 0); } }, stop: () => { try { src.stop(); } catch { /* stopped */ } void ctx.close(); } };
  }
  let stream: MediaStream;
  if (kind === 'mic') {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } });
  } else {
    // Chrome only shares tab audio alongside video; the video track is dropped at once
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true } as DisplayMediaStreamOptions);
    for (const t of stream.getVideoTracks()) { t.stop(); stream.removeTrack(t); }
    if (!stream.getAudioTracks().length) { await ctx.close(); throw new Error('No audio was shared. Tick "Share tab audio" in the picker.'); }
  }
  const node = ctx.createMediaStreamSource(stream);
  const track = stream.getAudioTracks()[0];
  const trackLatency = () => { const st = track.getSettings() as MediaTrackSettings & { latency?: number }; return typeof st.latency === 'number' ? st.latency : 0.01; };
  return {
    kind, label: track.label || (kind === 'mic' ? 'Microphone' : 'Tab audio'), ctx, node,
    inputLatency: () => base() + trackLatency(),
    begin: () => {},
    stop: () => { for (const t of stream.getTracks()) t.stop(); void ctx.close(); },
  };
}
