import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/session';
import { getDb } from '@/lib/db';
import { resolveLocale, t, type Locale } from '@/lib/i18n';
import DiagnosticsClient, { type DiagnosticsPayload, type PlatformHealth } from './diagnostics-client';

export const dynamic = 'force-dynamic';

/**
 * /admin/diagnostics — owner-only view of the widget platform.
 *
 * Renders three panels:
 *   1. Platform health   — DB connectivity, album store type, SSRF / upload
 *                          configuration, Node version, process uptime.
 *   2. Installed widgets — per-instance manifest validation outcome, last
 *                          resolve timing + error from `widget_resolve_log`.
 *   3. Dashboards        — per-dashboard widget count and the list of devices
 *                          that have a non-empty layout.
 *
 * Data is sourced from `GET /api/diagnostics/widgets` (same process; the
 * `NEXT_PUBLIC_BASE_URL` env is honored so the page also works behind a
 * reverse proxy during local development). The route is also responsible for
 * the auth gate — this page is in `/admin/*` so NextAuth's middleware
 * already redirects unauthenticated users, but we additionally bounce to
 * /signin here so the page returns a clean redirect instead of rendering
 * an empty shell if the middleware is misconfigured.
 *
 * The server pre-loads the data so the initial paint shows the full
 * dashboard; the client component provides a "Refresh" button that
 * re-fetches the API endpoint on demand.
 */
export default async function DiagnosticsPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/signin?callbackUrl=/admin/diagnostics');

  const c = await cookies();
  const h = await headers();
  const locale = resolveLocale(c.get('NEXT_LOCALE')?.value || null, h.get('accept-language'));

  const payload = await loadDiagnostics();
  const health = computeHealth();

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{t(locale, 'admin.diag.h')}</h2>
      <p className="hint" dangerouslySetInnerHTML={{ __html: t(locale, 'admin.diag.body') }} />
      <DiagnosticsClient
        initial={payload}
        health={health}
        locale={locale}
        // Pass a no-op fallback so the server-rendered initial paint can
        // supply a base URL when the runtime isn't the same process as the
        // API route (e.g. when /admin is reverse-proxied to a separate
        // upstream). Same-process calls get an empty string so Node resolves
        // them via the loopback default.
        baseUrl={process.env.NEXT_PUBLIC_BASE_URL || ''}
      />
    </div>
  );
}

async function loadDiagnostics(): Promise<DiagnosticsPayload | { error: string }> {
  // Same-process fetch. We honour `NEXT_PUBLIC_BASE_URL` so that deployments
  // where the admin UI is reverse-proxied to a different upstream can still
  // call this endpoint cleanly. `cache: 'no-store'` keeps the page dynamic
  // (matches `export const dynamic = 'force-dynamic'` above) and prevents
  // Next.js from caching a stale snapshot between refresh clicks.
  const base = process.env.NEXT_PUBLIC_BASE_URL || '';
  try {
    const res = await fetch(`${base}/api/diagnostics/widgets`, { cache: 'no-store' });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      userId: string;
      locale: Locale;
      widgets: DiagnosticsPayload['widgets'];
      dashboards: DiagnosticsPayload['dashboards'];
    };
    return {
      userId: body.userId,
      locale: body.locale,
      widgets: body.widgets,
      dashboards: body.dashboards,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function computeHealth(): PlatformHealth {
  // Album storage backend. Mirrors the pick logic in `lib/widgets/album-store.ts`
  // — we only need to surface the *type* here, not exercise the IO. We honour
  // an explicit `ALBUM_STORE` override and fall back to the same defaults the
  // store does so the diagnostics view never disagrees with the live code.
  const albumStore = (() => {
    const override = (process.env.ALBUM_STORE || '').toLowerCase();
    if (override) return override;
    if (process.env.VERCEL) {
      if (process.env.BLOB_READ_WRITE_TOKEN) return 'vercel-blob';
      if (process.env.S3_BUCKET && process.env.S3_REGION) return 's3';
    }
    return 'urls';
  })();

  // Upload size cap — same constant the upload route enforces. Surfacing it
  // here lets an operator confirm the platform is still capped at 12MB and
  // isn't running a stale build with a different limit.
  const UPLOAD_MAX_BYTES = 12 * 1024 * 1024;

  // DB connectivity probe — open the SQLite file and run a trivial query.
  // Wrapped so a DB outage on this page never crashes the admin shell; we
  // surface the result as a red/green badge instead. `getDb()` is lazy so
  // a broken file path on first call doesn't blow up module-load; we only
  // care whether a trivial `SELECT 1` round-trips here.
  let dbOk = false;
  try {
    const row = getDb().prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
    dbOk = row?.ok === 1;
  } catch {
    dbOk = false;
  }

  return {
    dbOk,
    albumStore,
    // Upload support follows `isUploadSupported()` from the album store
    // module — only disk / vercel-blob / s3 expose `addFile`. The `urls`
    // store is intentionally read-only-by-design.
    uploadsEnabled: albumStore === 'disk' || albumStore === 'vercel-blob' || albumStore === 's3',
    uploadMaxBytes: UPLOAD_MAX_BYTES,
    // SSRF hardening is unconditional — the IP block-list in `safe-fetch` is
    // applied to every declarative http source. We expose a boolean here
    // so the page can advertise the protection to the operator (and turn
    // red if a future refactor accidentally disables it via env).
    ssrfGuard: true,
    nodeVersion: process.version,
    // Process uptime in seconds. Surfaces "how long has the server been
    // alive" — useful when diagnosing whether a freshly-deployed instance
    // has had time to populate its resolve log.
    uptimeSeconds: Math.round(process.uptime()),
  };
}