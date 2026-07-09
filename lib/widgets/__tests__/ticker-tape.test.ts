/**
 * Tests for the Phase 2 `ticker-tape` built-in. The manifest is `http`-backed
 * and calls CoinGecko's free `/simple/price` endpoint; we don't want a real
 * network call in tests, so we:
 *   1. Validate the manifest against the IR schema.
 *   2. Verify that `applySelect` flattens CoinGecko's `{ coin: { usd, usd_24h_change } }`
 *      payload into the flat shape the layout binds to (`btc_price`, `btc_change`,
 *      `eth_price`, `eth_change`).
 *   3. Assert the sample-data fixture matches the post-`applySelect` shape.
 *
 * Design note: we deliberately keep this widget on the `http` source rather
 * than introducing a custom `builtin` resolver for CoinGecko — the upstream
 * response is a small nested object whose rewrite is exactly what the `select`
 * map already does, so an IR-declarative widget is more in keeping with the
 * platform's "everything is data" model than a TypeScript helper.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import tickerTapeManifest from '../manifests/ticker-tape.json';
import { SAMPLE_DATA, tickerTapeSample } from '../manifests/sample-data';
import { applySelect } from '../select';

/** Realistic subset of the CoinGecko `/simple/price?ids=…&vs_currencies=usd&include_24hr_change=true`
 *  payload. We deliberately omit fields the manifest's `select` doesn't bind
 *  (e.g. `last_updated_at`) to simulate a "minimal" response — `applySelect`
 *  should ignore them. */
const COINGECKO_FIXTURE = {
  bitcoin: { usd: 67842.11, usd_24h_change: -1.42 },
  ethereum: { usd: 3184.5, usd_24h_change: 0.83 },
};

describe('ticker-tape built-in', () => {
  it('validates against the IR schema with the expected source + families', () => {
    const m = validateManifest(tickerTapeManifest);
    expect(m.id).toBe('ticker-tape');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toMatchObject({ kind: 'http' });
    expect(m.families).toEqual(['4x1', '4x2']);
    // CoinGecko is a public, read-only API. The egress allowlist must be
    // pinned to its api host (a future contributor cannot widen the URL
    // template to a coingecko-themed phishing mirror without tripping this).
    expect(m.capabilities?.egress).toEqual(['api.coingecko.com']);
    // No secret — the public tier is sufficient for a refresh-per-minute
    // e-ink tile. If a future change needs an authenticated Pro tier it
    // should show up here so the install prompt can collect it.
    expect(m.capabilities?.secrets ?? []).toEqual([]);
  });

  it('applySelect on a CoinGecko payload flattens to the four fields the layout reads', () => {
    const m = validateManifest(tickerTapeManifest);
    if (m.source.kind !== 'http') throw new Error('expected http source');

    const out = applySelect(COINGECKO_FIXTURE, m.source.select) as Record<string, unknown>;

    // The 4x1 layout binds btc_price / btc_change; the 4x2 layout adds
    // eth_price / eth_change. Each flat key must round-trip the same number
    // that nested lookup returns.
    expect(out.btc_price).toBe(67842.11);
    expect(out.btc_change).toBe(-1.42);
    expect(out.eth_price).toBe(3184.5);
    expect(out.eth_change).toBe(0.83);
  });

  it('the sample-data fixture is shape-compatible with the post-select shape', () => {
    // Same rationale as rss / weather: the /preview route substitutes
    // SAMPLE_DATA[id] for the resolved source when the user has not yet wired
    // anything up, so the fixture must already carry every key the layout
    // binds to.
    const sample = SAMPLE_DATA['ticker-tape'] as Record<string, unknown>;
    expect(sample).toEqual(
      expect.objectContaining({
        btc_price: expect.any(Number),
        btc_change: expect.any(Number),
        eth_price: expect.any(Number),
        eth_change: expect.any(Number),
      }),
    );
    // And the registry's SAMPLE_DATA entry matches the exported constant.
    expect(sample).toEqual(tickerTapeSample);
  });
});
