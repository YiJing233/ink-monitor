import { listProviders, listStocks, getAllSettings } from '@/lib/db';
import { seedDefaults } from '@/lib/seed';
import { LoadDemoButton } from './load-demo-button';
import { SharePanel } from './share-panel';
import { PROVIDER_LABELS } from '@/lib/providers/labels';
import { getCurrentUserId } from '@/lib/session';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/signin?callbackUrl=/admin');

  seedDefaults(userId);

  const providers = listProviders(userId);
  const stocks = listStocks(userId);
  const settings = getAllSettings(userId);
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${proto}://${host}`;

  return (
    <>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Status</h2>
        <table>
          <tbody>
            <tr><th>Providers configured</th><td>{providers.length}</td></tr>
            <tr><th>Stocks tracked</th><td>{stocks.length}</td></tr>
            <tr><th>Refresh interval</th><td><span className="pill">{settings.refresh_seconds || 60}s</span></td></tr>
            <tr><th>Page title</th><td><span className="pill">{settings.page_title || 'Monitor'}</span></td></tr>
          </tbody>
        </table>
      </div>

      {(providers.length === 0 || stocks.length < 3) && (
        <div className="panel" style={{ borderStyle: 'dashed' }}>
          <h2 style={{ marginTop: 0 }}>Try it instantly</h2>
          <p>
            Add a sample provider and a few popular tickers with one click. No
            API keys required — see the dashboard working in 10 seconds.
          </p>
          <LoadDemoButton />
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Providers</h2>
        {providers.length === 0 ? (
          <p>None yet. <a href="/admin/providers">Add one →</a></p>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Key</th><th>Refresh</th><th>Updated</th></tr></thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td><span className="pill">{PROVIDER_LABELS[p.type] || p.type}</span></td>
                  <td><span className="pill">••••{(p.api_key_encrypted || '').split(':').pop()?.slice(-6) || ''}</span></td>
                  <td><span className="pill">{p.refresh_seconds ? `${p.refresh_seconds}s` : 'default'}</span></td>
                  <td>{new Date(p.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Share link for e-reader</h2>
        <SharePanel origin={origin} />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Stocks</h2>
        {stocks.length === 0 ? (
          <p>None yet. <a href="/admin/stocks">Add some →</a></p>
        ) : (
          <table>
            <thead><tr><th>Symbol</th><th>Market</th><th>Name</th><th>Refresh</th></tr></thead>
            <tbody>
              {stocks.map((s) => (
                <tr key={s.id}>
                  <td><code>{s.symbol}</code></td>
                  <td><span className="pill">{s.market.toUpperCase()}</span></td>
                  <td>{s.display_name || '—'}</td>
                  <td><span className="pill">{s.refresh_seconds ? `${s.refresh_seconds}s` : 'default'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
