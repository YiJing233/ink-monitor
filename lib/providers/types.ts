import type { Provider } from '../db';

export interface UsageMetric {
  label: string;
  used: number;
  limit: number | null; // null = unknown / unlimited
  unit?: string; // 'tokens', 'requests', 'usd'
  resetAt?: number | null; // epoch ms
  window?: string; // '5h', '7d', 'month'
}

export interface UsageSnapshot {
  ok: boolean;
  error?: string;
  metrics: UsageMetric[];
  raw?: unknown;
  fetchedAt: number;
  history?: number[];   // provider-defined time series (e.g. hourly tokens)
  historyUnit?: string; // label for the y-axis
  historyWindow?: string; // label for the time window (e.g. "24h")
}

export type ProviderFetcher = (p: Provider, apiKey: string) => Promise<UsageSnapshot>;
