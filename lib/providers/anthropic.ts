import type { Provider, ProviderType } from '../db';
import type { UsageSnapshot, UsageMetric } from './types';

const DEFAULT_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Anthropic does NOT expose a public usage API. The only signal we can
 * read is the per-request rate-limit headers returned on any /v1/messages
 * response. We make a minimal valid request and parse the headers.
 *
 *   anthropic-ratelimit-requests-limit
 *   anthropic-ratelimit-requests-remaining
 *   anthropic-ratelimit-requests-reset
 *   anthropic-ratelimit-tokens-limit
 *   anthropic-ratelimit-tokens-remaining
 *   anthropic-ratelimit-tokens-reset
 *   anthropic-ratelimit-input-tokens-limit / -remaining / -reset
 *   anthropic-ratelimit-output-tokens-limit / -remaining / -reset
 *
 * The cheapest valid call is /v1/messages with max_tokens=1 and a one-token
 * prompt, but that still costs ~1 token. We accept the cost in exchange for
 * accurate per-window usage.
 */
export async function fetchAnthropicUsage(p: Provider, apiKey: string): Promise<UsageSnapshot> {
  const base = (p.base_url || DEFAULT_BASE).replace(/\/$/, '');
  const fetchedAt = Date.now();

  try {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'a' }],
      }),
      signal: AbortSignal.timeout(8000),
    });

    const headers = res.headers;
    const get = (k: string) => headers.get(k);

    if (!res.ok) {
      // 401/403 — bad key. Don't include header parse.
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Anthropic ${res.status}: ${errText.slice(0, 200)}`,
        metrics: [],
        fetchedAt,
      };
    }

    const metrics = parseAnthropicHeaders(headers, fetchedAt);
    return { ok: true, metrics, fetchedAt };
  } catch (e: any) {
    return {
      ok: false,
      error: `Anthropic request failed: ${e?.message || String(e)}`,
      metrics: [],
      fetchedAt,
    };
  }
}

function num(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function epochFromReset(s: string | null): number | null {
  if (s == null) return null;
  // Anthropic reset headers are unix timestamps (seconds) per their docs.
  // Older docs show relative seconds; we accept both.
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // If the value is < 10^11 it's almost certainly seconds; otherwise ms.
  return n < 1e11 ? n * 1000 : n;
}

function parseAnthropicHeaders(headers: Headers, fetchedAt: number): UsageMetric[] {
  const metrics: UsageMetric[] = [];

  const reqLimit = num(headers.get('anthropic-ratelimit-requests-limit'));
  const reqRem = num(headers.get('anthropic-ratelimit-requests-remaining'));
  const reqReset = epochFromReset(headers.get('anthropic-ratelimit-requests-reset'));

  if (reqLimit != null) {
    metrics.push({
      label: 'Requests',
      used: reqLimit != null && reqRem != null ? Math.max(0, reqLimit - reqRem) : 0,
      limit: reqLimit,
      unit: 'requests',
      resetAt: reqReset,
      window: 'window',
    });
  }

  const tokLimit = num(headers.get('anthropic-ratelimit-tokens-limit'));
  const tokRem = num(headers.get('anthropic-ratelimit-tokens-remaining'));
  const tokReset = epochFromReset(headers.get('anthropic-ratelimit-tokens-reset'));

  if (tokLimit != null) {
    metrics.push({
      label: 'Tokens',
      used: tokLimit != null && tokRem != null ? Math.max(0, tokLimit - tokRem) : 0,
      limit: tokLimit,
      unit: 'tokens',
      resetAt: tokReset,
      window: 'window',
    });
  }

  // Per-kind token breakdowns, if present
  const inLimit = num(headers.get('anthropic-ratelimit-input-tokens-limit'));
  const inRem = num(headers.get('anthropic-ratelimit-input-tokens-remaining'));
  const inReset = epochFromReset(headers.get('anthropic-ratelimit-input-tokens-reset'));
  if (inLimit != null) {
    metrics.push({
      label: 'Input tokens',
      used: inLimit != null && inRem != null ? Math.max(0, inLimit - inRem) : 0,
      limit: inLimit,
      unit: 'tokens',
      resetAt: inReset,
      window: 'window',
    });
  }

  const outLimit = num(headers.get('anthropic-ratelimit-output-tokens-limit'));
  const outRem = num(headers.get('anthropic-ratelimit-output-tokens-remaining'));
  const outReset = epochFromReset(headers.get('anthropic-ratelimit-output-tokens-reset'));
  if (outLimit != null) {
    metrics.push({
      label: 'Output tokens',
      used: outLimit != null && outRem != null ? Math.max(0, outLimit - outRem) : 0,
      limit: outLimit,
      unit: 'tokens',
      resetAt: outReset,
      window: 'window',
    });
  }

  if (metrics.length === 0) {
    return [
      {
        label: 'Anthropic',
        used: 0,
        limit: null,
        unit: 'requests',
        resetAt: null,
        window: 'live',
      },
    ];
  }
  return metrics;
}

export const anthropicProvider = {
  type: 'anthropic' as ProviderType,
  label: 'Anthropic Claude',
  fetch: fetchAnthropicUsage,
};
