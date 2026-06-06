import 'server-only';
import { listProviders, listStocks, getAllSettings, getCache, setCache } from './db';
import { fetchUsage } from './providers';
import { getQuote } from './stocks';
import { decryptForUser } from './crypto';
import { PROVIDER_LABELS } from './providers/labels';

export interface DisplayData {
  generatedAt: number;
  pageTitle: string;
  refreshSeconds: number;
  defaultRefreshSeconds: number;
  providers: ProviderView[];
  stocks: StockView[];
}

export interface ProviderView {
  id: string;
  name: string;
  type: string;
  ok: boolean;
  error?: string;
  metrics: Array<{
    label: string;
    used: number;
    limit: number | null;
    unit?: string;
    resetAt?: number | null;
    window?: string;
  }>;
  history?: number[];
  historyUnit?: string;
  historyWindow?: string;
  fetchedAt: number;
  cached: boolean;
  refreshSeconds: number;
}

export interface StockView {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  marketState?: string;
  asOf: number;
  cached: boolean;
  refreshSeconds: number;
  history?: number[];
}

const DEFAULT_REFRESH_MIN = 15;
const DEFAULT_REFRESH_MAX = 3600 * 24;

export async function getDisplayData(userId: string): Promise<DisplayData> {
  const settings = getAllSettings(userId);
  const defaultRefresh = Math.max(
    DEFAULT_REFRESH_MIN,
    Math.min(DEFAULT_REFRESH_MAX, Number(settings.refresh_seconds) || 60),
  );
  const pageTitle = settings.page_title || 'Monitor';

  const providers = listProviders(userId);
  const stocks = listStocks(userId);

  const providerResults = await Promise.all(
    providers.map(async (p) => {
      const refresh = clampRefresh(p.refresh_seconds, defaultRefresh);
      const cached = getCache(userId, `provider:${p.id}`);

      if (cached && Date.now() - cached.updated_at < refresh * 1000) {
        try {
          const snap = JSON.parse(cached.value);
          return {
            id: p.id,
            name: p.name,
            type: p.type,
            ok: snap.ok,
            error: snap.error,
            metrics: snap.metrics,
            history: snap.history,
            historyUnit: snap.historyUnit,
            historyWindow: snap.historyWindow,
            fetchedAt: snap.fetchedAt,
            cached: true,
            refreshSeconds: refresh,
          } satisfies ProviderView;
        } catch {
          // fall through
        }
      }

      const snap = await fetchUsageForUser(p, userId);
      setCache(userId, `provider:${p.id}`, JSON.stringify(snap));
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        ok: snap.ok,
        error: snap.error,
        metrics: snap.metrics,
        history: snap.history,
        historyUnit: snap.historyUnit,
        historyWindow: snap.historyWindow,
        fetchedAt: snap.fetchedAt,
        cached: false,
        refreshSeconds: refresh,
      } satisfies ProviderView;
    }),
  );

  const stockResults = await Promise.all(
    stocks.map(async (s) => {
      const refresh = clampRefresh(s.refresh_seconds, defaultRefresh);
      const cached = getCache(userId, `stock:${s.id}`);

      if (cached && Date.now() - cached.updated_at < refresh * 1000) {
        try {
          const q = JSON.parse(cached.value);
          return {
            id: s.id,
            symbol: q.symbol,
            name: q.name,
            price: q.price,
            change: q.change,
            changePercent: q.changePercent,
            currency: q.currency,
            marketState: q.marketState,
            asOf: q.asOf,
            history: q.history,
            cached: true,
            refreshSeconds: refresh,
          } satisfies StockView;
        } catch {
          // fall through
        }
      }

      const q = await getQuote(s);
      setCache(userId, `stock:${s.id}`, JSON.stringify(q));
      return {
        id: s.id,
        symbol: q.symbol,
        name: q.name,
        price: q.price,
        change: q.change,
        changePercent: q.changePercent,
        currency: q.currency,
        marketState: q.marketState,
        asOf: q.asOf,
        history: q.history,
        cached: false,
        refreshSeconds: refresh,
      } satisfies StockView;
    }),
  );

  let displayRefresh = defaultRefresh;
  for (const p of providerResults) {
    if (p.refreshSeconds < displayRefresh) displayRefresh = p.refreshSeconds;
  }
  for (const s of stockResults) {
    if (s.refreshSeconds < displayRefresh) displayRefresh = s.refreshSeconds;
  }
  displayRefresh = Math.max(15, displayRefresh);

  return {
    generatedAt: Date.now(),
    pageTitle,
    refreshSeconds: displayRefresh,
    defaultRefreshSeconds: defaultRefresh,
    providers: providerResults,
    stocks: stockResults,
  };
}

async function fetchUsageForUser(p: any, userId: string) {
  if (p.type === 'demo') {
    const { fetchUsage } = await import('./providers');
    return fetchUsage({ ...p, api_key_encrypted: '_demo_' });
  }
  // Decrypt with the user's key
  const { fetchUsage } = await import('./providers');
  const decrypted = {
    ...p,
    api_key_encrypted: (() => {
      try {
        return decryptForUser(userId, p.api_key_encrypted);
      } catch {
        return '';
      }
    })(),
  };
  // fetchUsage decodes internally; we need a different path
  return _fetchWithKey(p, decrypted.api_key_encrypted);
}

async function _fetchWithKey(p: any, apiKey: string) {
  const { openaiProvider } = await import('./providers/openai');
  const { anthropicProvider } = await import('./providers/anthropic');
  const { customProvider } = await import('./providers/custom');
  const { demoProvider } = await import('./providers/demo');
  const fetcher =
    p.type === 'openai' ? openaiProvider
    : p.type === 'anthropic' ? anthropicProvider
    : p.type === 'demo' ? demoProvider
    : customProvider;
  return fetcher.fetch(p, apiKey);
}

function clampRefresh(v: number | null | undefined, fallback: number): number {
  if (v == null || !Number.isFinite(v)) return fallback;
  return Math.max(15, Math.min(DEFAULT_REFRESH_MAX, Math.floor(v)));
}

export function sanitizeProvider(p: any) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    base_url: p.base_url,
    endpoint: p.endpoint,
    json_path: p.json_path,
    display_order: p.display_order,
    refresh_seconds: p.refresh_seconds,
    has_key: !!p.api_key_encrypted,
  };
}

export function maskKey(encrypted: string): string {
  if (!encrypted) return '';
  // Use the ciphertext's last 6 hex chars (stable but reveals nothing)
  const tail = encrypted.split(':').pop() || '';
  return '••••' + tail.slice(-6);
}

export { PROVIDER_LABELS };
