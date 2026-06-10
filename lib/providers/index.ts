import 'server-only';
import { openaiProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { customProvider } from './custom';
import { demoProvider } from './demo';
import { minimaxProvider } from './minimax';
import type { Provider } from '../db';
import { decrypt } from '../crypto';
import type { UsageSnapshot } from './types';

// All OpenAI-compatible services share the openai fetcher. The default
// base_url + endpoint are pre-filled by lib/providers/labels.ts based on
// the provider's `type` field.
const OPENAI_COMPATIBLE = new Set([
  'openai', 'groq', 'mistral', 'deepseek', 'moonshot', 'zhipu', 'openrouter', 'ollama',
]);

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

export async function fetchUsage(p: Provider): Promise<UsageSnapshot> {
  const fetcher = REGISTRY[p.type];
  if (!fetcher) {
    return {
      ok: false,
      error: `Unknown provider type: ${p.type}`,
      metrics: [],
      fetchedAt: Date.now(),
    };
  }
  // Demo provider doesn't need a real key
  let apiKey = '';
  if (p.type !== 'demo') {
    try {
      apiKey = decrypt(p.api_key_encrypted);
    } catch (e: any) {
      return {
        ok: false,
        error: `Failed to decrypt API key: ${e?.message || String(e)}`,
        metrics: [],
        fetchedAt: Date.now(),
      };
    }
  }
  return fetcher.fetch(p, apiKey);
}

export function isOpenAICompatible(type: string): boolean {
  return OPENAI_COMPATIBLE.has(type);
}

export { type UsageSnapshot, type UsageMetric } from './types';
export { PROVIDER_LABELS } from './labels';
