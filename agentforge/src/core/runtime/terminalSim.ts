// TerminalSim — a deterministic, in-memory shell for practising terminal and Git basics safely.
// Nothing here touches the real filesystem. Commands are a small, documented subset.

export interface SimState {
  cwd: string;
  files: Record<string, string>; // absolute path → content ('' for dirs marked with trailing /)
  staged: Set<string>;
  committed: Record<string, string>;
  log: string[];
  branch: string;
}

const HOME = '/home/learner/acme-app';

export function initialRepo(): SimState {
  const files: Record<string, string> = {
    [`${HOME}/README.md`]: '# Acme App\nA tiny shop. Run `npm test`.\n',
    [`${HOME}/package.json`]: '{\n  "name": "acme-app",\n  "scripts": { "test": "node test/total.test.js" }\n}\n',
    [`${HOME}/src/total.js`]: 'export function total(items) {\n  // BUG: ignores quantity\n  return items.reduce((s, i) => s + i.price, 0);\n}\n',
    [`${HOME}/test/total.test.js`]: "import { total } from '../src/total.js';\nassert(total([{price: 10, qty: 2}]) === 20);\n",
    [`${HOME}/.env`]: 'STRIPE_KEY=sk_test_redacted_example\n',
  };
  return { cwd: HOME, files, staged: new Set(), committed: { ...files }, log: ['a1c3e9f Initial commit'], branch: 'main' };
}

function resolve(cwd: string, p: string) {
  if (!p || p === '.') return cwd;
  const parts = (p.startsWith('/') ? p : `${cwd}/${p}`).split('/');
  const out: string[] = [];
  for (const s of parts) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return '/' + out.join('/');
}

function listDir(st: SimState, dir: string) {
  const names = new Set<string>();
  for (const f of Object.keys(st.files)) {
    if (!f.startsWith(dir + '/')) continue;
    const rest = f.slice(dir.length + 1);
    const first = rest.split('/')[0];
    names.add(rest.includes('/') ? first + '/' : first);
  }
  return [...names].sort();
}
const isDir = (st: SimState, p: string) => Object.keys(st.files).some((f) => f.startsWith(p + '/'));

function testsPass(st: SimState) {
  return /i\.price\s*\*\s*i\.qty|i\.qty\s*\*\s*i\.price/.test(st.files[`${HOME}/src/total.js`] ?? '');
}

export const SIM_COMMANDS = ['pwd', 'ls [-a] [dir]', 'cd <dir>', 'cat <file>', 'git status', 'git diff', 'git add <file|.>', 'git commit -m "msg"', 'git log', 'git switch -c <branch>', 'git restore <file>', 'npm test', 'apply-fix', 'clear', 'help'];

