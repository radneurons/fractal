# Phase 1 — Core

**Built**
- pnpm monorepo: `apps/studio`, `apps/bridge`, `packages/{core,render,prompting,pipeline,mcp}`; strict TypeScript, packages consumed as source (no build step).
- `packages/core` (pure TS, no DOM): zod scene schema, typed op stream with one reducer (`applyOp`), inverses derived from immer patches (an inverse is itself an `Op`), linear history (`commit/undo/redo`), `describeOp` for the change log.
- Procedural mannequin (17 joints, 15 parametric clips), clip cross-fading, distance-driven gait phase (foot speed always matches path speed), two-bone leg IK on terrain, additive pose keys.
- Catmull-Rom (hold-aware, no overshoot) / Bezier / linear paths with arc-length reparametrisation; facing modes path / target / fixed.
- Studio: 3D scene view, transform gizmo, Path mode (click the ground), dope-sheet timeline with draggable keys and shot strip, inspector, autosave + `.blockout` files, hotkeys.
- Demo project "Field Duel".

**Run** `pnpm install && pnpm dev` → http://localhost:5173 (`?fresh` skips autosave recovery).

**Tested** `pnpm test`: arc-length sampling, keyframe interpolation and easing, apply → invert → equal for every op type, atomic rejection of invalid ops, history, IK ground constraint.

**Known gaps**
- The mannequin is our own procedural, CC0 rig: a tapered chest and abdomen, ball joints, and limb segments on 17 joints. It is not a skinned mesh. That trade buys byte-exact determinism and no binary assets. Retargeting works on joint eulers, so a skinned GLB could be bound to the same joints later.
- Panels re-dock through the Layout menu (added after phase 6); they cannot float in separate windows.
- GLB props render as the real mesh in WebGL views and passes, and as their bounding box in the pure-TS renderer (see the follow-up below).

**Follow-up (finishing pass)**
- **Pose mode in the viewport.** Select a character, choose Pose, click a joint, rotate it with the gizmo, and release: an additive pose key is written at the playhead (one undo entry). `poseKeyFor` is round-trip tested: the keyed joint lands exactly on the requested world orientation.
- **GLB import** (Add → Prop · GLB model…). The file is stored as an asset (IndexedDB and `.blockout` files) and normalised into its bounding box, which becomes the prop's scale. The WebGL renderer draws the mesh; the deterministic software renderer and the prompt facts use the box. E2E-tested, including recovery after a reload.
- **Curve editor.** Camera focal, height and roll keys can be dragged; flat curves draw through the middle so their keys don't hide others.
- **Panels.** The Layout menu re-docks panels, and Blockout/Result pop out (⧉) into their own windows. A pop-out window mirrors the editor live over a BroadcastChannel, is read-only, and never autosaves.
- **Change log.** Saves and (at most every five minutes) autosaves write change-log entries.
