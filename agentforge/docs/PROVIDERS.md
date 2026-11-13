# AI provider integration (optional)

AgentForge is fully usable offline. Connecting a provider adds:

- **Forge Guide** free-form tutoring in nine modes (explain simply, Socratic, hint, find my mistake…)
- **Prompt Lab** live runs of your prompt against the task material
- **API Lab** sending your validated request for real (Anthropic)
- **Agent Studio** "Live Claude" decisions (Anthropic only): one API call per agent step, with only the attached tools declared (strict schemas); the runtime still validates, gates and bounds everything
- **Interview Simulator** optional rubric-based model grading (disclosed as fallible; heuristic fallback)

Every live output is labelled **LIVE MODEL** with the model id. Without a provider, the app uses authored content labelled as such — it never fakes AI responses or streaming.

## Configure (local, per browser)

Settings → AI provider → choose Anthropic or OpenAI → paste a key → enter/confirm a model id → tick the consent box → **Test connection**.

- **Anthropic** uses the official `@anthropic-ai/sdk` in the browser (`dangerouslyAllowBrowser: true`). Default model: `claude-opus-5-5` (editable). Requests use the beta Messages endpoint with server-side refusal fallbacks (`fallbacks: "default"`) and `output_config.effort: "low"` for quick tutoring replies; refusals are surfaced honestly.
- **OpenAI** uses the documented Chat Completions endpoint via `fetch`. You must enter a model id your key can access — the app does not guess model names.

Keys are stored only in this browser's IndexedDB, sent only to the selected provider, and excluded from exports. "Remove key" deletes it.

## Production / shared deployments: use a backend proxy

Browser-held keys are visible to anyone with access to the device and to malicious extensions. For any deployment used by others:

1. Run a small server endpoint (e.g. `POST /api/mentor`) that holds the provider key in an environment variable or secrets manager.
2. Authenticate the user, rate-limit per user, cap `max_tokens`, and log usage (without logging content you don't need).
3. Point `src/core/ai/provider.ts` at that endpoint instead of the provider (replace `completeAnthropic` / `completeOpenAI` with a `fetch` to your proxy). The rest of the app is unchanged — every feature goes through `complete()`.

## Privacy

When connected, the following are sent to the provider: the mentor mode prompt, the current lesson title/objective and skill summary, your last five scores, your top weak skills, the current exercise prompt (never the answer key), and the text you type. Learner text is wrapped in tags and the system prompt instructs the model to treat it as data.
