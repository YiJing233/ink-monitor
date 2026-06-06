/**
 * Next.js calls this once on server boot. We use it to load Sentry's
 * server-side integrations lazily. See https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 *
 * If Sentry isn't installed / DSN isn't set, this is a no-op.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  // Only run on the server runtime (not edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Sentry = require('@sentry/nextjs');
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV,
        release: process.env.npm_package_version,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.05'),
      });
    } catch {
      // @sentry/nextjs not installed; lib/sentry.ts will warn at first error.
    }
  }
}
