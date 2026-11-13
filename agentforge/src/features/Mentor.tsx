// Forge Guide: context-aware mentor. Offline → authored guidance (clearly labelled). Online → live model with fixed mode prompts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLearner } from '@/store/learner';
import { useModel } from '@/store/model';
import { match } from '@/ui/router';
import { lessonById, lessonsForSkill } from '@/content/lessons';
import { getSkill, skillById } from '@/content/skills';
import { itemsForSkill } from '@/content/items';
import { SCENARIOS } from '@/content/interviews';
import { complete, providerReady } from '@/core/ai/provider';
import { MODES, mentorSystemPrompt, type MentorMode } from '@/core/ai/mentorPrompts';
import { Icon, Markdown, TruthLabel } from '@/ui/kit';
import type { Lesson, Skill } from '@/core/types';
import { href } from '@/ui/router';

interface Msg {
  role: 'user' | 'guide';
  text: string;
  kind: 'authored' | 'live';
  model?: string;
}

function contextFromPath(path: string): { lesson?: Lesson; skill?: Skill } {
  for (const pat of ['/lesson/:lessonId', '/practice/:skillId', '/review/:skillId', '/recover/:skillId']) {
    const m = match(pat, path);
    if (m?.lessonId) {
      const l = lessonById.get(m.lessonId);
      if (l) return { lesson: l, skill: getSkill(l.skillIds[0]) };
    }
    if (m?.skillId && skillById.has(m.skillId)) return { lesson: lessonsForSkill(m.skillId)[0], skill: getSkill(m.skillId) };
  }
  return { lesson: undefined, skill: undefined };
}

