// Bridge client: REST helpers, a single shared WebSocket with topic subscriptions, and React hooks.
import { useCallback, useEffect, useRef, useState } from "react";

const TOKEN_KEY = "om.token";
export const getToken = () => new URLSearchParams(location.search).get("token") || localStorage.getItem(TOKEN_KEY) || "";
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function request<T = any>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const headers: Record<string, string> = {};
  const tok = getToken();
  if (tok) headers["X-OM-Token"] = tok;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let res: Response;
  try { res = await fetch(path, { method, headers, body: payload }); }
  catch { throw new ApiError("The local bridge is not reachable. Start it with: python -m om", 0); }
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch { /* not json */ }
    throw new ApiError(msg, res.status);
  }
  if (raw) return res as unknown as T;
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>("PUT", p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => request<T>("PATCH", p, b ?? {}),
  del: <T = any>(p: string) => request<T>("DELETE", p),
  upload: <T = any>(p: string, file: File) => { const f = new FormData(); f.append("file", file); return request<T>("POST", p, f); },
  async download(path: string, filename: string) {
    const res = await request<Response>("GET", path, undefined, true);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
};

export function saveText(text: string, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------------------------------------------------------- live events
export type LiveMsg = { topic: string; type: string; data: any; ts: number };
type Handler = (m: LiveMsg) => void;

class Live {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private retry = 500;
  connected = false;
  onStatus: ((ok: boolean) => void) | null = null;

  private open() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const tok = getToken();
    const ws = new WebSocket(`${proto}://${location.host}/ws${tok ? `?token=${encodeURIComponent(tok)}` : ""}`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true; this.retry = 500; this.onStatus?.(true);
      const topics = [...this.handlers.keys()];
      if (topics.length) ws.send(JSON.stringify({ subscribe: topics }));
    };
    ws.onmessage = (ev) => {
      let m: LiveMsg; try { m = JSON.parse(ev.data); } catch { return; }
      this.handlers.get(m.topic)?.forEach((h) => h(m));
    };
    ws.onclose = () => {
      this.connected = false; this.onStatus?.(false);
      setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(this.retry * 2, 8000);
    };
    ws.onerror = () => ws.close();
  }

  subscribe(topic: string, h: Handler): () => void {
    this.open();
    let set = this.handlers.get(topic);
    if (!set) { set = new Set(); this.handlers.set(topic, set); if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ subscribe: [topic] })); }
    set.add(h);
    return () => {
      const s = this.handlers.get(topic); if (!s) return;
      s.delete(h);
      if (!s.size) { this.handlers.delete(topic); if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ unsubscribe: [topic] })); }
    };
  }
}
export const live = new Live();

export function useLive(topic: string | null | undefined, handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => (topic ? live.subscribe(topic, (m) => ref.current(m)) : undefined), [topic]);
}

/** Fetch + optional polling.  `reload()` refetches; `set` allows optimistic/local updates. */
export function useApi<T = any>(path: string | null, opts: { interval?: number; deps?: unknown[] } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const alive = useRef(true);
  const reload = useCallback(async () => {
    if (!path) return;
    try { const d = await api.get<T>(path); if (alive.current) { setData(d); setError(null); } }
    catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...(opts.deps || [])]);
  useEffect(() => {
    alive.current = true;
    if (!path) { setData(null); setLoading(false); return; }
    setLoading(true); reload();
    const id = opts.interval ? setInterval(reload, opts.interval) : null;
    return () => { alive.current = false; if (id) clearInterval(id); };
  }, [reload, path, opts.interval]);
  return { data, error, loading, reload, set: setData };
}
