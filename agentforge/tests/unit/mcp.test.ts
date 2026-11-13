// Real protocol test: the demo MCP server (official SDK) on a local port, the app's MCP client, and the agent runtime.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { connectMcp, type McpConnection, type McpLogEntry } from '@/core/mcp/client';
import { mcpToolSpec, mcpToolId, MCP_PREFIX } from '@/core/mcp/tools';
import { registerExternalTools, getTool } from '@/core/runtime/tools';
import { runGraph, validateGraph, type Graph } from '@/core/runtime/agentRuntime';

let server: Server;
let conn: McpConnection;
const log: McpLogEntry[] = [];
const PORT = 18787;

beforeAll(async () => {
  const modPath = new URL('../../scripts/mcp-demo-server.mjs', import.meta.url).pathname;
  const mod = await import(/* @vite-ignore */ modPath);
  server = await mod.startDemoServer(PORT);
  conn = await connectMcp(`http://127.0.0.1:${PORT}/mcp`, (e) => log.push(e));
}, 20000);
afterAll(async () => {
  await conn?.close();
  await new Promise((r) => server?.close(r));
});

describe('MCP client against a real server', () => {
  it('initialises and discovers tools and resources', () => {
    expect(conn.serverName).toBe('agentforge-demo');
    expect(conn.capabilities).toEqual(expect.arrayContaining(['tools', 'resources']));
    expect(conn.tools.map((t) => t.name).sort()).toEqual(['create_note', 'lookup_term', 'word_count']);
    expect(conn.tools.find((t) => t.name === 'lookup_term')!.readOnly).toBe(true);
    expect(conn.tools.find((t) => t.name === 'create_note')!.readOnly).toBe(false);
    expect(conn.resources[0].uri).toBe('glossary://terms');
  });
  it('records the real JSON-RPC traffic', () => {
    const methods = log.filter((l) => l.direction === 'request').map((l) => JSON.parse(l.body).method);
    expect(methods).toEqual(expect.arrayContaining(['initialize', 'notifications/initialized', 'tools/list']));
    expect(log.some((l) => l.direction === 'response' && l.body.includes('"serverInfo"'))).toBe(true);
  });
  it('calls tools and reads resources', async () => {
    expect((await conn.callTool('lookup_term', { term: 'MCP' })).text).toMatch(/Model Context Protocol/);
    const missing = await conn.callTool('lookup_term', { term: 'flux capacitor' });
    expect(missing.isError).toBe(true);
    expect(JSON.parse((await conn.callTool('word_count', { text: 'agents use tools' })).text).words).toBe(3);
    expect(JSON.parse(await conn.readResource('glossary://terms')).token).toMatch(/chunk of text/);
  });
  it('server-side validation rejects bad arguments', async () => {
    const r = await conn.callTool('lookup_term', { term: '' }).catch((e) => ({ text: String(e), isError: true }));
    expect(r.isError).toBe(true);
  });
});

describe('MCP tools inside the agent runtime', () => {
  const g = (toolName: string, withApproval: boolean): Graph => ({
    nodes: [
      { id: 'in', kind: 'input', label: 'In', position: { x: 0, y: 0 }, config: {} },
      ...(withApproval ? [{ id: 'ap', kind: 'approval' as const, label: 'Approve', position: { x: 0, y: 0 }, config: {} }] : []),
      { id: 't', kind: 'tool', label: toolName, position: { x: 0, y: 0 }, config: { toolId: mcpToolId(toolName), argsTemplate: toolName === 'create_note' ? '{"title": "From Studio", "body": "{{input}}"}' : '{"term": "{{input}}"}' } },
      { id: 'out', kind: 'output', label: 'Out', position: { x: 0, y: 0 }, config: {} },
    ],
    edges: withApproval
      ? [{ id: 'a', source: 'in', target: 'ap' }, { id: 'b', source: 'ap', target: 't', sourceHandle: 'approved' }, { id: 'c', source: 't', target: 'out' }]
      : [{ id: 'a', source: 'in', target: 't' }, { id: 'c', source: 't', target: 'out' }],
  });
  it('unconnected MCP tools are a validation error', () => {
    registerExternalTools(MCP_PREFIX, []);
    expect(validateGraph(g('lookup_term', false)).errors[0].message).toMatch(/not connected/);
  });
  it('a connected read-only MCP tool runs in a workflow', async () => {
    registerExternalTools(MCP_PREFIX, conn.tools.map((t) => mcpToolSpec(conn, t)));
    expect(getTool('mcp__lookup_term')!.impact).toBe('read');
    const r = await runGraph(g('lookup_term', false), 'agent');
    expect(r.status).toBe('completed');
    expect(r.outputs[0].value).toMatch(/model in a loop/);
  });
  it('a state-changing MCP tool requires a Human Approval node', async () => {
    expect(validateGraph(g('create_note', false)).ok).toBe(false);
    const r = await runGraph(g('create_note', true), 'remember this', { approve: async () => true });
    expect(r.outputs[0].value).toMatch(/Saved note #1/);
  });
  it('MCP tool errors surface as tool errors', async () => {
    const r = await runGraph(g('lookup_term', false), 'flux capacitor');
    expect(r.trace.some((t) => t.kind === 'tool-error' && /No glossary entry/.test(t.message))).toBe(true);
  });
});
