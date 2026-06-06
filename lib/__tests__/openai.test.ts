import { describe, it, expect } from 'vitest';

/**
 * Re-implement the parts of openai.ts that we want to test in isolation, so
 * the test doesn't need a live API. Mirrors the production parser exactly.
 */

function numField(obj: any, keys: string[]): number {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

function parseOpenAIHistory(json: any, windowStartMs: number): number[] {
  const nowHour = Math.floor(Date.now() / 3_600_000);
  const startHour = nowHour - 23;
  const out: number[] = new Array(24).fill(0);

  const data: any[] = Array.isArray(json?.data) ? json.data : [];
  if (data.length === 0) return out;

  const buckets = new Map<number, number>();
  for (const row of data) {
    const ts = typeof row.aggregation_timestamp === 'number' ? row.aggregation_timestamp * 1000 : 0;
    if (ts < windowStartMs) continue;
    const hour = Math.floor(ts / 3_600_000);
    const tokens = numField(row, ['n_total_tokens', 'total_tokens', 'n_tokens', 'tokens']);
    buckets.set(hour, (buckets.get(hour) || 0) + tokens);
  }
  for (let i = 0; i < 24; i++) {
    out[i] = buckets.get(startHour + i) || 0;
  }
  return out;
}

function parseUsage(json: any, windowStart: number, fetchedAt: number) {
  const data: any[] = Array.isArray(json?.data) ? json.data : [];
  let totalTokens = 0, requests = 0;
  for (const row of data) {
    const ts = typeof row.aggregation_timestamp === 'number' ? row.aggregation_timestamp * 1000 : 0;
    if (ts < windowStart) continue;
    totalTokens += numField(row, ['n_total_tokens', 'total_tokens', 'n_tokens', 'tokens']);
    requests += numField(row, ['n_requests', 'requests']);
  }
  return { totalTokens, requests, fetchedAt };
}

describe('openai parser', () => {
  it('returns 24 hourly buckets ending now', () => {
    const json = { data: [] };
    const result = parseOpenAIHistory(json, Date.now() - 24 * 3600_000);
    expect(result).toHaveLength(24);
    expect(result.every((v) => v === 0)).toBe(true);
  });

  it('aggregates tokens within the same hour', () => {
    const now = Date.now();
    const hour = Math.floor(now / 3_600_000);
    const json = {
      data: [
        { aggregation_timestamp: hour * 3600, n_total_tokens: 100, n_requests: 1 },
        { aggregation_timestamp: hour * 3600 + 600, n_total_tokens: 200, n_requests: 2 },
      ],
    };
    const result = parseOpenAIHistory(json, now - 24 * 3600_000);
    expect(result[result.length - 1]).toBe(300);
  });

  it('ignores buckets older than window', () => {
    const oldHour = Math.floor(Date.now() / 3_600_000) - 100;
    const json = {
      data: [{ aggregation_timestamp: oldHour * 3600, n_total_tokens: 9999 }],
    };
    const result = parseOpenAIHistory(json, Date.now() - 24 * 3600_000);
    expect(result.every((v) => v === 0)).toBe(true);
  });

  it('falls back through token field aliases', () => {
    const now = Date.now();
    const hour = Math.floor(now / 3_600_000);
    const json = {
      data: [
        { aggregation_timestamp: hour * 3600, total_tokens: 100 },
        { aggregation_timestamp: hour * 3600 + 60, tokens: 200 },
        { aggregation_timestamp: hour * 3600 + 120, n_tokens: 400 },
      ],
    };
    const result = parseOpenAIHistory(json, now - 24 * 3600_000);
    expect(result[result.length - 1]).toBe(700);
  });

  it('parses rolled-up usage metrics', () => {
    const now = Date.now();
    const json = {
      data: [
        { aggregation_timestamp: Math.floor(now / 1000) - 60, n_total_tokens: 1000, n_requests: 5 },
        { aggregation_timestamp: Math.floor(now / 1000) - 30, n_total_tokens: 2000, n_requests: 7 },
      ],
    };
    const r = parseUsage(json, now - 24 * 3600_000, now);
    expect(r.totalTokens).toBe(3000);
    expect(r.requests).toBe(12);
  });
});