export default function Mentor({ onClose, path }: { onClose: () => void; path: string }) {
  const provider = useLearner((s) => s.provider);
  const evidence = useLearner((s) => s.evidence);
  const vault = useLearner((s) => s.vault);
  const profile = useLearner((s) => s.profile);
  const { weaknesses, next } = useModel();
  const ctx = useMemo(() => contextFromPath(path), [path]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [hintLevel, setHintLevel] = useState(0);
  const live = providerReady(provider);
  const end = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [msgs]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    panel.current?.focus();
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const authored = (mode: MentorMode): string => {
    const s = ctx.skill;
    const l = ctx.lesson;
    if (!s) {
      const n = next[0];
      return `I don't have a specific lesson open, so here's where to go next: **${n?.title ?? 'the Academy'}** — ${n?.reason ?? 'pick a school to start'}.${weaknesses[0] ? `\n\nYour top weakness right now is **${getSkill(weaknesses[0].skillId).title}**. Open it and choose "Fix this weakness".` : ''}`;
    }
    switch (mode) {
      case 'simple': return l?.simpler ?? s.summary;
      case 'another': return l?.anotherWay ?? s.workedExample;
      case 'example': return `**Worked example — ${s.title}**\n\n${l?.workedExample.body ?? s.workedExample}`;
      case 'steps': return l ? l.sections.map((x, i) => `${i + 1}. **${x.heading}** — ${x.body.split(/(?<=\.)\s/)[0]}`).join('\n') : s.remediation.split(/(?<=\.)\s/).slice(0, 4).map((x, i) => `${i + 1}. ${x}`).join('\n');
      case 'socratic': return `Let's reason it out:\n- What problem does **${s.title.toLowerCase()}** solve — what goes wrong without it?\n- Can you think of a situation where the obvious approach would fail, and what you'd check to notice?`;
      case 'hint': {
        const ladder = [`Focus on the core idea: ${s.summary}`, `Common trap: confusing it with something nearby. Re-read: ${s.remediation.split(/(?<=\.)\s/).slice(0, 2).join(' ')}`, `Try applying it to this example: ${s.workedExample.slice(0, 220)}…`];
        const h = ladder[Math.min(hintLevel, ladder.length - 1)];
        setHintLevel((x) => x + 1);
        return `Hint ${Math.min(hintLevel + 1, ladder.length)}/${ladder.length}: ${h}${hintLevel >= ladder.length - 1 ? '\n\nThat\'s the last authored hint — attempt the exercise; the full explanation appears after you submit.' : ''}`;
      }
      case 'challenge': {
        const harder = [...itemsForSkill(s.id)].sort((a, b) => b.difficulty - a.difficulty)[0];
        return `Here's a harder problem on this skill (difficulty ${harder.difficulty}/5):\n\n${harder.prompt}\n\n[Open it in practice](${location.origin}${location.pathname}#/practice/${s.id})`;
      }
      case 'mistake': {
        const m = vault.find((v) => v.kind === 'mistake' && v.skillIds.includes(s.id) && !v.resolved);
        return m ? `Your most recent unresolved mistake on this skill:\n\n**${m.title}**\n\n${m.body}` : 'I don\'t see an unresolved mistake for this skill in your Mistake Journal. (Offline, I can only review answers you\'ve submitted — connect a model to have free-form work reviewed.)';
      }
      case 'interview': {
        const sc = SCENARIOS.find((x) => x.skillId === s.id) ?? SCENARIOS.find((x) => x.level === 'foundation')!;
        return `Interview question: **${sc.question}**\n\nAnswer it in the [Interview Simulator](${location.origin}${location.pathname}#/interview) to get rubric feedback.`;
      }
    }
  };

  const send = async (mode: MentorMode, userText?: string) => {
    const label = MODES.find((m) => m.id === mode)!.label;
    const shown = userText?.trim() || label;
    setMsgs((m) => [...m, { role: 'user', text: shown, kind: live ? 'live' : 'authored' }]);
    setText('');
    if (!live) {
      setMsgs((m) => [...m, { role: 'guide', text: authored(mode), kind: 'authored' }]);
      return;
    }
    setBusy(true);
    try {
      const system = mentorSystemPrompt(mode, {
        lessonTitle: ctx.lesson?.title, objective: ctx.lesson?.objective, skillTitle: ctx.skill?.title, skillSummary: ctx.skill?.summary,
        learnerLevel: profile?.level ?? 'unknown',
        recent: evidence.slice(-5).map((e) => `${getSkill(e.skillId).title}: ${Math.round(e.score * 100)}%`),
        weak: weaknesses.slice(0, 3).map((w) => getSkill(w.skillId).title),
      });
      const history = msgs.filter((x) => x.kind === 'live').slice(-6).map((x) => ({ role: x.role === 'user' ? ('user' as const) : ('assistant' as const), content: x.text }));
      const content = mode === 'mistake' ? `<learner_work>${userText ?? ''}</learner_work>` : `<question>${userText?.trim() || label}</question>`;
      const r = await complete(provider, { system, messages: [...history, { role: 'user', content }], maxTokens: 1500 });
      setMsgs((m) => [...m, { role: 'guide', text: r.text, kind: 'live', model: r.model }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'guide', text: `Couldn't reach the model: ${(e as Error).message}\n\nAuthored guidance instead:\n\n${authored(mode)}`, kind: 'authored' }]);
    }
    setBusy(false);
  };

  return (
    <aside className="drawer" role="dialog" aria-label="Forge Guide mentor" ref={panel} tabIndex={-1}>
      <div className="row between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div><b>Forge Guide</b><div className="tiny faint">{ctx.lesson ? `Lesson: ${ctx.lesson.title}` : ctx.skill ? `Skill: ${ctx.skill.title}` : 'General guidance'}</div></div>
        <div className="row">{live ? <TruthLabel kind="live" detail={`${provider.provider} · ${provider.model}`} /> : <span className="chip" title="No AI model connected — responses are authored lesson content.">Authored guidance</span>}<button className="icon-btn" onClick={onClose} aria-label="Close mentor"><Icon name="close" /></button></div>
      </div>
      <div style={{ padding: 16, overflow: 'auto', flex: 1 }} className="stack sm">
        {!msgs.length && (
          <div className="callout small">
            I teach rather than hand out answers. Pick a mode below{live ? ' or ask anything' : ''}.{!live && <> No AI model is connected, so I respond with authored explanations, examples and graduated hints from the curriculum. <a href={href('/settings')}>Connect a model</a> for free-form tutoring.</>}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className="card inset fade-in" style={{ borderLeft: `3px solid ${m.role === 'user' ? 'var(--info)' : m.kind === 'live' ? 'var(--accent)' : 'var(--violet)'}`, padding: 12 }}>
            <div className="tiny faint">{m.role === 'user' ? 'You' : m.kind === 'live' ? `Forge Guide · live · ${m.model}` : 'Forge Guide · authored'}</div>
            <Markdown text={m.text} />
          </div>
        ))}
        {busy && <div className="tiny faint pulse">Waiting for the model…</div>}
        <div ref={end} />
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--border)' }} className="stack sm">
        <div className="row" style={{ gap: 6 }}>{MODES.map((m) => <button key={m.id} className="chip" style={{ cursor: 'pointer' }} title={m.desc} disabled={busy} onClick={() => send(m.id, live ? text || undefined : undefined)}>{m.label}</button>)}</div>
        {live && (
          <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send('simple', text); }}>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about this lesson, or paste your work then pick “Find my mistake”…" aria-label="Message to Forge Guide" />
            <button className="btn primary" disabled={busy || !text.trim()}>Send</button>
          </form>
        )}
      </div>
    </aside>
  );
}
