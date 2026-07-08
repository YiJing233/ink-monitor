import { getDisplayData } from '@/lib/aggregator';
import { getCurrentUserId } from '@/lib/session';
import { formatNumber, formatPercent, formatTime, timeUntil } from '@/lib/utils';
import { SoftRefreshScript } from './soft-refresh';
import { LiveStreamScript } from './stream-script';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const userId = await getCurrentUserId();
  // `getDisplayData` is wrapped in React's per-render cache inside
  // `lib/aggregator.ts`, so this call and the one in the page body below
  // share a single snapshot. We catch here because metadata must never throw.
  const data = userId ? await getDisplayData(userId).catch(() => null) : null;
  return {
    title: data?.pageTitle || 'Monitor',
    other: data
      ? { 'http-equiv': 'refresh', content: String(data.refreshSeconds) }
      : { 'http-equiv': 'refresh', content: '60' },
    robots: 'noindex',
  };
}

// F2/F12/F18: this route is auth-gated. Only two legitimate paths resolve a
// userId: (1) a real NextAuth session, (2) a valid `?share=<token>`. The
// legacy `?u=` query param and the `x-ink-user` header used to be honored as
// fallbacks, which let anyone view any user's dashboard. Both fallbacks have
// been removed; see `app/api/snapshot/route.ts` for the matching server-side
// gate. The `?u=` query param is still accepted by the type signature for
// backward-compat in canonical self-links, but it is no longer read.
export default async function DisplayPage({ searchParams }: { searchParams: Promise<{ u?: string; share?: string }> }) {
  let userId = await getCurrentUserId();
  const params = await searchParams;
  if (!userId && params.share) {
    const { getUserIdFromShareToken } = await import('@/lib/session');
    userId = await getUserIdFromShareToken(params.share);
  }

  const data = userId ? await getDisplayData(userId).catch(() => null) : null;

  if (!data) {
    return (
      <div className="eink" style={{ padding: 16 }}>
        <h1 className="eink-title">Monitor</h1>
        <div className="eink-section">
          <strong>Sign in or open a share link.</strong> Visit <a href="/">/</a> on a desktop browser, or scan the QR code shared from your dashboard.
        </div>
      </div>
    );
  }

  // Widget dashboard mode (opt-in): if the user configured a dashboard, render
  // it through the shared canvas instead of the legacy provider/stock sections.
  // Both paths use the same WidgetRenderer, so /preview stays a 1:1 replica.
  if (userId) {
    const { listDashboards } = await import('@/lib/db');
    const dashboards = listDashboards(userId);
    if (dashboards.length > 0) {
      const { resolveDashboard } = await import('@/lib/widgets/source');
      const { DashboardCanvas } = await import('@/lib/widgets/render/DashboardCanvas');
      const { SoftRefreshScript } = await import('./soft-refresh');
      const { deviceId, items, refreshOverrideSec } = await resolveDashboard(userId, dashboards[0]);
      const cands = items.map((i) => i.manifest.refresh).filter((n): n is number => typeof n === 'number' && n > 0);
      const minFromManifests = cands.length ? Math.min(...cands) : 300;
      const refreshSeconds = refreshOverrideSec ? Math.max(15, Math.min(minFromManifests, refreshOverrideSec)) : Math.max(15, minFromManifests);
      return (
        <>
          <meta httpEquiv="refresh" content={String(refreshSeconds)} />
          <DashboardCanvas deviceId={deviceId} items={items} />
          <SoftRefreshScript intervalSec={refreshSeconds} />
          <LiveStreamScript share={params.share ?? null} />
        </>
      );
    }
  }

  // Canonical self-link: only the share token is portable across devices.
  // The legacy `?u=` is no longer honored (auth bypass), so we no longer
  // emit it on self-refresh links — authenticated users get a plain link.
  const canonicalQs = params.share ? `?share=${encodeURIComponent(params.share)}` : '';

  return (
    <>
      <meta httpEquiv="refresh" content={String(data.refreshSeconds)} />
      <div className="eink" style={{ padding: 14, maxWidth: 980, margin: '0 auto' }} data-display-root>
        <a className="eink-refresh-link" href={`/display${canonicalQs}`}>
          <h1 className="eink-title">{data.pageTitle}</h1>
        </a>
        <div className="eink-subtitle" data-updated-at>
          Updated {formatTime(data.generatedAt)} · refresh {data.refreshSeconds}s (default {data.defaultRefreshSeconds}s)
        </div>

        <ProvidersSection providers={data.providers} />
        <StocksSection stocks={data.stocks} />

        <div className="eink-footer">
          <span>Kindle / Xiaomi e-ink monitor</span>
          <span>{data.providers.length} plan · {data.stocks.length} ticker</span>
        </div>
      </div>
      <SoftRefreshScript intervalSec={data.refreshSeconds} />
      <LiveStreamScript share={params.share ?? null} />
    </>
  );
}

