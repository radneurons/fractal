# Security & privacy notes

## Threat model (client-only app)

| Asset / risk | Control |
|---|---|
| Learner code execution | Runs only in a dedicated Web Worker: no DOM; network, storage and worker-spawning globals removed before learner code loads; 2 s wall-clock kill via `terminate()`; output capped at 200 log lines. **Python** runs in CPython compiled to WebAssembly (Pyodide, bundled with the app — no CDN) inside its own module worker: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, storage and worker-spawning globals are removed after the runtime loads and before any learner code runs; no package installation; 5 s wall-clock kill, after which the worker is replaced. Shell and repository-level exercises are **not** offered — they need an isolated server-side sandbox, which this client-only build does not include. |
| Simulated terminal | Pure in-memory state machine. Destructive commands (`rm`, `git push`) are refused with an explanation. Nothing touches the real filesystem. |
| Agent Studio tools | All tools are local and deterministic (safe shunting-yard calculator — no `eval`; local knowledge base; mock order/weather/revenue data; virtual files with `..` and absolute paths denied; simulated outbox). External-impact tools require a Human Approval node at validation time **and** are denied at runtime without approval on the path. |
| MCP servers (MCP Lab) | Connections are made only to a URL the learner types, live only in memory (never persisted or exported) and use the official MCP SDK. Tools the server marks read-only are treated as `read`; every other MCP tool is treated as `external` (high impact): the MCP Lab asks for confirmation before each call and Agent Studio refuses to validate a workflow unless a Human Approval node is upstream. Annotations are hints from the server, so the UI tells learners to connect only to servers they trust. Tool results are passed to live models as data inside `<actions_so_far>` with an explicit injection warning. The bundled demo server (`npm run mcp:demo`) binds to 127.0.0.1, has no file or network access and keeps notes in memory. |
| API keys | Optional, user-entered, stored in IndexedDB only, sent only to the chosen provider, excluded from exports, removable. Risk explained in Settings; backend proxy documented for shared deployments (docs/PROVIDERS.md). |
| Prompt injection into the mentor | Mentor system prompt is fixed per mode; lesson/learner text is wrapped in `<context>`, `<question>` or `<learner_work>` tags and declared to be data; the mentor has no tools. Interview model-grading wraps the answer in `<answer>` tags and asks for JSON only; parse failures fall back to the heuristic. |
| Rendering untrusted text | No `dangerouslySetInnerHTML`. A minimal Markdown renderer builds React elements; links are limited to `http(s)` and open with `rel="noreferrer noopener"`. |
| Injection exercises | Harmless, sandboxed scenarios with fake addresses (`*.test`); nothing is sent anywhere. |
| Learner data | Local by default (IndexedDB). JSON/Markdown export and full delete in Settings. Imports accept only known keys. |

## External network requests

- None by default. Fonts (Inter, Space Grotesk, JetBrains Mono) and the Python runtime are bundled with the app.
- Provider APIs only when you connect one.
- MCP servers only when you connect one in MCP Lab.

## Known limitations

- Answer keys ship in the client bundle; a determined learner can read them. Assessments are for learning, not certification.
- Heuristic short-answer and interview grading checks for key concepts with keywords; it can miss correct answers phrased differently and is labelled as such.
