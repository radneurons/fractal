// Minimal hash router: works from file://, static hosting and sub-paths with no server config.
import { useEffect, useState } from 'react';

export function currentPath() {
  const h = window.location.hash.replace(/^#/, '');
  return h || '/';
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) window.history.replaceState(null, '', `#${path}`);
  else window.location.hash = path;
  if (opts.replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function usePath() {
  const [p, setP] = useState(currentPath());
  useEffect(() => {
    const on = () => setP(currentPath());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return p;
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean);
  const xs = path.split('?')[0].split('/').filter(Boolean);
  if (pp.length !== xs.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) out[pp[i].slice(1)] = decodeURIComponent(xs[i]);
    else if (pp[i] !== xs[i]) return null;
  }
  return out;
}

export const href = (path: string) => `#${path}`;
