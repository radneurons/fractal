// Minimal WebCodecs audio typings (not yet in TypeScript's DOM lib).
interface AudioEncoderConfig { codec: string; sampleRate: number; numberOfChannels: number; bitrate?: number }
interface AudioDataInit { format: 'f32-planar' | 'f32' | 's16' | 's16-planar'; sampleRate: number; numberOfFrames: number; numberOfChannels: number; timestamp: number; data: BufferSource }
declare class AudioData { constructor(init: AudioDataInit); close(): void; readonly duration: number }
declare class EncodedAudioChunk { readonly byteLength: number; readonly timestamp: number; readonly duration: number | null; readonly type: 'key' | 'delta'; copyTo(dest: BufferSource): void }
interface EncodedAudioChunkMetadata { decoderConfig?: { codec: string; sampleRate: number; numberOfChannels: number; description?: BufferSource } }
declare class AudioEncoder {
  constructor(init: { output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void; error: (e: DOMException) => void });
  configure(c: AudioEncoderConfig): void; encode(d: AudioData): void; flush(): Promise<void>; close(): void;
  readonly encodeQueueSize: number;
  static isConfigSupported(c: AudioEncoderConfig): Promise<{ supported: boolean; config: AudioEncoderConfig }>;
}
