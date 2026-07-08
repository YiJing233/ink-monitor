import { describe, it, expect } from 'vitest';
import { isOpenAICompatible } from '../registry-meta';

/**
 * Regression: before the aggregator cleanup, groq/mistral/deepseek/moonshot/
 * zhipu/openrouter/ollama were dispatched to the *custom* fetcher instead of
 * openai. `isOpenAICompatible` is the single source of truth — if it lists
 * them, the registry must route them to the openai fetcher.
 */
describe('provider registry', () => {
  it('marks all openai-compatible providers as such', () => {
    for (const t of ['openai', 'groq', 'mistral', 'deepseek', 'moonshot', 'zhipu', 'openrouter', 'ollama']) {
      expect(isOpenAICompatible(t)).toBe(true);
    }
  });
  it('does not mark anthropic / custom / demo / minimax as openai-compatible', () => {
    for (const t of ['anthropic', 'custom', 'demo', 'minimax']) {
      expect(isOpenAICompatible(t)).toBe(false);
    }
  });
});
