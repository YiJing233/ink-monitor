import type { Provider, ProviderType } from '../db';
import type { UsageSnapshot, UsageMetric } from './types';

/**
 * Demo provider — returns canned but time-varying usage data. The `used` and
 * `resetAt` values shift each minute so the display visibly changes on
 * refresh. Useful for trying the dashboard without configuring a real API.
 */
export async function fetchDemoUsage(p: Provider, _apiKey: string): Promise<UsageSnapshot> {
  // Deterministic per provider: hash the id to a base
  const base = hashCode(p.id);
  const now = Date.now();
  const minuteOfDay = Math.floor(now / 60000) % 1440;
  const oscillation = Math.sin((now / 60000) * 0.1 + base) * 0.3 + 0.5; // 0.2..0.8

  // Make a believable "5h rolling" window
  const windowMs = 5 * 60 * 60 * 1000;
  const resetAt = now + (1 - oscillation) * windowMs;

  // Vary a few metrics so the dashboard feels alive
  const seed = (base % 1000) / 1000;
  const tokensUsed = Math.floor((200_000 + seed * 800_000) * (0.3 + oscillation * 0.7));
  const tokensLimit = 1_000_000;
  const requestsUsed = Math.floor((40 + seed * 100) * (0.3 + oscillation * 0.7));
  const requestsLimit = 500;

  const metrics: UsageMetric[] = [
    {
      label: 'Tokens (5h)',
      used: tokensUsed,
      limit: tokensLimit,
      unit: 'tokens',
      resetAt,
      window: '5h rolling',
    },
    {
      label: 'Requests (5h)',
      used: requestsUsed,
      limit: requestsLimit,
      unit: 'requests',
      resetAt,
      window: '5h rolling',
    },
    {
      label: 'Demo cost',
      used: Math.floor(oscillation * 100) / 100,
      limit: 10,
      unit: 'USD',
      resetAt,
      window: '5h rolling',
    },
  ];

  return { ok: true, metrics, fetchedAt: now, history: demoHistory(now, base, oscillation), historyUnit: 'tokens', historyWindow: '24h' };
}

function demoHistory(now: number, base: number, oscillation: number): number[] {
  // 24 hourly bars, smoothed
  const out: number[] = [];
  for (let i = 0; i < 24; i++) {
    const t = i / 24;
    const wave = Math.sin(t * Math.PI * 2 + base * 0.001) * 0.4 + 0.5;
    out.push(Math.floor(40_000 * (0.3 + oscillation * 0.7) * (0.4 + wave * 0.6)));
  }
  return out;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export const demoProvider = {
  type: 'demo' as ProviderType,
  label: 'Demo (sample data)',
  fetch: fetchDemoUsage,
};
