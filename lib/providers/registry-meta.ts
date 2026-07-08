/**
 * Client-safe constants from the provider registry. Kept separate from
 * `lib/providers/index.ts` (which is `server-only`) so tests and client code
 * can import them.
 */
export const OPENAI_COMPATIBLE_TYPES = new Set([
  'openai', 'groq', 'mistral', 'deepseek', 'moonshot', 'zhipu', 'openrouter', 'ollama',
]);

export function isOpenAICompatible(type: string): boolean {
  return OPENAI_COMPATIBLE_TYPES.has(type);
}
