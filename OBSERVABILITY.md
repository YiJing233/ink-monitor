# Observability

Three layers. All are opt-in.

## 1. Error monitoring (Sentry) — recommended

We ship a thin shim (`lib/sentry.ts`) that lazy-loads `@sentry/nextjs`
only when `SENTRY_DSN` is set.

### Setup

```bash
pnpm add @sentry/nextjs
export SENTRY_DSN=https://...@sentry.io/...
```

`instrumentation.ts` (already in repo) initializes Sentry on server boot.
No code changes needed in your app.

### What we capture

- Unhandled exceptions in API routes (server-side)
- React render errors (client-side)
- Slow API responses (tracesSampleRate = 0.05 by default)
- Release version (from `package.json`)

### What we filter

- ResizeObserver loop errors (common, harmless)
- "Loading chunk N failed" (stale chunks after deploy)
- Anything from `eink` device UAs if it gets noisy

### What we don't capture

- Request bodies (could contain API keys)
- `api_key` / `api_key_masked` fields
- The `Authorization` header

### Cost

Sentry's free tier: 5K errors / month. Each Ink Monitor user generates
~0-2 errors / month (mostly upstream rate limits we handle gracefully).
Stays free until ~2,000 active users.

## 2. Analytics (Plausible) — recommended for hosted

Privacy-friendly, cookie-less, GDPR-compliant by default. One
self-hosted file (the `script.js`) or their $9/mo managed tier.

```html
<!-- app/layout.tsx -->
<script defer data-domain="ink-monitor.example.com"
        src="https://plausible.io/js/script.js"></script>
```

### What to track

- `pageview` on `/`, `/signin`, `/admin`, `/display`
- `custom event: provider_added` (with type, no api_key)
- `custom event: stock_added` (with market)
- `custom event: share_link_generated`
- `custom event: api_check` (ok/err — no details)

Avoid tracking: any field that could leak usage, refresh interval,
display title (could be PII).

### Cost

Plausible: $9/mo for 10K events, $0.0005/event beyond that. Ink
Monitor's per-user event volume is tiny.

## 3. Logging (Vercel / Logflare / self-host)

Vercel captures stdout/stderr from serverless functions automatically.
For self-host, the simplest is to write structured JSON to stdout and
let your platform's log shipper handle it.

### Recommended format

```ts
console.log(JSON.stringify({
  level: 'info',
  ts: new Date().toISOString(),
  user_id: '...',
  route: '/api/snapshot',
  duration_ms: 123,
  data_sources: { tencent: 'ok', sina: 'ok' },
}));
```

Fields to log: `level`, `ts`, `route`, `duration_ms`, `status`, `user_id`,
`data_sources`. Never log `api_key`, request bodies, or share tokens.

### What to never log

- Encrypted ciphertext (it reveals the row structure, useless to attackers,
  helpful to nobody)
- API key in any form (encrypted, masked, plaintext, or partial)
- `Authorization` header
- `NEXTAUTH_SECRET`
- `ENCRYPTION_KEY`
- A user's GitHub token (we never have it, but check your code paths)

## Dashboards

When you have paying customers, build a Grafana / Datadog dashboard
with:

- Active users (DAU / WAU / MAU)
- Display page p50 / p95 latency
- Per-upstream data source success rate
- Cache hit rate (from `fetch_cache`)
- Webhook delivery success rate
- Sign-in failures
- Account deletions (track rate)

## Alerting

Use Sentry's built-in alerts. Suggested rules:

- **Critical**: any 5xx on `/api/*` for >5min
- **Critical**: GitHub OAuth callback error rate > 10%
- **Warning**: upstream rate limit (429) hits > 50/hr from any
  provider
- **Warning**: `/display` p95 > 3s for 15min (e-ink users are patient
  but very slow = problem)
- **Info**: daily backup completed (from `scripts/backup.sh`)

## What NOT to monitor

- Individual user API keys (we never see them)
- Specific tickers (privacy)
- Specific dollar amounts (privacy)
- Per-user refresh intervals (low signal, high cardinality)

## Cost ceiling

For 1,000 active users, total observability cost should be under
$30/mo (Sentry free + Plausible $9 + Vercel logs included). If it
exceeds that, your event instrumentation is too verbose.
