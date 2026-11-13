import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react';
import { useLearner } from '@/store/learner';
import { useModel } from '@/store/model';
import { match, navigate, usePath, href } from '@/ui/router';
import { BrandMark, Icon, Modal, ToastProvider } from '@/ui/kit';
import { SKILLS } from '@/content/skills';
import { LESSONS } from '@/content/lessons';
import { GAMES } from '@/content/games';
import { PROJECTS } from '@/content/projects';
import { SCHOOLS } from '@/content/schools';

const Landing = lazy(() => import('@/features/Landing'));
const Onboarding = lazy(() => import('@/features/Onboarding'));
const Home = lazy(() => import('@/features/Home'));
const Universe = lazy(() => import('@/features/Universe'));
const Academy = lazy(() => import('@/features/Academy'));
const SchoolPage = lazy(() => import('@/features/School'));
const LessonPage = lazy(() => import('@/features/Lesson'));
const SkillSession = lazy(() => import('@/features/SkillSession'));
const Lab = lazy(() => import('@/features/Lab'));
const Studio = lazy(() => import('@/features/Studio'));
const Arena = lazy(() => import('@/features/Arena'));
const BrainGym = lazy(() => import('@/features/BrainGym'));
const Interview = lazy(() => import('@/features/Interview'));
const Projects = lazy(() => import('@/features/Projects'));
const Observatory = lazy(() => import('@/features/Observatory'));
const Vault = lazy(() => import('@/features/Vault'));
const Planner = lazy(() => import('@/features/Planner'));
const Settings = lazy(() => import('@/features/Settings'));
const Mentor = lazy(() => import('@/features/Mentor'));

type R = { pattern: string; C: ComponentType<any>; title: string; wide?: boolean; bare?: boolean };
const ROUTES: R[] = [
  { pattern: '/', C: Landing, title: 'Welcome', bare: true },
  { pattern: '/onboarding', C: Onboarding, title: 'Getting started', bare: true },
  { pattern: '/home', C: Home, title: 'Command Center' },
  { pattern: '/universe', C: Universe, title: 'Knowledge Universe', wide: true },
  { pattern: '/academy', C: Academy, title: 'Academy' },
  { pattern: '/academy/:schoolId', C: SchoolPage, title: 'School' },
  { pattern: '/lesson/:lessonId', C: LessonPage, title: 'Lesson' },
  { pattern: '/practice/:skillId', C: SkillSession, title: 'Practice' },
  { pattern: '/review/:skillId', C: SkillSession, title: 'Review' },
  { pattern: '/recover/:skillId', C: SkillSession, title: 'Fix a weakness' },
  { pattern: '/review', C: SkillSession, title: 'Review' },
  { pattern: '/lab', C: Lab, title: 'Practice Lab', wide: true },
  { pattern: '/lab/:tab', C: Lab, title: 'Practice Lab', wide: true },
  { pattern: '/studio', C: Studio, title: 'Agent Studio', wide: true },
  { pattern: '/studio/:templateId', C: Studio, title: 'Agent Studio', wide: true },
  { pattern: '/arena', C: Arena, title: 'Challenge Arena' },
  { pattern: '/arena/:gameId', C: Arena, title: 'Challenge Arena' },
  { pattern: '/brain-gym', C: BrainGym, title: 'Brain Gym' },
  { pattern: '/interview', C: Interview, title: 'Interview Simulator' },
  { pattern: '/projects', C: Projects, title: 'Project Workshop' },
  { pattern: '/projects/:projectId', C: Projects, title: 'Project Workshop' },
  { pattern: '/observatory', C: Observatory, title: 'Mastery Observatory' },
  { pattern: '/vault', C: Vault, title: 'Knowledge Vault' },
  { pattern: '/planner', C: Planner, title: 'Learning Planner' },
  { pattern: '/settings', C: Settings, title: 'Settings' },
];

