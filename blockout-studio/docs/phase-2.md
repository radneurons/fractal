# Phase 2 — Cameras and shots

**Built**
- Camera splines with keys for position, target, focal length, focus, f-stop, roll; look-at a character, attach-with-lag (follow cam), seeded procedural shake (handheld / run-and-gun / earthquake).
- 11 presets (`makeCamera`): static, dolly, truck, crane, orbit, push-in, pull-out, whip pan, vertigo, top-down tracking, follow.
- Blockout view rendered by the *export* renderer (pass switchable), frame guides (thirds, golden, safe), 180° line, eyelines, frusta, onion skins, facts badge.
- Shot strip with trim/slide, crossfade and J/L indicators, cut playback, number keys to switch shots, `C` camera-from-view.
- `cine.ts`: movement classifier (static, pan, tilt, dolly in/out, truck, crane, orbit, handheld, whip pan, zoom, dolly zoom, tracking + secondary moves, speed, easing), lens class, shot size, angle, screen position, OTS detection, per-character action beats, lighting relative to camera, semantic diff between fact sets.
- `continuity.ts`: 180° crossings, screen-direction flips, eyeline mismatches, jump cuts, timing gaps/overlaps, prop/bible conflicts, prompt-vs-geometry mismatches.

**Tested** every movement class against synthetic tracks, easing detection, lens / shot-size / angle thresholds, the six demo shots reading as designed, semantic diffs touching only affected shots, the demo's deliberate 180° violation (shot 4 → 5), jump-cut and gap detection.

**Known gaps**
- Shot size uses full-body height vs frame height; it does not yet account for partial occlusion.
- Depth of field is described in facts and drawn nowhere (no focus-plane gizmo yet).