function ProvidersSection({ providers }: { providers: NonNullable<Awaited<ReturnType<typeof getDisplayData>>>['providers'] }) {
  if (providers.length === 0) {
    return (
      <div className="eink-section">
        <div className="eink-section-h">
          <span>Token plans</span>
          <span className="eink-badge">0</span>
        </div>
        <div>
          No providers configured. Sign in at <a href="/signin">/signin</a> and visit <code>/admin/providers</code>.
        </div>
      </div>
    );
  }

  return (
    <div className="eink-section">
      <div className="eink-section-h">
        <span>Token plans</span>
        <span className="eink-badge">{providers.length}</span>
      </div>
      <div className="eink-grid-2">
        {providers.map((p) => (
          <ProviderCard key={p.id} p={p} />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({ p }: { p: NonNullable<Awaited<ReturnType<typeof getDisplayData>>>['providers'][number] }) {
  return (
    <div className="eink-section" style={{ margin: 0 }} data-pid={p.id}>
      <div className="eink-section-h">
        <span>{p.name}</span>
        <span className={`eink-badge ${p.ok ? 'solid' : ''}`} data-status>{p.ok ? 'OK' : 'ERR'}</span>
      </div>
      <div className="eink-subtitle" data-fetched-at style={{ fontSize: 11, marginBottom: 6 }}>
        fetched {formatTime(p.fetchedAt)}{p.cached ? ' (cached)' : ''} · refresh {p.refreshSeconds}s
      </div>
      <div data-err style={{ display: 'none', fontSize: 14, marginBottom: 6 }}>
        {p.error || ''}
      </div>
      {!p.ok && (
        <div style={{ fontSize: 14, marginBottom: 6 }}>
          {p.error || 'Unknown error'}
        </div>
      )}
      {p.metrics.map((m, i) => {
        const pct = m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
        const resetTxt = m.resetAt ? `· resets in ${timeUntil(m.resetAt)}` : '';
        return (
          <div key={i} style={{ marginBottom: 8 }} data-metric-label={m.label}>
            <div className="eink-row" style={{ borderBottom: 0, padding: 0 }}>
              <span>{m.label} {m.window ? <span className="eink-subtitle">[{m.window}]</span> : null}</span>
              <span className="eink-mono" data-metric-num>
                {formatNumber(m.used)}{m.limit != null ? ` / ${formatNumber(m.limit)}` : ''}
                {m.unit ? ` ${m.unit}` : ''}
              </span>
            </div>
            <div className="eink-bar-wrap">
              {m.limit != null && <div className="eink-bar-fill" data-metric-fill style={{ width: `${pct}%`, display: 'block' }} />}
              {m.limit == null && <div className="eink-bar-fill" data-metric-fill style={{ width: '0%', display: 'none' }} />}
              <div className="eink-bar-label" data-metric-pct>
                {m.limit != null ? `${pct}%` : formatNumber(m.used)}
              </div>
            </div>
            {resetTxt && (
              <div className="eink-subtitle" data-metric-reset style={{ fontSize: 12 }}>
                {resetTxt}
              </div>
            )}
          </div>
        );
      })}
      {p.history && p.history.length > 0 && (
        <ProviderHistory data={p.history} unit={p.historyUnit} window={p.historyWindow} />
      )}
    </div>
  );
}

/**
 * 24-bar hourly chart. Solid black bars on a hairline baseline. Labels at
 * hours 0/6/12/18 (right-aligned under their bar). Numbers rounded to 1 sig
 * fig to fit the e-ink label width.
 */
function ProviderHistory({ data, unit, window: win }: { data: number[]; unit?: string; window?: string }) {
  const W = 240;
  const H = 40;
  const labelH = 12;
  const innerH = H - labelH;
  const n = data.length;
  if (n === 0) return null;
  const barW = W / n;
  const max = Math.max(...data, 1);
  const labelEvery = Math.max(1, Math.floor(n / 4));
  const pid = `pr-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <div style={{ marginTop: 6 }} data-provider-history>
      <div className="eink-subtitle" style={{ fontSize: 10, marginBottom: 2 }}>
        Hourly · {win || '24h'} · {unit || ''}
      </div>
      <svg width={W} height={H + 2} viewBox={`0 0 ${W} ${H + 2}`} role="img" aria-label="hourly usage">
        <line x1="0" y1={innerH + 0.5} x2={W} y2={innerH + 0.5} stroke="#000" strokeWidth="0.5" />
        {data.map((v, i) => {
          const h = (v / max) * (innerH - 1);
          const x = i * barW;
          const y = innerH - h;
          const showLabel = i % labelEvery === 0;
          return (
            <g key={i}>
              <rect x={x + 0.5} y={y} width={Math.max(1, barW - 1.5)} height={h} fill="#000" />
              {showLabel && (
                <text
                  x={x + barW / 2}
                  y={H}
                  fontSize="8"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
                  textAnchor="middle"
                  fill="#000"
                >{n - 1 - i}h</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StocksSection({ stocks }: { stocks: NonNullable<Awaited<ReturnType<typeof getDisplayData>>>['stocks'] }) {
  if (stocks.length === 0) {
    return (
      <div className="eink-section">
        <div className="eink-section-h">
          <span>Stocks</span>
          <span className="eink-badge">0</span>
        </div>
        <div>No tickers configured. Open <code>/admin/stocks</code>.</div>
      </div>
    );
  }

  return (
    <div className="eink-section">
      <div className="eink-section-h">
        <span>Stocks</span>
        <span className="eink-badge">{stocks.length}</span>
      </div>
      <table className="eink-stock-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Name</th>
            <th>Trend (30d)</th>
            <th className="num">Price</th>
            <th className="num">Change</th>
            <th className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => {
            const cls = !Number.isFinite(s.changePercent)
              ? 'eink-flat'
              : s.changePercent > 0
              ? 'eink-up'
              : s.changePercent < 0
              ? 'eink-down'
              : 'eink-flat';
            const sign = s.change > 0 ? '+' : '';
            return (
              <tr key={s.id} data-symbol={s.symbol}>
                <td className="eink-mono" data-cell="symbol">{s.symbol}</td>
                <td data-cell="name">{s.name}</td>
                <td><Sparkline data={s.history} positive={s.changePercent >= 0} /></td>
                <td className="num" data-cell="price">
                  {!Number.isFinite(s.price) ? '—' : `${formatNumber(s.price, s.price < 10 ? 3 : 2)} ${s.currency}`}
                </td>
                <td className={`num ${cls}`} data-cell="change">
                  {!Number.isFinite(s.change) ? '—' : `${sign}${formatNumber(s.change)}`}
                </td>
                <td className={`num ${cls}`} data-cell="pct">
                  {!Number.isFinite(s.changePercent) ? '—' : formatPercent(s.changePercent)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Sparkline({ data, positive }: { data?: number[]; positive: boolean }) {
  const W = 120;
  const H = 28;
  if (!data || data.length < 2) {
    return <span className="eink-subtitle" style={{ fontSize: 11 }}>no data</span>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = W / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = H - ((v - min) / range) * H;
    return [x, y] as const;
  });
  const linePath =
    points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath =
    `M0,${H} ` +
    points.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
    ` L${W},${H} Z`;
  const last = points[points.length - 1];
  const tag = positive ? 'u' : 'd';
  const pid = `sp-${tag}-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Trend ${positive ? 'up' : 'down'}`}
      style={{ display: 'block' }}
    >
      <defs>
        <pattern id={`${pid}-hatch`} patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="3" stroke="#000" strokeWidth="1.4" />
        </pattern>
        <clipPath id={`${pid}-clip`}>
          <path d={areaPath} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${pid}-clip)`}>
        <rect x="0" y="0" width={W} height={H} fill={`url(#${pid}-hatch)`} />
      </g>
      <path d={linePath} fill="none" stroke="#000" strokeWidth="1.4" />
      <circle cx={last[0]} cy={last[1]} r="1.8" fill="#000" />
    </svg>
  );
}
