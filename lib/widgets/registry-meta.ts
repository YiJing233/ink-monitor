/**
 * Client-safe constants + types from the widget registry (provider side AND
 * market side). Mirroring only the data the editor and Market page need, so
 * tests + client components don't have to touch `server-only` modules.
 */
import { z } from 'zod';

export const OPENAI_COMPATIBLE_TYPES = new Set([
  'openai', 'groq', 'mistral', 'deepseek', 'moonshot', 'zhipu', 'openrouter', 'ollama',
]);

export function isOpenAICompatible(type: string): boolean {
  return OPENAI_COMPATIBLE_TYPES.has(type);
}

// --- Market registry metadata ---

export const RegistryItemSchema = z.object({
  category: z.string().optional(),
  author: z.string().optional(),
  icon: z.string().optional(),
  manifest: z.any(), // validated separately with safeValidateManifest
});
export type RegistryItem = z.infer<typeof RegistryItemSchema>;

/**
 * Auth modes a `MARKET_REGISTRY_URL` upstream may require. The route at
 * `/api/market` reads the server-only env (`MARKET_REGISTRY_TOKEN` /
 * `MARKET_REGISTRY_HMAC_KEY`); this client-safe list is consumed by the admin
 * Market UI to render a "private registry" lock icon next to the upstream
 * indicator.
 *
 * Keep entries in sync with `lib/widgets/sign.ts` and `app/api/market/route.ts`.
 */
export const MARKET_AUTH_REQUIRED: readonly string[] = ['bearer', 'hmac'] as const;
export type MarketAuthMode = (typeof MARKET_AUTH_REQUIRED)[number];