export function exec(st: SimState, line: string): { out: string; state: SimState; clear?: boolean } {
  const s: SimState = { ...st, files: { ...st.files }, staged: new Set(st.staged), committed: { ...st.committed }, log: [...st.log] };
  const args = line.match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, '')) ?? [];
  const [cmd, ...rest] = args;
  const rel = (p: string) => (p.startsWith(HOME) ? p.slice(HOME.length + 1) || '.' : p);
  const changed = () => Object.keys({ ...s.files, ...s.committed }).filter((f) => s.files[f] !== s.committed[f]);
  switch (cmd) {
    case undefined: return { out: '', state: s };
    case 'help': return { out: `Simulated commands:\n  ${SIM_COMMANDS.join('\n  ')}\nThis is a safe simulation — nothing runs on your computer.`, state: s };
    case 'clear': return { out: '', state: s, clear: true };
    case 'pwd': return { out: s.cwd, state: s };
    case 'ls': {
      const showAll = rest.includes('-a');
      const target = resolve(s.cwd, rest.filter((r) => r !== '-a')[0] ?? '.');
      if (!isDir(s, target)) return { out: `ls: cannot access '${rest[0]}': No such file or directory`, state: s };
      return { out: listDir(s, target).filter((n) => showAll || !n.startsWith('.')).join('  '), state: s };
    }
    case 'cd': {
      const target = resolve(s.cwd, rest[0] ?? HOME);
      if (!isDir(s, target) && target !== HOME) return { out: `cd: no such directory: ${rest[0]}`, state: s };
      s.cwd = target;
      return { out: '', state: s };
    }
    case 'cat': {
      if (!rest[0]) return { out: 'cat: missing file operand', state: s };
      const p = resolve(s.cwd, rest[0]);
      if (p.endsWith('.env')) return { out: '⚠ This file holds secrets. In real work, avoid printing secrets to terminals, logs or agent context.\n' + (s.files[p] ?? ''), state: s };
      if (isDir(s, p)) return { out: `cat: ${rest[0]}: Is a directory`, state: s };
      return { out: s.files[p] ?? `cat: ${rest[0]}: No such file or directory`, state: s };
    }
    case 'apply-fix': {
      // Simulates an agent edit for the review exercise.
      s.files[`${HOME}/src/total.js`] = 'export function total(items) {\n  return items.reduce((s, i) => s + i.price * i.qty, 0);\n}\n';
      return { out: '[simulated agent] Edited src/total.js — run `git diff` to review the change.', state: s };
    }
    case 'npm': {
      if (rest[0] !== 'test') return { out: `npm ${rest.join(' ')}: not available in this simulation`, state: s };
      return testsPass(s)
        ? { out: '> acme-app test\n✓ total multiplies price by quantity\n\n1 passing', state: s }
        : { out: '> acme-app test\n✗ total multiplies price by quantity\n  AssertionError: expected 10 to equal 20\n    at test/total.test.js:2\n\n0 passing, 1 failing', state: s };
    }
    case 'git': {
      const sub = rest[0];
      if (sub === 'status') {
        const ch = changed();
        if (!ch.length) return { out: `On branch ${s.branch}\nnothing to commit, working tree clean`, state: s };
        const staged = ch.filter((f) => s.staged.has(f));
        const unstaged = ch.filter((f) => !s.staged.has(f));
        return {
          out: `On branch ${s.branch}\n${staged.length ? `Changes to be committed:\n${staged.map((f) => `\tmodified:   ${rel(f)}`).join('\n')}\n` : ''}${unstaged.length ? `Changes not staged for commit:\n${unstaged.map((f) => `\tmodified:   ${rel(f)}`).join('\n')}` : ''}`,
          state: s,
        };
      }
      if (sub === 'diff') {
        const ch = changed().filter((f) => !s.staged.has(f));
        if (!ch.length) return { out: '', state: s };
        return {
          out: ch.map((f) => {
            const a = (s.committed[f] ?? '').split('\n');
            const b = (s.files[f] ?? '').split('\n');
            const lines = [`diff --git a/${rel(f)} b/${rel(f)}`, `--- a/${rel(f)}`, `+++ b/${rel(f)}`];
            for (const l of a) if (!b.includes(l)) lines.push(`-${l}`);
            for (const l of b) if (!a.includes(l)) lines.push(`+${l}`);
            return lines.join('\n');
          }).join('\n'),
          state: s,
        };
      }
      if (sub === 'add') {
        const ch = changed();
        if (rest[1] === '.') ch.forEach((f) => s.staged.add(f));
        else if (rest[1]) {
          const p = resolve(s.cwd, rest[1]);
          if (!ch.includes(p)) return { out: `nothing to add for ${rest[1]}`, state: s };
          s.staged.add(p);
        } else return { out: 'Nothing specified, nothing added.', state: s };
        return { out: '', state: s };
      }
      if (sub === 'commit') {
        const mi = rest.indexOf('-m');
        const msg = mi >= 0 ? rest[mi + 1] : undefined;
        if (!msg) return { out: 'error: use git commit -m "message"', state: s };
        if (!s.staged.size) return { out: 'nothing added to commit (use "git add")', state: s };
        for (const f of s.staged) s.committed[f] = s.files[f];
        const id = Math.abs([...msg].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(16).padStart(7, '0').slice(0, 7);
        s.log.unshift(`${id} ${msg}`);
        const n = s.staged.size;
        s.staged = new Set();
        return { out: `[${s.branch} ${id}] ${msg}\n ${n} file(s) changed`, state: s };
      }
      if (sub === 'log') return { out: s.log.join('\n'), state: s };
      if (sub === 'switch' && rest[1] === '-c' && rest[2]) {
        s.branch = rest[2];
        return { out: `Switched to a new branch '${rest[2]}'`, state: s };
      }
      if (sub === 'restore' && rest[1]) {
        const p = resolve(s.cwd, rest[1]);
        if (s.committed[p] === undefined) return { out: `error: pathspec '${rest[1]}' did not match`, state: s };
        s.files[p] = s.committed[p];
        s.staged.delete(p);
        return { out: '', state: s };
      }
      if (sub === 'push') return { out: '⛔ Pushing is disabled in this simulation. In real work, push only after review — and never force-push shared branches.', state: s };
      return { out: `git ${sub ?? ''}: not available in this simulation (try: help)`, state: s };
    }
    case 'rm':
      return { out: '⛔ rm is disabled in this simulation. Deleting files is irreversible — in real work, read carefully before running destructive commands.', state: s };
    default:
      return { out: `${cmd}: command not found (try: help)`, state: s };
  }
}

export const SIM_HOME = HOME;
export { testsPass };
