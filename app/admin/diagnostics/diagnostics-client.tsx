'use client';

import { useState, useTransition } from 'react';
import { t, type Locale } from '@/lib/i18n';

/**
 * Shape returned by GET /api/diagnostics/widgets (mirrors the route's
 * `NextResponse.json` body). Kept narrow on purpose — this UI never needs
 * to round-trip the full DB row, only the diagnostic summary fields.
 */
export interface DiagnosticsWidget {
  instanceId: string;
  manifestId: string | null;
  version: string | null;
  validate: string;
  source: string | null;
  refresh: number | null;
  lastResolveMs: number | null;
  lastError: string | null;
  lastResolvedAt: string | null;
}

export interface DiagnosticsDashboard {
  id: string;
  name: string;
  widgetCount: number;
  devices: string[];
}

export interface DiagnosticsPayload {
  userId: string;
  locale: Locale;
  widgets: DiagnosticsWidget[];
  dashboards: DiagnosticsDashboard[];
}

/**
 * Static platform-health snapshot computed server-side. Re-rendered
 * on every Refresh click so the badges stay accurate after a deploy or
 * env change.
 */
export interface PlatformHealth {
  dbOk: boolean;
  albumStore: string;
  uploadsEnabled: boolean;
  uploadMaxBytes: number;
  ssrfGuard: boolean;
  nodeVersion: string;
  uptimeSeconds: number;
}

/**
 * Client-side renderer for the diagnostics page.
 *
 * Why a client island:
 *   - The "Refresh" button needs to re-fetch `/api/diagnostics/widgets`
 *     without a full server round-trip. The initial server render still
 *     supplies a useful snapshot so users see data immediately.
 *   - The summary (N widgets / N OK / N failing) updates on every refresh
 *     click, which is cheap to compute in the browser.
 *
 * Status badges are intentionally low-fi (green/yellow/red text + border)
 * so the page fits the rest of the e-ink-friendly admin shell — no
 * third-party color library, no extra dependencies.
 */
