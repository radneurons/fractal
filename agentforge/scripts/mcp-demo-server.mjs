// A small, safe MCP server for learning, built with the official MCP TypeScript SDK.
// Run it with `npm run mcp:demo`, then connect from AgentForge → Practice Lab → MCP Lab (http://localhost:8787/mcp).
// Tools are deterministic and local: nothing here touches your files or the internet.
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const GLOSSARY = {
  token: 'A chunk of text a model reads or writes; limits, cost and latency are measured in tokens.',
  'context window': 'The maximum number of tokens a model can consider in one request, including its own output.',
  agent: 'A system that uses a model in a loop to choose actions (tool calls) toward a goal, observing results until a stop condition.',
  mcp: 'Model Context Protocol: an open protocol for connecting AI applications to tools and data through servers.',
  rag: 'Retrieval-augmented generation: retrieving relevant source chunks and grounding the model\'s answer in them.',
  hallucination: 'Fluent, confident output that is not supported by facts or the provided sources.',
  eval: 'A fixed set of test cases plus a grading method, run repeatedly to measure quality and catch regressions.',
  'prompt injection': 'Text in content an AI processes that tries to override the developer\'s or user\'s instructions.',
};

/** Builds a fresh server instance. `notes` is shared so created notes persist while the process runs. */
export function createDemoServer(notes = []) {
  const server = new McpServer({ name: 'agentforge-demo', version: '1.0.0' });
  server.registerTool('lookup_term', {
    title: 'Look up an AI term',
    description: 'Return the glossary definition of an AI term such as "token", "agent", "mcp" or "rag". Use for definitions only.',
    inputSchema: { term: z.string().min(1).describe('The term to define, e.g. "context window"') },
    annotations: { readOnlyHint: true },
  }, async ({ term }) => {
    const key = term.trim().toLowerCase();
    const def = GLOSSARY[key];
    return def
      ? { content: [{ type: 'text', text: `${key}: ${def}` }] }
      : { content: [{ type: 'text', text: `No glossary entry for "${term}". Known terms: ${Object.keys(GLOSSARY).join(', ')}.` }], isError: true };
  });
  server.registerTool('word_count', {
    title: 'Count words',
    description: 'Count the words and characters in a piece of text.',
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: true },
  }, async ({ text }) => {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { content: [{ type: 'text', text: JSON.stringify({ words, characters: text.length }) }] };
  });
  server.registerTool('create_note', {
    title: 'Create a note',
    description: 'Save a short note on the demo server (in memory only). This changes server state.',
    inputSchema: { title: z.string().min(1).max(80), body: z.string().max(2000) },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ title, body }) => {
    notes.push({ id: notes.length + 1, title, body });
    return { content: [{ type: 'text', text: `Saved note #${notes.length}: ${title}` }] };
  });
  server.registerResource('glossary', 'glossary://terms', { title: 'AI glossary', description: 'All glossary terms and definitions', mimeType: 'application/json' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(GLOSSARY, null, 2) }],
  }));
  return server;
}

/** Starts a stateless Streamable HTTP endpoint with CORS so a browser app can connect. */
export function startDemoServer(port = 8787, host = '127.0.0.1') {
  const notes = [];
  const httpServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (!req.url?.startsWith('/mcp')) return void res.writeHead(404).end('Not found — the MCP endpoint is /mcp');
    if (req.method !== 'POST') return void res.writeHead(405, { Allow: 'POST, OPTIONS' }).end('This demo server is stateless: use POST');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return void res.writeHead(400).end('Invalid JSON');
    }
    const server = createDemoServer(notes);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  return new Promise((resolve) => httpServer.listen(port, host, () => resolve(httpServer)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  await startDemoServer(port);
  console.log(`AgentForge demo MCP server listening on http://localhost:${port}/mcp (Ctrl+C to stop)`);
}
