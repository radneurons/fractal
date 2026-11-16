declare module 'hyphen/*' {
  const h: { hyphenateSync(text: string, opts?: { hyphenChar?: string; minWordLength?: number }): string };
  export default h;
}
declare module 'gifenc' {
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, w: number, h: number, opts?: { palette?: number[][]; delay?: number; repeat?: number; transparent?: boolean; dispose?: number; first?: boolean }): void;
    finish(): void; bytes(): Uint8Array; bytesView(): Uint8Array;
  };
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: Record<string, unknown>): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
}
