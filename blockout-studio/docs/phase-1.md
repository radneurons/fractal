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
- The mannequin is procedural (boxes/capsules on a joint hierarchy), not a skinned CC0 GLB. That was a deliberate trade for byte-exact determinism and zero binary assets; retargeting works on joint eulers, so a skinned mesh can be bound to the same 17 joints later.
- Panels are resizable and persisted, but not freely re-dockable.
- GLB props are accepted by the schema and rendered as a proxy box.