const NAV = [
  { group: 'Learn', items: [['home', '/home', 'Command Center'], ['universe', '/universe', 'Universe'], ['academy', '/academy', 'Academy'], ['planner', '/planner', 'Planner']] },
  { group: 'Practice', items: [['lab', '/lab', 'Practice Lab'], ['studio', '/studio', 'Agent Studio'], ['arena', '/arena', 'Arena'], ['brain', '/brain-gym', 'Brain Gym']] },
  { group: 'Prove', items: [['interview', '/interview', 'Interviews'], ['projects', '/projects', 'Projects'], ['observatory', '/observatory', 'Observatory']] },
  { group: 'Keep', items: [['vault', '/vault', 'Vault'], ['settings', '/settings', 'Settings']] },
] as const;

function resolve(path: string) {
  for (const r of ROUTES) {
    const params = match(r.pattern, path);
    if (params) return { r, params };
  }
  return null;
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner() {
  const hydrated = useLearner((s) => s.hydrated);
  const settings = useLearner((s) => s.settings);
  const profile = useLearner((s) => s.profile);
  const setLastRoute = useLearner((s) => s.setLastRoute);
  const path = usePath();
  const [mentorOpen, setMentorOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // Apply theme / text size / motion.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty('--scale', String(settings.textScale));
    document.body.classList.toggle('reduced-motion', settings.reducedMotion);
    document.body.classList.toggle('focus-mode', settings.focusMode);
  }, [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        setMentorOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const resolved = resolve(path);
  useEffect(() => {
    setNavOpen(false);
    window.scrollTo(0, 0);
    if (hydrated && resolved && !resolved.r.bare) setLastRoute(path);
    if (resolved) document.title = `${resolved.r.title} · AgentForge`;
  }, [path, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hydrated)
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }} aria-busy="true">
        <div className="row"><BrandMark /> <span className="muted">Loading your progress…</span></div>
      </div>
    );

  // New visitors who deep-link into the app still get a profile prompt from Home; landing remains reachable.
  if (!resolved)
    return (
      <div className="content">
        <h1>Page not found</h1>
        <a className="btn" href={href(profile ? '/home' : '/')}>Go home</a>
      </div>
    );

  const { r, params } = resolved;
  const Page = r.C;
  if (r.bare)
    return (
      <Suspense fallback={null}>
        <a className="skip-link" href="#main">Skip to content</a>
        <main id="main"><Page {...params} /></main>
      </Suspense>
    );

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className={`rail ${navOpen ? 'open' : ''}`} aria-label="Main navigation">
        <a className="brand" href={href('/home')}><BrandMark /> AgentForge</a>
        {NAV.map((g) => (
          <div className="nav-group" key={g.group}>
            <div className="nav-label">{g.group}</div>
            {g.items.map(([icon, to, label]) => (
              <a key={to} className="nav-item" href={href(to)} aria-current={path === to || (to !== '/home' && path.startsWith(to + '/')) ? 'page' : undefined}>
                <Icon name={icon} /> {label}
              </a>
            ))}
          </div>
        ))}
        <div className="rail-foot">
          <button className="btn sm" onClick={() => setMentorOpen(true)}><Icon name="guide" /> Forge Guide <span className="kbd">⌘.</span></button>
          <button className="btn ghost sm" onClick={() => setCmdOpen(true)}><Icon name="search" /> Search <span className="kbd">⌘K</span></button>
        </div>
      </nav>
      <div className="main">
        <TopBar title={r.title} onMenu={() => setNavOpen((o) => !o)} onSearch={() => setCmdOpen(true)} onMentor={() => setMentorOpen(true)} />
        <main id="main" className={`content ${r.wide ? 'wide' : ''}`} style={r.pattern === '/universe' ? { padding: 0 } : undefined} tabIndex={-1}>
          <Suspense fallback={<div className="muted" aria-busy="true">Loading…</div>}>
            <Page key={path.split('?')[0]} {...params} />
          </Suspense>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Primary">
        {([['home', '/home', 'Home'], ['academy', '/academy', 'Learn'], ['lab', '/lab', 'Practice'], ['observatory', '/observatory', 'Progress']] as const).map(([i, to, l]) => (
          <a key={to} href={href(to)} aria-current={path.startsWith(to) ? 'page' : undefined}><Icon name={i} />{l}</a>
        ))}
        <button onClick={() => setNavOpen(true)}><Icon name="menu" />More</button>
      </nav>
      {navOpen && <div className="modal-backdrop" style={{ zIndex: 55 }} onClick={() => setNavOpen(false)} />}
      <Suspense fallback={null}>{mentorOpen && <Mentor onClose={() => setMentorOpen(false)} path={path} />}</Suspense>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}

