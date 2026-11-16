/** Continuity supervisor: local geometric checks over the cut. Claude explains and prioritises; it never invents findings. */
import type { Project, Shot } from './schema';
import { DEG, type Vec3, add, sub, dot, norm, len, round, qRotate } from './math';
import { evalCamera, evalCharacter, projectPoint, type CamState } from './evaluate';
import { shotFacts, type ShotFacts, SHOT_SIZES } from './cine';

export type IssueKind = 'axis-180' | 'screen-direction' | 'eyeline' | 'jump-cut' | 'timing-gap' | 'timing-overlap' | 'prop-continuity' | 'prompt-mismatch' | 'lighting';
export interface ContinuityIssue { id: string; kind: IssueKind; severity: 'low' | 'medium' | 'high'; shots: string[]; subjects: string[]; message: string; suggestion: string; data?: Record<string, number | string> }

const EPS = 1e-3;
const visibleIn = (f: ShotFacts, id: string) => f.subjects.some((s) => s.id === id && s.visible >= 0.3);
const overheadish = (cs: CamState) => qRotate(cs.quat, [0, 0, -1])[1] < -0.8;

export function runContinuity(p: Project): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [], facts = p.shots.map((s) => shotFacts(p, s));
  const push = (i: Omit<ContinuityIssue, 'id'>) => issues.push({ ...i, id: `${i.kind}:${i.shots.join('>')}:${i.subjects.join('+')}` });
  const name = (id: string) => p.characters[id]?.name ?? id;
  for (let i = 0; i + 1 < p.shots.length; i++) {
    const A = p.shots[i], B = p.shots[i + 1], fa = facts[i], fb = facts[i + 1], label = `${A.name} → ${B.name}`;
    const ta = A.end - EPS, tb = B.start, ca = evalCamera(p, p.cameras[A.cameraId], ta), cb = evalCamera(p, p.cameras[B.cameraId], tb);
    const pos = (id: string, t: number) => evalCharacter(p, p.characters[id], t).pos;
    // --- timing ---
    const gap = B.start - A.end;
    if (gap > 0.25) push({ kind: 'timing-gap', severity: gap > 1.5 ? 'medium' : 'low', shots: [A.id, B.id], subjects: [], message: `${label}: ${gap.toFixed(2)}s of staged action is skipped at the cut`, suggestion: 'Extend one shot to cover the gap, or keep it if the ellipsis is intended.', data: { gap: round(gap, 2) } });
    if (gap < -0.25 && A.cameraId === B.cameraId) push({ kind: 'timing-overlap', severity: 'medium', shots: [A.id, B.id], subjects: [], message: `${label}: ${(-gap).toFixed(2)}s of action repeats on the same camera`, suggestion: 'Trim the overlap or switch camera for the repeated beat.', data: { overlap: round(-gap, 2) } });
    const ids = Object.keys(p.characters).filter((id) => visibleIn(fa, id) && visibleIn(fb, id)).sort();
    // --- 180° rule: for each visible pair, camera must stay on one side of their axis ---
    if (!overheadish(ca) && !overheadish(cb)) for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
      const side = (cs: CamState, t: number) => { const a = pos(ids[x], t), b = pos(ids[y], t), ax = sub(b, a), l = Math.hypot(ax[0], ax[2]); if (l < 0.3) return 0; const c = sub(cs.pos, a); return (ax[2] * c[0] - ax[0] * c[2]) / l; };
      const sa = side(ca, ta), sb = side(cb, tb);
      if (sa * sb < 0 && Math.abs(sa) > 0.4 && Math.abs(sb) > 0.4) push({ kind: 'axis-180', severity: 'high', shots: [A.id, B.id], subjects: [ids[x], ids[y]], message: `${label}: camera crosses the 180° line between ${name(ids[x])} and ${name(ids[y])} — they will swap screen sides`, suggestion: `Move ${p.cameras[B.cameraId].name} to the other side of the ${name(ids[x])}–${name(ids[y])} axis, or insert a neutral shot on the line.`, data: { sideA: round(sa, 2), sideB: round(sb, 2) } });
    }
    // --- screen direction of moving subjects ---
    for (const id of ids) {
      const vel = (cs: CamState, t: number, cam: Shot) => { const c0 = evalCamera(p, p.cameras[cam.cameraId], t), a = projectPoint(c0, pos(id, t)), b = projectPoint(evalCamera(p, p.cameras[cam.cameraId], t + 0.2), pos(id, t + 0.2)); const world = len(sub(pos(id, t + 0.2), pos(id, t))) / 0.2; return world > 0.8 ? (b[0] - a[0]) / 0.2 : 0; };
      const va = vel(ca, ta - 0.2, A), vb = vel(cb, tb, B);
      if (va * vb < 0 && Math.abs(va) > 0.03 && Math.abs(vb) > 0.03) push({ kind: 'screen-direction', severity: 'medium', shots: [A.id, B.id], subjects: [id], message: `${label}: ${name(id)} travels ${va > 0 ? 'left-to-right' : 'right-to-left'} before the cut and ${vb > 0 ? 'left-to-right' : 'right-to-left'} after it`, suggestion: 'Keep the camera on the same side of the travel line, or bridge with a head-on / tail-away shot.' });
    }
    // --- eyelines across singles ---
    const pa = fa.subjects.find((s) => s.primary), pb = fb.subjects.find((s) => s.primary);
    if (pa && pb && pa.id !== pb.id && !visibleIn(fa, pb.id) && !visibleIn(fb, pa.id)) {
      const look = (id: string, other: string, cs: CamState, t: number) => { const st = evalCharacter(p, p.characters[id], t), f: Vec3 = [Math.sin(st.yaw), 0, Math.cos(st.yaw)], to = norm(sub(pos(other, t), st.pos)); if (dot(f, to) < 0.6) return 0; const h = add(st.pos, [0, 1.5, 0]); return projectPoint(cs, add(h, f))[0] - projectPoint(cs, h)[0]; };
      const la = look(pa.id, pb.id, ca, ta), lb = look(pb.id, pa.id, cb, tb);
      if (la * lb > 0 && Math.abs(la) > 0.01 && Math.abs(lb) > 0.01) push({ kind: 'eyeline', severity: 'medium', shots: [A.id, B.id], subjects: [pa.id, pb.id], message: `${label}: ${pa.name} and ${pb.name} both look screen-${la > 0 ? 'right' : 'left'} — their eyelines will not meet`, suggestion: `Flip ${p.cameras[B.cameraId].name} across the axis so ${pb.name} looks screen-${la > 0 ? 'left' : 'right'}.` });
    }
    // --- jump cut: same subject, similar size, < 30° change of camera angle ---
    if (pa && pb && pa.id === pb.id && Math.abs(gap) < 1) {
      const s = pos(pa.id, tb), va = norm(sub(ca.pos, add(pos(pa.id, ta), [0, 1.2, 0]))), vb = norm(sub(cb.pos, add(s, [0, 1.2, 0]))), ang = Math.acos(Math.min(1, Math.max(-1, dot(va, vb)))) / DEG;
      const ds = Math.abs(SHOT_SIZES.indexOf(pa.sizeEnd) - SHOT_SIZES.indexOf(pb.sizeStart));
      if (ang < 30 && ds <= 1 && A.cameraId !== B.cameraId) push({ kind: 'jump-cut', severity: ds === 0 ? 'medium' : 'low', shots: [A.id, B.id], subjects: [pa.id], message: `${label}: jump cut on ${pa.name} — same subject, ${pa.sizeEnd}→${pb.sizeStart}, only ${ang.toFixed(0)}° of angle change`, suggestion: 'Change the angle by at least 30° or the shot size by two steps.', data: { angle: round(ang, 0) } });
    }
  }
  // --- bible / prompt consistency ---
  const WEAPONS: Record<string, RegExp> = { sword: /sword|katana|blade|sabre|saber|rapier/i, staff: /staff|spear|pole|naginata/i, pistol: /pistol|handgun|revolver/i, rifle: /rifle|shotgun|carbine/i, shield: /shield/i, lantern: /lantern|lamp/i };
  for (const c of Object.values(p.characters)) {
    const bible = p.bibles.characters[c.id]; if (!bible?.weapon) continue;
    const want = Object.entries(WEAPONS).find(([, re]) => re.test(bible.weapon))?.[0];
    if (want && c.held.kind !== want) push({ kind: 'prop-continuity', severity: 'medium', shots: [], subjects: [c.id], message: `${c.name}'s bible says "${bible.weapon}" but the mannequin holds ${c.held.kind === 'none' ? 'nothing' : 'a ' + c.held.kind}`, suggestion: `Give ${c.name} a ${want} prop or amend the character bible.` });
  }
  p.shots.forEach((shot, i) => {
    const f = facts[i], active = p.prompts.active[shot.id] ?? {};
    for (const [provider, vid] of Object.entries(active)) {
      const v = p.prompts.versions[vid]; if (!v) continue; const text = v.text.toLowerCase();
      const mm = /(\d{2,3})\s?mm/.exec(text);
      if (mm && Math.abs(+mm[1] - f.camera.focal) / f.camera.focal > 0.2) push({ kind: 'prompt-mismatch', severity: 'medium', shots: [shot.id], subjects: [], message: `${shot.name} (${provider}): prompt says ${mm[1]}mm but the camera is ${f.camera.focal}mm`, suggestion: 'Recompile the prompt for this shot.' });
      const opp = f.lighting.side === 'camera-left' ? 'camera-right' : f.lighting.side === 'camera-right' ? 'camera-left' : null;
      if (opp && (text.includes(opp) || text.includes(opp.replace('-', ' '))) && !text.includes(f.lighting.side)) push({ kind: 'lighting', severity: 'medium', shots: [shot.id], subjects: [], message: `${shot.name} (${provider}): prompt lights the scene from ${opp} but the blockout sun is ${f.lighting.side}`, suggestion: 'Recompile the prompt or move the sun; mismatched light direction breaks continuity between shots.' });
      for (const s of f.subjects) { const bible = p.bibles.characters[s.id]; if (!bible?.weapon) continue; for (const [k, re] of Object.entries(WEAPONS)) if (re.test(text) && !re.test(bible.weapon) && new RegExp(`${s.name.toLowerCase()}[^.]{0,60}(${re.source})`, 'i').test(text)) push({ kind: 'prop-continuity', severity: 'low', shots: [shot.id], subjects: [s.id], message: `${shot.name} (${provider}): prompt gives ${s.name} a ${k}, but the bible lists "${bible.weapon}"`, suggestion: 'Fix the prompt wording or update the bible.' }); }
      if (v.factsHash !== f.hash) push({ kind: 'prompt-mismatch', severity: 'low', shots: [shot.id], subjects: [], message: `${shot.name} (${provider}): prompt is stale — the staging changed after it was written`, suggestion: 'Recompile; only the affected wording will be rewritten.' });
    }
  });
  const rank = { high: 0, medium: 1, low: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
}
