'use client';

import { useEffect, useState } from 'react';
import { checkStockTtl, STOCK_TTL } from '@/lib/ttl';

interface Stock {
  id: string;
  symbol: string;
  market: 'us' | 'cn' | 'hk';
  display_name: string | null;
  refresh_seconds: number | null;
}

export default function StocksAdmin() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [snapshotErr, setSnapshotErr] = useState<string | null>(null);
  const [loadingSnap, setLoadingSnap] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/stocks', { cache: 'no-store' });
      const j = await r.json();
      setStocks(j.stocks || []);
    } catch (e: any) {
      setErr(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function testFetch() {
    setLoadingSnap(true);
    setSnapshotErr(null);
    try {
      const r = await fetch('/api/snapshot', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setSnapshot(j);
    } catch (e: any) {
      setSnapshotErr(e?.message || 'Failed');
    } finally {
      setLoadingSnap(false);
    }
  }

  async function move(id: string, direction: 'up' | 'down') {
    await fetch(`/api/stocks/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', direction }),
    });
    load();
  }

  return (
    <>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Add stock</h2>
        <StockForm onAdded={load} />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Watchlist ({stocks.length})</h2>
        {err && <div className="err">{err}</div>}
        {loading ? <p>Loading…</p> : stocks.length === 0 ? (
          <p>No tickers yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Market</th>
                <th>Name</th>
                <th>Refresh</th>
                <th>Order</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((s, i) => {
                const ttl = checkStockTtl(s.market, s.refresh_seconds, 60);
                return (
                  <tr key={s.id}>
                    <td><code>{s.symbol}</code></td>
                    <td><span className="pill">{s.market.toUpperCase()}</span></td>
                    <td>{s.display_name || '—'}</td>
                    <td>
                      <span className="pill">{s.refresh_seconds ? `${s.refresh_seconds}s` : 'default'}</span>
                      {ttl.severity === 'warn' && (
                        <span className="pill" title={ttl.message} style={{ marginLeft: 4, fontSize: 11 }}>
                          ⚠ {ttl.message}
                        </span>
                      )}
                      {ttl.severity === 'danger' && (
                        <span className="pill" title={ttl.message} style={{ marginLeft: 4, fontSize: 11, fontWeight: 700, background: '#000', color: '#fff' }}>
                          ⛔ {ttl.message}
                        </span>
                      )}
                    </td>
                    <td>
                      <button className="btn" onClick={() => move(s.id, 'up')} disabled={i === 0} aria-label="move up">↑</button>{' '}
                      <button className="btn" onClick={() => move(s.id, 'down')} disabled={i === stocks.length - 1} aria-label="move down">↓</button>
                    </td>
                    <td>
                      <button
                        className="btn danger"
                        onClick={async () => {
                          if (!confirm(`Remove ${s.symbol}?`)) return;
                          await fetch(`/api/stocks/${s.id}`, { method: 'DELETE' });
                          load();
                        }}
                      >Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Test quote fetch</h2>
        <p className="hint">Calls <code>/api/snapshot</code> to verify upstream data sources are reachable.</p>
        <button className="btn" onClick={testFetch} disabled={loadingSnap}>
          {loadingSnap ? 'Fetching…' : 'Test now'}
        </button>
        {snapshotErr && <div className="err" style={{ marginTop: 8 }}>{snapshotErr}</div>}
        {snapshot && (
          <pre style={{ overflow: 'auto', maxHeight: 300, border: '2px solid #000', padding: 8, fontSize: 12 }}>
            {JSON.stringify(snapshot.stocks, null, 2)}
          </pre>
        )}
      </div>
    </>
  );
}

function StockForm({ onAdded }: { onAdded: () => void }) {
  const [market, setMarket] = useState<'us' | 'cn' | 'hk'>('us');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [refresh, setRefresh] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const placeholder =
    market === 'us' ? 'AAPL' : market === 'hk' ? '0700.HK' : '600519 / sh600519';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!symbol.trim()) {
      setErr('Symbol is required');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.trim(),
          market,
          display_name: name.trim() || null,
          refresh_seconds: refresh.trim() ? Number(refresh) : null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ? JSON.stringify(j.error) : 'Failed');
      setSymbol('');
      setName('');
      setRefresh('');
      onAdded();
    } catch (e: any) {
      setErr(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="err">{err}</div>}

      <div className="row" style={{ marginBottom: 12 }}>
        {(['us', 'cn', 'hk'] as const).map((m) => (
          <label key={m} className="row" style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="market"
              checked={market === m}
              onChange={() => setMarket(m)}
              style={{ width: 16, height: 16 }}
            />
            <span>{m === 'us' ? 'US (Yahoo/Tencent)' : m === 'hk' ? 'HK (Tencent)' : 'CN / A-share (Sina/Tencent)'}</span>
          </label>
        ))}
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}>
          <label className="label">Symbol</label>
          <input
            style={{ width: '100%' }}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder={placeholder}
          />
        </div>
        <div className="field" style={{ flex: '1 1 240px' }}>
          <label className="label">Display name (optional)</label>
          <input
            style={{ width: '100%' }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Apple Inc."
          />
        </div>
        <div className="field" style={{ flex: '1 1 120px' }}>
          <label className="label">Refresh (s)</label>
          <input
            type="number"
            min={15}
            max={86400}
            style={{ width: '100%' }}
            value={refresh}
            onChange={(e) => setRefresh(e.target.value)}
            placeholder="global"
          />
          <div className="hint">
            Optional. Recommended ≥ {STOCK_TTL[market]?.recommended ?? 60}s for {market.toUpperCase()}.
          </div>
        </div>
      </div>

      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add stock'}
      </button>
    </form>
  );
}
