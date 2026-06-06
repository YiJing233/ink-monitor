/**
 * Thin Sentry shim. The @sentry/nextjs package is NOT a hard dependency —
 * it's loaded lazily here so that self-hosters who don't want error tracking
 * don't pay the bundle size.
 *
 * Enable by:
 *   pnpm add @sentry/nextjs
 *   SENTRY_DSN=https://...@sentry.io/... pnpm start
 */

type SentryCtx = Record<string, any>;

let _sentry: any = null;
let _initialized = false;

function getSentry(): any {
  if (_sentry) return _sentry;
  if (_initialized) return null;
  _initialized = true;
  if (!process.env.SENTRY_DSN) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _sentry = require('@sentry/nextjs');
    _sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      release: process.env.npm_package_version,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.05'),
      ignoreErrors: [
        // Common noise from e-ink browsers
        /Loading chunk \d+ failed/i,
        /ResizeObserver loop/i,
      ],
    });
    return _sentry;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[sentry] @sentry/nextjs not installed. Run `pnpm add @sentry/nextjs` to enable.');
    return null;
  }
}

export function captureError(err: unknown, ctx?: SentryCtx): void {
  const s = getSentry();
  if (s) s.captureException(err, { extra: ctx });
  // Always log to stderr so it shows up in dev / CI logs even without Sentry
  // eslint-disable-next-line no-console
  console.error('[error]', err, ctx || {});
}

export function captureMessage(msg: string, level: 'info' | 'warning' | 'error' = 'info', ctx?: SentryCtx): void {
  const s = getSentry();
  if (s) s.captureMessage(msg, level, { extra: ctx });
}

export function isSentryEnabled(): boolean {
  return !!process.env.SENTRY_DSN;
}
