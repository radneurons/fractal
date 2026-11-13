// MCP Lab — a real Model Context Protocol client (official SDK, Streamable HTTP).
// Connect to a server, inspect its capabilities, call its tools, read its resources, and see every JSON-RPC message.
import { useEffect, useState } from 'react';
import { useMcp } from '@/core/mcp/session';
import { mcpToolId } from '@/core/mcp/tools';
import { Icon, TruthLabel, useToast } from '@/ui/kit';
import { navigate } from '@/ui/router';

const DEFAULT_URL = 'http://localhost:8787/mcp';

function exampleArgs(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  const o: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(props)) o[k] = p.type === 'number' || p.type === 'integer' ? 0 : p.type === 'boolean' ? false : p.type === 'array' ? [] : '';
  return JSON.stringify(o, null, 2);
}
const pretty = (s: string) => {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
};

export default function McpLab() {
  const { conn, status, error, log, connect, disconnect, clearLog } = useMcp();
  const { toast } = useToast();
  const [url, setUrl] = useState(conn?.url ?? DEFAULT_URL);
  const [tool, setTool] = useState('');
  const [args, setArgs] = useState('{}');
  const [result, setResult] = useState<{ text: string; isError: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resText, setResText] = useState<{ uri: string; text: string } | null>(null);

  const selected = conn?.tools.find((t) => t.name === tool);
  useEffect(() => {
    if (conn && !conn.tools.some((t) => t.name === tool)) setTool(conn.tools[0]?.name ?? '');
  }, [conn, tool]);
  useEffect(() => {
    if (selected) setArgs(exampleArgs(selected.inputSchema));
    setResult(null);
  }, [selected]);

  const call = async () => {
    if (!conn || !selected) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(args || '{}');
    } catch {
      toast('Arguments must be valid JSON');
      return;
    }
    if (!selected.readOnly && !window.confirm(`"${selected.name}" is not marked read-only — it may change state on the server. Call it?`)) return;
    setBusy(true);
    try {
      setResult(await conn.callTool(selected.name, parsed));
    } catch (e) {
      setResult({ text: e instanceof Error ? e.message : String(e), isError: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="card stack sm">
        <div className="row between">
          <h3 style={{ margin: 0 }}>Connect to an MCP server</h3>
          <TruthLabel kind="executed" detail="Real MCP protocol traffic using the official MCP TypeScript SDK over Streamable HTTP. Nothing on this tab is simulated." />
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Try the bundled demo server: run <code>npm run mcp:demo</code> in the project folder, then connect to <code>{DEFAULT_URL}</code>. Any server that speaks Streamable HTTP and allows this page's origin (CORS) will work. Connections live in this tab only and are never saved. (A <code>405</code> in the browser console is expected with the demo server: the client offers an optional event stream, which a stateless server declines.)
        </p>
        <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); void connect(url.trim()); }}>
          <label className="sr-only" htmlFor="mcp-url">Server URL</label>
          <input id="mcp-url" className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_URL} spellCheck={false} />
          {conn ? (
            <button type="button" className="btn" onClick={() => void disconnect()}>Disconnect</button>
          ) : (
            <button type="submit" className="btn primary" disabled={status === 'connecting' || !/^https?:\/\//.test(url.trim())}><Icon name="play" /> {status === 'connecting' ? 'Connecting…' : 'Connect'}</button>
          )}
        </form>
        {status === 'error' && <div className="callout warn small" role="alert">Could not connect: {error}</div>}
        {conn && (
          <div className="row small" aria-live="polite">
            <span className="chip success">connected</span>
            <span><b>{conn.serverName}</b> <span className="faint">v{conn.serverVersion}</span></span>
            {conn.protocolVersion && <span className="faint">protocol {conn.protocolVersion}</span>}
            <span className="faint">capabilities: {conn.capabilities.join(', ') || 'none'}</span>
          </div>
        )}
      </div>

      {conn && (
        <div className="grid g2">
          <div className="card stack sm">
            <h3 style={{ margin: 0 }}>Tools ({conn.tools.length})</h3>
            <div className="stack sm" role="list">
              {conn.tools.map((t) => (
                <label key={t.name} className={`card inset row nowrap ${t.name === tool ? 'selected' : ''}`} role="listitem" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
                  <input type="radio" name="mcp-tool" checked={t.name === tool} onChange={() => setTool(t.name)} />
                  <span className="stack" style={{ gap: 2 }}>
                    <span className="row nowrap"><b className="mono">{t.name}</b>{t.readOnly ? <span className="chip">read-only</span> : <span className="chip danger">changes state</span>}</span>
                    <span className="tiny muted">{t.description}</span>
                  </span>
                </label>
              ))}
            </div>
            {selected && (
              <>
                <details className="tiny"><summary>Input schema (JSON Schema from the server)</summary><pre className="mono">{JSON.stringify(selected.inputSchema, null, 2)}</pre></details>
                <label className="field">Arguments (JSON)<textarea className="textarea mono" aria-label="Tool arguments" value={args} onChange={(e) => setArgs(e.target.value)} style={{ minHeight: 90 }} spellCheck={false} /></label>
                <div className="row">
                  <button className="btn primary" onClick={() => void call()} disabled={busy}><Icon name="play" /> {busy ? 'Calling…' : `Call ${selected.name}`}</button>
                  <button className="btn ghost sm" onClick={() => navigate('/studio')} title={`Available in the Studio palette as ${mcpToolId(selected.name)}`}>Use in Agent Studio</button>
                </div>
                {result && (
                  <div className={`callout small ${result.isError ? 'warn' : ''}`} aria-live="polite">
                    <b>{result.isError ? 'Tool error' : 'Result'}</b>
                    <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{result.text || '(empty)'}</pre>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="stack">
            <div className="card stack sm">
              <h3 style={{ margin: 0 }}>Resources ({conn.resources.length})</h3>
              {conn.resources.length === 0 && <div className="small faint">This server exposes no resources.</div>}
              {conn.resources.map((r) => (
                <div key={r.uri} className="row between nowrap">
                  <span className="stack" style={{ gap: 2 }}><span className="mono small">{r.uri}</span><span className="tiny muted">{r.description ?? r.name}</span></span>
                  <button className="btn sm" onClick={async () => { try { setResText({ uri: r.uri, text: await conn.readResource(r.uri) }); } catch (e) { toast(String(e)); } }}>Read</button>
                </div>
              ))}
              {resText && <pre className="mono tiny card inset" style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap' }} aria-label={`Contents of ${resText.uri}`}>{resText.text}</pre>}
            </div>
            <div className="callout small">
              <b>Safety model.</b> Tools the server marks <i>read-only</i> run like any read tool. Everything else is treated as <b>high impact</b>: here you confirm each call, and in Agent Studio a workflow using it will not validate until a Human Approval node sits upstream. Annotations are hints from the server — only connect to servers you trust.
            </div>
          </div>
        </div>
      )}

      <div className="card stack sm">
        <div className="row between">
          <h3 style={{ margin: 0 }}>JSON-RPC log ({log.length})</h3>
          {log.length > 0 && <button className="btn ghost sm" onClick={clearLog}>Clear</button>}
        </div>
        {log.length === 0 ? <div className="small faint">Every message your client sends and receives appears here — initialize, tools/list, tools/call…</div> : (
          <ol className="stack sm" style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 360, overflow: 'auto' }} aria-label="Protocol messages">
            {log.slice().reverse().map((l, i) => {
              let method = '';
              try { method = JSON.parse(l.body).method ?? (JSON.parse(l.body).error ? 'error' : 'result'); } catch { method = l.status ? `HTTP ${l.status}` : ''; }
              return (
                <li key={`${l.at}-${i}`}>
                  <details>
                    <summary className="small"><span className={`chip ${l.direction === 'request' ? '' : 'success'}`}>{l.direction === 'request' ? '→ request' : '← response'}</span> <span className="mono">{method}</span> <span className="tiny faint">{new Date(l.at).toLocaleTimeString()}</span></summary>
                    <pre className="mono tiny" style={{ whiteSpace: 'pre-wrap' }}>{pretty(l.body)}</pre>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
