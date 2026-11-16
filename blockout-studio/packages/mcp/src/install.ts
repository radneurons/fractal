/** `pnpm mcp:install` — prints the exact config for Claude Code and Claude Desktop. */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), entry = resolve(root, 'packages/mcp/src/index.ts');
const desktop = { mcpServers: { blockout: { command: 'npx', args: ['-y', 'tsx', entry], env: { BLOCKOUT_BRIDGE_URL: 'http://127.0.0.1:8787' } } } };
console.log(`Blockout Studio — MCP setup

1) Claude Code (run once, from any directory):

   claude mcp add blockout -- npx -y tsx ${entry}

   Then in Claude Code:  /mcp  → "blockout" should be connected.  Try:
   "Summarise the Blockout project, look at shot s4, run the continuity check and propose a fix."

2) Claude Desktop — add to claude_desktop_config.json
   (macOS: ~/Library/Application Support/Claude/, Windows: %APPDATA%\\Claude\\):

${JSON.stringify(desktop, null, 2).split('\n').map((l) => '   ' + l).join('\n')}

Notes
- The server talks to the local bridge at 127.0.0.1:8787. Start it with \`pnpm bridge\` (or let the MCP server start one itself).
- Open the studio (\`pnpm dev\`) to review proposals; Claude's edits are never applied without you.
- To use MCP as the studio's Claude backend, pick "Claude over MCP" in the Claude tab and tell Claude: "work the Blockout task queue".
`);
