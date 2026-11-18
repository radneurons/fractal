/** Fat line that keeps one material for its whole life and only refreshes positions when points change.
 *  (drei's <Line> rebuilds geometry *and disposes its material* whenever the points array identity changes,
 *  which recompiles the shader every frame for animated overlays.) */
import React, { useEffect, useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export interface SLineProps { points: readonly (readonly number[])[]; color?: string; lineWidth?: number; dashed?: boolean; dashSize?: number; gapSize?: number; transparent?: boolean; opacity?: number }
export function SLine({ points, color = '#ffffff', lineWidth = 1, dashed = false, dashSize = 1, gapSize = 1, transparent = false, opacity = 1 }: SLineProps) {
  const size = useThree((s) => s.size), line = useMemo(() => new Line2(new LineGeometry(), new LineMaterial({ worldUnits: false })), []);
  const flat = useMemo(() => points.flatMap((p) => [p[0], p[1], p[2]]), [points]), sig = flat.length ? `${flat.length}:${flat[0]}:${flat[flat.length - 1]}:${flat.reduce((a, v) => a + v, 0)}` : '0';
  useLayoutEffect(() => {
    if (flat.length < 6) return; const n = flat.length / 3 - 1, start = line.geometry.getAttribute('instanceStart') as unknown as { data?: { array: Float32Array; needsUpdate: boolean } } | undefined;
    if (start?.data && start.data.array.length === n * 6) { // same topology: rewrite the segment buffer in place (no allocation)
      const a = start.data.array; for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { a[i * 6 + k] = flat[i * 3 + k]; a[i * 6 + 3 + k] = flat[i * 3 + 3 + k]; } start.data.needsUpdate = true; line.geometry.computeBoundingSphere();
    } else { const g = new LineGeometry(); g.setPositions(flat); const old = line.geometry; line.geometry = g; old.dispose(); }
    if (dashed) line.computeLineDistances();
  }, [sig, dashed]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const m = line.material; m.color.set(color); m.linewidth = lineWidth; m.dashed = dashed; m.dashSize = dashSize; m.gapSize = gapSize; m.transparent = transparent || opacity < 1; m.opacity = opacity; m.resolution.set(size.width, size.height); }, [line, color, lineWidth, dashed, dashSize, gapSize, transparent, opacity, size.width, size.height]);
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose(); }, [line]);
  return flat.length >= 6 ? <primitive object={line} /> : null;
}
