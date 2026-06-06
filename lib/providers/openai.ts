import type { Provider, ProviderType } from '../db';
import type { UsageSnapshot, UsageMetric } from './types';

const DEFAULT_BASE = 'https://api.openai.com';
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * OpenAI usage fetch.
 *
 *   GET {base}/v1/usage?date=       — returns hourly buckets for the current
 *   UTC day. (We omit `date=` to get the default which is today UTC.)
 *
 *   Response shape:
 *     { object: "list", data: [
 *         { aggregation_timestamp, n_requests, n_successful_requests,
 *           n_input_tokens, n_output_tokens, n_total_tokens, ... },
 *         ...
 *     ]}
 *
 *   Buckets are 1h wide and we want a ROLLING 24h window, so we sum the last
 *   24 hourly buckets relative to "now" (not "start of UTC day", which would
 *   miss data on the wrong side of midnight).
 */
export async function fetchOpenAIUsage(p: Provider, apiKey: string): Promise<UsageSnapshot> {
  const base = (p.base_url || DEFAULT_BASE).replace(/\/$/, '');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const fetchedAt = Date.now();
  const windowStart = fetchedAt - ROLLING_WINDOW_MS;

  try {
    const res = await fetch(`${base}/v1/usage`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        error: `OpenAI /v1/usage returned ${res.status}: ${errText.slice(0, 200)}`,
        metrics: [],
        fetchedAt,
      };
    }

    const json: any = await res.json();
    const metrics = parseOpenAIUsageJson(json, windowStart, fetchedAt);
    const history = parseOpenAIHistory(json, windowStart);
    return {
      ok: true,
      metrics,
      raw: json,
      fetchedAt,
      history: history.length > 0 ? history : undefined,
      historyUnit: 'tokens',
      historyWindow: '24h',
    };
  } catch (e: any) {
    return {
      ok: false,
      error: `OpenAI request failed: ${e?.message || String(e)}`,
      metrics: [],
      fetchedAt,
    };
  }
}

function parseOpenAIUsageJson(json: any, windowStart: number, fetchedAt: number): UsageMetric[] {
  const data: any[] = Array.isArray(json?.data) ? json.data : [];

  if (data.length === 0) {
    return [
      {
        label: 'API Activity',
        used: 0,
        limit: null,
        unit: 'tokens',
        resetAt: null,
        window: '24h',
      },
    ];
  }

  // Sum buckets whose aggregation_timestamp (in seconds) is within the
  // rolling 24h window. Buckets are typically 1h wide.
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let requests = 0;
  let successful = 0;
  let latestBucketMs = 0;

  for (const row of data) {
    const ts = typeof row.aggregation_timestamp === 'number' ? row.aggregation_timestamp * 1000 : 0;
    if (ts < windowStart) continue;
    if (ts > latestBucketMs) latestBucketMs = ts;
    totalTokens += numField(row, ['n_total_tokens', 'total_tokens', 'n_tokens', 'tokens']);
    inputTokens += numField(row, ['n_input_tokens', 'input_tokens', 'prompt_tokens']);
    outputTokens += numField(row, ['n_output_tokens', 'output_tokens', 'completion_tokens']);
    requests += numField(row, ['n_requests', 'requests']);
    successful += numField(row, ['n_successful_requests', 'successful_requests']);
  }

  // Reset anchor: end of the latest 1h bucket we observed + remaining time
  // in the 24h window from that bucket. If we have no data, fall back to
  // the natural wall-clock reset.
  let resetAt: number;
  if (latestBucketMs > 0) {
    const bucketEnd = latestBucketMs + 60 * 60 * 1000;
    resetAt = bucketEnd + (ROLLING_WINDOW_MS - (bucketEnd - windowStart));
  } else {
    resetAt = windowStart + ROLLING_WINDOW_MS;
  }
  // Clamp to fetchedAt + window so the UI never shows a reset in the past
  if (resetAt < fetchedAt) resetAt = windowStart + ROLLING_WINDOW_MS;

  const metrics: UsageMetric[] = [
    {
      label: 'Tokens (24h)',
      used: totalTokens,
      limit: null,
      unit: 'tokens',
      resetAt,
      window: '24h rolling',
    },
    {
      label: 'Requests (24h)',
      used: requests,
      limit: null,
      unit: 'requests',
      resetAt,
      window: '24h rolling',
    },
  ];
  if (inputTokens > 0 || outputTokens > 0) {
    metrics.push({
      label: 'Input (24h)',
      used: inputTokens,
      limit: null,
      unit: 'tokens',
      resetAt,
      window: '24h rolling',
    });
    metrics.push({
      label: 'Output (24h)',
      used: outputTokens,
      limit: null,
      unit: 'tokens',
      resetAt,
      window: '24h rolling',
    });
  }
  if (successful > 0) {
    metrics.push({
      label: 'Successful (24h)',
      used: successful,
      limit: null,
      unit: 'requests',
      resetAt,
      window: '24h rolling',
    });
  }
  return metrics;
}

function numField(obj: any, keys: string[]): number {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

/**
 * Build a 24-element array of hourly token totals ending at the latest
 * bucket we have. Returns [] if no usable buckets.
 */
function parseOpenAIHistory(json: any, windowStartMs: number): number[] {
  const data: any[] = Array.isArray(json?.data) ? json.data : [];
  if (data.length === 0) return [];

  // Bucket by hour (epoch hour). Latest hour first in the response, but we
  // don't rely on that — we sort.
  const buckets = new Map<number, number>();
  for (const row of data) {
    const ts = typeof row.aggregation_timestamp === 'number' ? row.aggregation_timestamp * 1000 : 0;
    if (ts < windowStartMs) continue;
    const hour = Math.floor(ts / 3_600_000);
    const tokens = numField(row, ['n_total_tokens', 'total_tokens', 'n_tokens', 'tokens']);
    buckets.set(hour, (buckets.get(hour) || 0) + tokens);
  }
  if (buckets.size === 0) return [];

  // 24 hours ending at the latest bucket we have, anchored to wall clock.
  // We want "last 24h" relative to the latest bucket, not relative to now,
  // because OpenAI may lag a few minutes.
  const nowHour = Math.floor(Date.now() / 3_600_000);
  const startHour = nowHour - 23;
  const out: number[] = [];
  for (let h = startHour; h <= nowHour; h++) {
    out.push(buckets.get(h) || 0);
  }
  return out;
}

export const openaiProvider = {
  type: 'openai' as ProviderType,
  label: 'OpenAI / Codex',
  fetch: fetchOpenAIUsage,
};