export default function DiagnosticsClient({
  initial,
  health,
  locale,
  baseUrl,
}: {
  initial: DiagnosticsPayload | { error: string };
  health: PlatformHealth;
  locale: Locale;
  baseUrl: string;
}) {
  const [data, setData] = useState<DiagnosticsPayload | { error: string }>(initial);
  const [refreshing, startRefresh] = useTransition();

  function refresh() {
    startRefresh(async () => {
      try {
        const res = await fetch(`${baseUrl}/api/diagnostics/widgets`, { cache: 'no-store' });
        if (!res.ok) {
          setData({ error: `HTTP ${res.status}` });
          return;
        }
        const body = (await res.json()) as DiagnosticsPayload;
        setData(body);
      } catch (e) {
        setData({ error: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  return (
    <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{t(locale, 'admin.diag.section.health')}</h2>
          <button className="btn" onClick={refresh} disabled={refreshing}>
            {refreshing ? t(locale, 'admin.diag.refreshing') : t(locale, 'admin.diag.refresh')}
          </button>
        </div>
        <HealthGrid health={health} locale={locale} />
      </div>

      {'error' in data ? (
        <div className="err">
          {t(locale, 'admin.diag.loadFailed', { message: data.error })}
        </div>
      ) : (
        <>
          <Summary data={data} locale={locale} />
          <WidgetsPanel data={data} locale={locale} />
          <DashboardsPanel data={data} locale={locale} />
        </>
      )}
    </>
  );
}

function HealthGrid({ health, locale }: { health: PlatformHealth; locale: Locale }) {
  const yesLabel = t(locale, 'admin.diag.health.yes');
  const noLabel = t(locale, 'admin.diag.health.no');

  return (
    <table>
      <tbody>
        <tr>
          <th>{t(locale, 'admin.diag.health.db')}</th>
          <td><Badge ok={health.dbOk} label={health.dbOk ? yesLabel : noLabel} /></td>
        </tr>
        <tr>
          <th>{t(locale, 'admin.diag.health.albumStore')}</th>
          <td><span className="pill">{health.albumStore}</span></td>
        </tr>
        <tr>
          <th>{t(locale, 'admin.diag.health.uploads')}</th>
          <td><Badge ok={health.uploadsEnabled} label={health.uploadsEnabled ? yesLabel : noLabel} /></td>
        </tr>
        <tr>
          <th>{t(locale, 'admin.diag.health.uploadMax')}</th>
          <td><span className="pill">{formatBytes(health.uploadMaxBytes)}</span></td>
        </tr>
        <tr>
          <th>{t(locale, 'admin.diag.health.ssrf')}</th>
          <td><Badge ok={health.ssrfGuard} label={health.ssrfGuard ? yesLabel : noLabel} /></td>
        </tr>
        <tr>
          <th>{t(locale, 'admin.diag.health.node')}</th>
          <td><span className="pill">{health.nodeVersion}</span></td>
        </tr>
        <tr>
          <th>{t(locale, 'admin.diag.health.uptime')}</th>
          <td><span className="pill">{formatDuration(health.uptimeSeconds)}</span></td>
        </tr>
      </tbody>
    </table>
  );
}

function Summary({ data, locale }: { data: DiagnosticsPayload; locale: Locale }) {
  const total = data.widgets.length;
  const ok = data.widgets.filter((w) => w.validate === 'ok').length;
  const failing = total - ok;
  return (
    <div className="panel">
      <p style={{ margin: 0 }}>
        {total === 0
          ? t(locale, 'admin.diag.summary.empty')
          : t(locale, 'admin.diag.summary', { total, ok, failing })}
      </p>
    </div>
  );
}

function WidgetsPanel({ data, locale }: { data: DiagnosticsPayload; locale: Locale }) {
  const widgets = data.widgets;
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>
        {t(locale, 'admin.diag.section.widgets', { count: widgets.length })}
      </h2>
      {widgets.length === 0 ? (
        <div className="hint" dangerouslySetInnerHTML={{ __html: t(locale, 'admin.diag.empty') }} />
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t(locale, 'admin.diag.widget.col.name')}</th>
              <th>{t(locale, 'admin.diag.widget.col.version')}</th>
              <th>{t(locale, 'admin.diag.widget.col.validate')}</th>
              <th>{t(locale, 'admin.diag.widget.col.lastResolveMs')}</th>
              <th>{t(locale, 'admin.diag.widget.col.lastError')}</th>
              <th>{t(locale, 'admin.diag.widget.col.lastResolvedAt')}</th>
              <th>{t(locale, 'admin.diag.widget.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {widgets.map((w) => (
              <tr key={w.instanceId}>
                <td>
                  <strong>{w.manifestId || w.instanceId}</strong>
                  {w.manifestId && (
                    <div className="hint" style={{ fontSize: 11 }}>
                      <code>{w.instanceId}</code>
                    </div>
                  )}
                </td>
                <td>
                  <span className="pill">{w.version || t(locale, 'admin.diag.widget.noVersion')}</span>
                </td>
                <td>
                  <ValidateBadge validate={w.validate} />
                </td>
                <td>
                  {w.lastResolveMs == null ? (
                    <span className="pill">{t(locale, 'admin.diag.widget.noResolve')}</span>
                  ) : (
                    <span className="pill">{w.lastResolveMs}ms</span>
                  )}
                </td>
                <td>
                  {w.lastError ? (
                    <span style={{ color: '#000', fontWeight: 700 }}>{w.lastError}</span>
                  ) : (
                    <span className="hint">—</span>
                  )}
                </td>
                <td>
                  {w.lastResolvedAt ? (
                    <span className="eink-mono" style={{ fontSize: 11 }}>
                      {w.lastResolvedAt}
                    </span>
                  ) : (
                    <span className="hint">{t(locale, 'admin.diag.widget.noResolve')}</span>
                  )}
                </td>
                <td>
                  <a className="btn" href={`/admin/canvas?widget=${encodeURIComponent(w.instanceId)}`}>
                    {t(locale, 'admin.diag.widget.action.viewOnCanvas')}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DashboardsPanel({ data, locale }: { data: DiagnosticsPayload; locale: Locale }) {
  const dashboards = data.dashboards;
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>
        {t(locale, 'admin.diag.section.dashboards', { count: dashboards.length })}
      </h2>
      {dashboards.length === 0 ? (
        <div className="hint">—</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t(locale, 'admin.diag.dashboard.col.id')}</th>
              <th>{t(locale, 'admin.diag.dashboard.col.name')}</th>
              <th>{t(locale, 'admin.diag.dashboard.col.widgetCount')}</th>
              <th>{t(locale, 'admin.diag.dashboard.col.devices')}</th>
            </tr>
          </thead>
          <tbody>
            {dashboards.map((d) => (
              <tr key={d.id}>
                <td><code style={{ fontSize: 11 }}>{d.id}</code></td>
                <td>{d.name}</td>
                <td><span className="pill">{d.widgetCount}</span></td>
                <td>
                  {d.devices.length === 0 ? (
                    <span className="hint">{t(locale, 'admin.diag.dashboard.noDevices')}</span>
                  ) : (
                    <span className="eink-mono" style={{ fontSize: 11 }}>
                      {d.devices.join(', ')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ValidateBadge({ validate }: { validate: string }) {
  // The API returns a localized `validate` string — "ok" / "通过" / "正常"
  // for healthy widgets, "fail: <reason>" / "失败: <reason>" / "失敗:
  // <reason>" for broken ones. We don't depend on the human string; we
  // look at the leading token which is stable across locales (`ok` and
  // `fail:` are kept verbatim in the zh / ja dictionaries too).
  const ok = validate === 'ok' || validate.startsWith('通过') || validate.startsWith('正常');
  return <Badge ok={ok} label={validate} />;
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  // Two-tone chip — solid black border on ok, thicker "danger" border on
  // not-ok. We deliberately avoid color so the badge works on the e-ink
  // viewer too.
  const style: React.CSSProperties = ok
    ? { border: '1px solid #000', padding: '1px 6px', fontSize: 12, background: '#fff', color: '#000' }
    : { border: '2px solid #000', padding: '1px 6px', fontSize: 12, background: '#000', color: '#fff', fontWeight: 700 };
  return <span style={style} className="diag-badge">{label}</span>;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}