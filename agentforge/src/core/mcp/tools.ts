// Turns tools from a connected MCP server into Agent Studio tools.
import { z } from 'zod';
import type { ToolSpec } from '../runtime/tools';
import type { McpConnection, McpToolInfo } from './client';

export const MCP_PREFIX = 'mcp__';
export const mcpToolId = (name: string) => `${MCP_PREFIX}${name.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);

/** Build a Zod validator from a (simple) JSON Schema so the runtime validates arguments before calling the server. */
export function zodFromJsonSchema(schema: Record<string, unknown>): z.ZodTypeAny {
  const props = (schema.properties ?? {}) as Record<string, { type?: string | string[] }>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, p] of Object.entries(props)) {
    const t = Array.isArray(p.type) ? p.type[0] : p.type;
    let v: z.ZodTypeAny = t === 'string' ? z.string() : t === 'number' || t === 'integer' ? z.number() : t === 'boolean' ? z.boolean() : t === 'array' ? z.array(z.unknown()) : t === 'object' ? z.record(z.unknown()) : z.unknown();
    if (!required.has(k)) v = v.optional();
    shape[k] = v;
  }
  return z.object(shape).passthrough();
}

export function mcpToolSpec(conn: Pick<McpConnection, 'callTool' | 'serverName'>, t: McpToolInfo): ToolSpec {
  const props = Object.keys(((t.inputSchema.properties ?? {}) as Record<string, unknown>));
  return {
    id: mcpToolId(t.name),
    name: t.name,
    description: `${t.description ?? t.title ?? t.name} (MCP server: ${conn.serverName})`,
    schema: zodFromJsonSchema(t.inputSchema),
    schemaText: `{ ${props.join(', ')} }`,
    impact: t.readOnly ? 'read' : 'external',
    triggers: [...new Set(t.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))],
    jsonSchema: t.inputSchema,
    source: `mcp:${conn.serverName}`,
    run: async (args) => {
      const r = await conn.callTool(t.name, args as Record<string, unknown>);
      if (r.isError) throw new Error(r.text || 'MCP tool returned an error');
      return { text: r.text };
    },
  };
}
