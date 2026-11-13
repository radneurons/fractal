import { useEffect, useRef, useState } from 'react';
import { createUniverse, webglAvailable, STATE_COLOR } from './universe/scene';
import { SKILLS } from '@/content/skills';
import { SCHOOLS } from '@/content/schools';
import { useLearner } from '@/store/learner';
import { navigate, href } from '@/ui/router';
import { BrandMark, Icon } from '@/ui/kit';
import { validateCurriculum } from '@/core/registry';

export default function Landing() {
  const ref = useRef<HTMLDivElement>(null);
  const profile = useLearner((s) => s.profile);
  const lastRoute = useLearner((s) => s.lastRoute);
  const settings = useLearner((s) => s.settings);
  const [gl] = useState(() => webglAvailable());
  const counts = validateCurriculum().counts;

  useEffect(() => {
    if (!gl || !ref.current) return;
    const hueColor = (h: number) => `hsl(${h} 70% 62%)`;
    const u = createUniverse(ref.current, {
      nodes: SKILLS.map((s) => ({ id: s.id, label: s.title, group: s.schoolId, groupLabel: '', hue: 0, color: SCHOOLS.find((x) => x.id === s.schoolId) ? hueColor(SCHOOLS.find((x) => x.id === s.schoolId)!.hue) : STATE_COLOR.ready, size: 0.55 + s.difficulty * 0.12 })),
      edges: SKILLS.flatMap((s) => s.prereqs.map((p) => ({ from: p, to: s.id }))),
      autoRotate: !settings.reducedMotion && !settings.focusMode,
      reducedMotion: settings.reducedMotion,
      interactive: false,
      cameraDistance: 104,
    });
    return () => u.dispose();
  }, [gl, settings.reducedMotion, settings.focusMode]);

  const start = (level: 'zero' | 'uses-ai' | 'developer') => navigate(`/onboarding?level=${level}`);

  return (
    <div className="landing">
      <div ref={ref} style={{ position: 'absolute', inset: 0, opacity: 0.9 }} aria-hidden="true" />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, var(--bg) 0%, color-mix(in srgb, var(--bg) 82%, transparent) 42%, transparent 75%)' }} aria-hidden="true" />
      <div className="hero">
        <div className="row" style={{ marginBottom: 28 }}>
          <BrandMark /> <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '.04em' }}>AGENTFORGE</span>
          {profile?.onboarded && (
            <a className="btn sm" href={href(lastRoute || '/home')} style={{ marginLeft: 'auto' }}>Continue where you left off <Icon name="arrow" /></a>
          )}
        </div>
        <h1>Learn intelligence.<br />Build intelligence.<br /><span style={{ color: 'var(--accent)' }}>Master agents.</span></h1>
        <p className="tag">Your journey from <b>zero</b> to <b>AI architect</b> begins here.</p>
        <p className="muted" style={{ maxWidth: '58ch' }}>
          Evidence-based mastery — not watch-time. Real exercises run in your browser, a transparent mastery model finds your weak spots, and every
          score shows exactly what earned it. No account, no API key needed.
        </p>
        <div className="entry-grid" role="group" aria-label="Choose how to start">
          <button className="entry" onClick={() => start('zero')}>
            <div className="n">01</div>
            <h3>I'm starting from zero</h3>
            <div className="small muted">Plain-language foundations, a 6-question check, then your first lesson.</div>
          </button>
          <button className="entry" onClick={() => start('uses-ai')}>
            <div className="n">02</div>
            <h3>I already use AI</h3>
            <div className="small muted">Skip what you know. Go deeper on prompting, Claude and agents.</div>
          </button>
          <button className="entry" onClick={() => start('developer')}>
            <div className="n">03</div>
            <h3>Test my skills</h3>
            <div className="small muted">A 12-question adaptive diagnostic across agents, RAG, evals and security.</div>
          </button>
        </div>
        <div className="row small faint" style={{ marginTop: 26, gap: 18 }}>
          <span>{counts.schools} schools</span><span>{counts.skills} skills</span><span>{counts.lessons} authored lessons</span><span>{counts.items} graded exercises</span><span>10 games</span><span>Progress saved locally</span>
        </div>
      </div>
    </div>
  );
}
