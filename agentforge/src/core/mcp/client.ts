// MCP client for the browser, built on the official MCP TypeScript SDK (Streamable HTTP transport).
// Every JSON-RPC message is recorded so learners can see the real protocol traffic.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}
export interface McpLogEntry {
  at: number;
  direction: 'request' | 'response';
  status?: number;
  body: string;
}
export interface McpConnection {
  url: string;
  serverName: string;
  serverVersion: string;
  protocolVersion?: string;
  capabilities: string[];
  tools: McpToolInfo[];
  resources: { uri: string; name: string; description?: string }[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean; raw: unknown }>;
  readResource: (uri: string) => Promise<string>;
  close: () => Promise<void>;
}

export async function connectMcp(url: string, onLog?: (e: McpLogEntry) => void): Promise<McpConnection> {
  const loggingFetch: typeof fetch = async (input, init) => {
    if (init?.body && typeof init.body === 'string') onLog?.({ at: Date.now(), direction: 'request', body: init.body });
    const res = await fetch(input, init);
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const text = await res.clone().text();
      if (text) onLog?.({ at: Date.now(), direction: 'response', status: res.status, body: text });
    } else if (!res.ok) {
      onLog?.({ at: Date.now(), direction: 'response', status: res.status, body: `(HTTP ${res.status})` });
    }
    return res;
  };
  const transport = new StreamableHTTPClientTransport(new URL(url), { fetch: loggingFetch });
  const client = new Client({ name: 'agentforge', version: '1.0.0' });
  await client.connect(transport);
  const info = client.getServerVersion();
  const caps = client.getServerCapabilities() ?? {};
  const tools: McpToolInfo[] = caps.tools
    ? (await client.listTools()).tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema as Record<string, unknown>, readOnly: t.annotations?.readOnlyHint === true }))
    : [];
  const resources = caps.resources ? (await client.listResources()).resources.map((r) => ({ uri: r.uri, name: r.name, description: r.description })) : [];
  return {
    url,
    serverName: info?.name ?? 'unknown',
    serverVersion: info?.version ?? '',
    protocolVersion: transport.protocolVersion,
    capabilities: Object.keys(caps),
    tools,
    resources,
    async callTool(name, args) {
      const r = (await client.callTool({ name, arguments: args })) as { content?: { type: string; text?: string }[]; isError?: boolean };
      const text = (r.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.type}]`)).join('\n');
      return { text, isError: !!r.isError, raw: r };
    },
    async readResource(uri) {
      const r = await client.readResource({ uri });
      return r.contents.map((c) => ('text' in c ? String(c.text) : '[binary]')).join('\n');
    },
    close: () => client.close(),
  };
}
