// AIProviderManager — optional, user-configured, local-only provider access.
// Keys live only in this browser's IndexedDB and are sent only to the chosen provider.
// For any public deployment, route calls through a backend proxy instead (see docs/PROVIDERS.md).
import Anthropic from '@anthropic-ai/sdk';
import type { ProviderConfig } from '../types';
import type { ModelTurn, ToolDef } from './livePolicy';

export const DEFAULT_MODELS: Record<'anthropic' | 'openai', string> = {
  anthropic: 'claude-opus-5-5',
  openai: '', // user must enter a model id they have access to — we do not guess
};

export interface CompletionRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
}
export interface CompletionResult {
  text: string;
  model: string;
  provider: 'anthropic' | 'openai';
  usage?: { input: number; output: number };
  stopReason?: string;
}

export class ProviderError extends Error {}

export function providerReady(p: ProviderConfig): boolean {
  return p.provider !== 'none' && !!p.apiKey.trim() && !!(p.model || (p.provider === 'anthropic' && DEFAULT_MODELS.anthropic)) && p.consent;
}

export async function complete(p: ProviderConfig, req: CompletionRequest): Promise<CompletionResult> {
  if (!providerReady(p)) throw new ProviderError('No AI provider configured. Add one in Settings → AI provider.');
  if (p.provider === 'anthropic') return completeAnthropic(p, req);
  return completeOpenAI(p, req);
}

async function completeAnthropic(p: ProviderConfig, req: CompletionRequest): Promise<CompletionResult> {
  const client = new Anthropic({ apiKey: p.apiKey.trim(), dangerouslyAllowBrowser: true });
  const model = p.model || DEFAULT_MODELS.anthropic;
  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: req.maxTokens ?? 4000,
      system: req.system,
      messages: req.messages,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as Parameters<typeof client.beta.messages.create>[0]);
    const msg = res as Anthropic.Beta.BetaMessage;
    if (msg.stop_reason === 'refusal') return { text: 'The model declined this request.', model: msg.model, provider: 'anthropic', stopReason: 'refusal' };
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    return { text: text || '(empty response)', model: msg.model, provider: 'anthropic', usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens }, stopReason: msg.stop_reason ?? undefined };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new ProviderError('Authentication failed — check your Anthropic API key.');
    if (e instanceof Anthropic.RateLimitError) throw new ProviderError('Rate limited by the provider — wait a moment and try again.');
    if (e instanceof Anthropic.NotFoundError) throw new ProviderError(`Model "${model}" not found or not available to your key.`);
    if (e instanceof Anthropic.APIConnectionError) throw new ProviderError('Could not reach the Anthropic API (network or browser restrictions).');
    if (e instanceof Anthropic.APIError) throw new ProviderError(`Anthropic API error ${e.status ?? ''}: ${e.message}`);
    throw new ProviderError(String((e as Error).message ?? e));
  }
}

async function completeOpenAI(p: ProviderConfig, req: CompletionRequest): Promise<CompletionResult> {
  if (!p.model.trim()) throw new ProviderError('Enter the OpenAI model id you want to use in Settings.');
  // Chat Completions is a long-standing, documented OpenAI endpoint. See developers.openai.com/api/docs.
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey.trim()}` },
      body: JSON.stringify({ model: p.model.trim(), messages: [{ role: 'system', content: req.system }, ...req.messages], max_completion_tokens: req.maxTokens ?? 4000 }),
    });
  } catch {
    throw new ProviderError('Could not reach the OpenAI API (network or browser restrictions).');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ProviderError(`OpenAI API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content ?? '(empty response)', model: data.model ?? p.model, provider: 'openai', usage: data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens } : undefined, stopReason: data.choices?.[0]?.finish_reason };
}

// ───────── Tool-use call for the Agent Studio live policy (Anthropic only)

export async function callWithTools(p: ProviderConfig, req: { system: string; user: string; tools: ToolDef[] }): Promise<ModelTurn> {
  if (!providerReady(p) || p.provider !== 'anthropic') throw new ProviderError('Live agent decisions need an Anthropic provider configured in Settings.');
  const client = new Anthropic({ apiKey: p.apiKey.trim(), dangerouslyAllowBrowser: true });
  const model = p.model || DEFAULT_MODELS.anthropic;
  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 2000,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      tools: req.tools.map((t) => ({ ...t, strict: true })),
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as Parameters<typeof client.beta.messages.create>[0]);
    const msg = res as Anthropic.Beta.BetaMessage;
    if (msg.stop_reason === 'refusal') return { text: 'The model declined this request.', model: msg.model };
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    const tu = msg.content.find((b) => b.type === 'tool_use');
    if (tu && tu.type === 'tool_use') return { toolUse: { name: tu.name, input: (tu.input ?? {}) as Record<string, unknown> }, text, model: msg.model };
    return { text, model: msg.model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new ProviderError('Authentication failed — check your Anthropic API key.');
    if (e instanceof Anthropic.RateLimitError) throw new ProviderError('Rate limited by the provider — wait a moment and try again.');
    if (e instanceof Anthropic.APIError) throw new ProviderError(`Anthropic API error ${e.status ?? ''}: ${e.message}`);
    throw new ProviderError(String((e as Error).message ?? e));
  }
}
