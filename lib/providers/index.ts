import 'server-only';
import { openaiProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { customProvider } from './custom';
import { demoProvider } from './demo';
import { minimaxProvider } from './minimax';
import type { Provider } from '../db';
import { decryptForUser } from '../crypto';
import { isOpenAICompatible } from './registry-meta';
import type { UsageSnapshot } from './types';

const REGISTRY: Record<string, { type: string; label: string; fetch: any }> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  custom: customProvider,
  demo: demoProvider,
  groq: openaiProvider,
  mistral: openaiProvider,
  deepseek: openaiProvider,
  moonshot: openaiProvider,
  zhipu: openaiProvider,
  openrouter: openaiProvider,
  ollama: openaiProvider,
  // MiniMax has its own fetcher (different auth model + endpoint shape)
  minimax: minimaxProvider,
};

/**
 * Per-user fetch: the single entry point. Keeps registry lookup in one place —
 * historically the aggregator re-implemented it and mis-routed groq/mistral/etc
 * to the `custom` fetcher instead of `openai`.
 */
export async function fetchUsageForUser(p: Provider, userId: string): Promise<UsageSnapshot> {
  const fetcher = REGISTRY[p.type];
  if (!fetcher) {
    return { ok: false, error: `Unknown provider type: ${p.type}`, metrics: [], fetchedAt: Date.now() };
  }
  if (p.type === 'demo') return fetcher.fetch(p, '');
  let apiKey = '';
  try {
    apiKey = decryptForUser(userId, p.api_key_encrypted);
  } catch (e: any) {
    return { ok: false, error: `Failed to decrypt API key: ${e?.message || String(e)}`, metrics: [], fetchedAt: Date.now() };
  }
  return fetcher.fetch(p, apiKey);
}

export { isOpenAICompatible } from './registry-meta';

export { type UsageSnapshot, type UsageMetric } from './types';
export { PROVIDER_LABELS } from './labels';
export { OPENAI_COMPATIBLE_TYPES } from './registry-meta';
