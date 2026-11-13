// In-memory MCP session (not persisted: connections are live and must be re-made after a reload).
import { create } from 'zustand';
import { connectMcp, type McpConnection, type McpLogEntry } from './client';
import { MCP_PREFIX, mcpToolSpec } from './tools';
import { registerExternalTools } from '../runtime/tools';

interface McpState {
  conn: McpConnection | null;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  error?: string;
  log: McpLogEntry[];
  connect: (url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  clearLog: () => void;
}

const LOG_CAP = 200;

export const useMcp = create<McpState>((set, get) => ({
  conn: null,
  status: 'idle',
  log: [],
  async connect(url) {
    await get().disconnect();
    set({ status: 'connecting', error: undefined });
    try {
      const conn = await connectMcp(url, (e) => set((s) => ({ log: [...s.log, e].slice(-LOG_CAP) })));
      registerExternalTools(MCP_PREFIX, conn.tools.map((t) => mcpToolSpec(conn, t)));
      set({ conn, status: 'connected' });
    } catch (e) {
      registerExternalTools(MCP_PREFIX, []);
      const msg = e instanceof Error ? e.message : String(e);
      set({ conn: null, status: 'error', error: /fetch|network|Failed/i.test(msg) ? `${msg} — is the server running, and does it allow this origin (CORS)?` : msg });
    }
  },
  async disconnect() {
    const c = get().conn;
    registerExternalTools(MCP_PREFIX, []);
    set({ conn: null, status: 'idle' });
    await c?.close().catch(() => undefined);
  },
  clearLog: () => set({ log: [] }),
}));
