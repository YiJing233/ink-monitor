import { listStocks, listProviders, insertStock, insertProvider, getSetting, setSetting, upsertUser } from './db';
import { encryptForUser } from './crypto';
import { randomId } from './utils';

/**
 * Pre-seed: only for the very first user to log in. Idempotent.
 */
export function seedDefaults(userId: string) {
  const seeded = getSetting(userId, 'seeded_v1');
  if (seeded) return;

  const defaults: Array<{ symbol: string; market: 'us' | 'cn' | 'hk'; name: string }> = [
    { symbol: 'AAPL', market: 'us', name: 'Apple' },
    { symbol: 'MSFT', market: 'us', name: 'Microsoft' },
    { symbol: 'NVDA', market: 'us', name: 'NVIDIA' },
    { symbol: 'TSLA', market: 'us', name: 'Tesla' },
    { symbol: 'BABA', market: 'us', name: 'Alibaba' },
    { symbol: '00700', market: 'hk', name: 'Tencent' },
    { symbol: '600519', market: 'cn', name: 'Moutai' },
  ];

  defaults.forEach((d, i) => {
    try {
      insertStock({
        id: randomId(),
        user_id: userId,
        symbol: d.symbol,
        market: d.market,
        display_name: d.name,
        display_order: i,
        refresh_seconds: null,
      });
    } catch {
      // unique constraint — skip
    }
  });

  setSetting(userId, 'seeded_v1', '1');
  if (!getSetting(userId, 'refresh_seconds')) {
    setSetting(userId, 'refresh_seconds', process.env.DEFAULT_REFRESH_SECONDS || '60');
  }
  if (!getSetting(userId, 'page_title')) {
    setSetting(userId, 'page_title', 'Monitor');
  }
}

/**
 * Idempotent "Load demo data" — adds one demo provider (if missing) and
 * a few sample stocks the user might not have.
 */
export function loadDemoData(userId: string) {
  let addedProvider = 0;
  let addedStocks = 0;

  // Ensure user row exists
  upsertUser({ id: userId, email: null, name: null, avatar_url: null, share_token: null });

  // 1. Demo provider
  const existing = listProviders(userId).filter((p) => p.type === 'demo');
  if (existing.length === 0) {
    insertProvider({
      id: randomId(),
      user_id: userId,
      name: 'Demo plan',
      type: 'demo',
      api_key_encrypted: encryptForUser(userId, 'demo-not-used'),
      base_url: null,
      endpoint: null,
      json_path: null,
      display_order: listProviders(userId).length,
      refresh_seconds: 60,
    });
    addedProvider = 1;
  }

  // 2. Add a few iconic stocks if missing
  const haveSymbols = new Set(listStocks(userId).map((s) => s.symbol.toUpperCase()));
  const samples: Array<{ symbol: string; market: 'us' | 'cn' | 'hk'; name: string }> = [
    { symbol: 'AAPL', market: 'us', name: 'Apple' },
    { symbol: 'MSFT', market: 'us', name: 'Microsoft' },
    { symbol: '00700', market: 'hk', name: 'Tencent' },
    { symbol: '600519', market: 'cn', name: 'Moutai' },
  ];
  const orderBase = listStocks(userId).length;
  samples.forEach((s, i) => {
    if (haveSymbols.has(s.symbol.toUpperCase())) return;
    try {
      insertStock({
        id: randomId(),
        user_id: userId,
        symbol: s.symbol,
        market: s.market,
        display_name: s.name,
        display_order: orderBase + i,
        refresh_seconds: 60,
      });
      addedStocks++;
    } catch {
      // skip
    }
  });

  return { addedProvider, addedStocks };
}