function TopBar({ title, onMenu, onSearch, onMentor }: { title: string; onMenu: () => void; onSearch: () => void; onMentor: () => void }) {
  const settings = useLearner((s) => s.settings);
  const setSettings = useLearner((s) => s.setSettings);
  const xp = useLearner((s) => s.xp);
  const days = useLearner((s) => s.studyDays);
  const { rank } = useModel();
  const streak = useMemo(() => {
    let n = 0;
    const set = new Set(days);
    for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
      const k = d.toISOString().slice(0, 10);
      if (set.has(k)) n++;
      else if (n === 0 && k === new Date().toISOString().slice(0, 10)) continue;
      else break;
      if (n > 365) break;
    }
    return n;
  }, [days]);
  return (
    <header className="topbar">
      <button className="icon-btn mobile-only" onClick={onMenu} aria-label="Open navigation"><Icon name="menu" /></button>
      <div className="crumbs"><span className="hide-sm">AgentForge / </span><b>{title}</b></div>
      <span className="chip amber hide-sm" title="Rank is based on demonstrated mastery and completed projects — not XP.">{rank.rank.name}</span>
      <span className="chip hide-sm" title="Experience points from graded work (hints halve, revealed solutions earn none)"><Icon name="bolt" size={12} /> {xp} XP</span>
      <span className="chip" title="Days with learning activity in a row. Missing a day never removes progress."><Icon name="flame" size={12} /> {streak}</span>
      <button className="icon-btn" onClick={onSearch} aria-label="Search (Ctrl+K)"><Icon name="search" /></button>
      <button className={`icon-btn`} onClick={() => setSettings({ focusMode: !settings.focusMode })} aria-pressed={settings.focusMode} aria-label={settings.focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'} title="Focus Mode: calm layout, no ambient motion" style={settings.focusMode ? { color: 'var(--accent)' } : undefined}><Icon name="focus" /></button>
      <button className="icon-btn" onClick={() => setSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' })} aria-label="Toggle light/dark theme"><Icon name={settings.theme === 'light' ? 'moon' : 'sun'} /></button>
      <button className="btn sm primary" onClick={onMentor} aria-label="Open Forge Guide"><Icon name="guide" /><span className="hide-sm">Guide</span></button>
    </header>
  );
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const vault = useLearner((s) => s.vault);
  const results = useMemo(() => {
    const all = [
      ...LESSONS.map((l) => ({ kind: 'Lesson', title: l.title, to: `/lesson/${l.id}` })),
      ...SKILLS.map((s) => ({ kind: 'Skill', title: s.title, to: `/practice/${s.id}` })),
      ...SCHOOLS.map((s) => ({ kind: 'School', title: `${s.num}. ${s.title}`, to: `/academy/${s.id}` })),
      ...GAMES.map((g) => ({ kind: 'Game', title: g.title, to: `/arena/${g.id}` })),
      ...PROJECTS.map((p) => ({ kind: 'Project', title: p.title, to: `/projects/${p.id}` })),
      ...vault.map((v) => ({ kind: `Vault · ${v.kind}`, title: v.title, to: '/vault' })),
      ...ROUTES.filter((r) => !r.pattern.includes(':') && r.pattern !== '/').map((r) => ({ kind: 'Page', title: r.title, to: r.pattern })),
    ];
    const t = q.toLowerCase().trim();
    return (t ? all.filter((x) => x.title.toLowerCase().includes(t)) : all.filter((x) => x.kind === 'Page')).slice(0, 30);
  }, [q, vault]);
  return (
    <Modal open={open} onClose={onClose} title="Search AgentForge">
      <div className="cmdk">
        <input className="input" autoFocus placeholder="Lessons, skills, games, projects, notes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search"
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { navigate(results[0].to); onClose(); } }} />
        <div className="res" role="list">
          {results.map((r, i) => (
            <a key={i} href={href(r.to)} onClick={onClose} role="listitem"><span className="chip">{r.kind}</span>{r.title}</a>
          ))}
          {!results.length && <div className="empty">No matches.</div>}
        </div>
      </div>
    </Modal>
  );
}
