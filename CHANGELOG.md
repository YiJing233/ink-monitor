# Changelog

All notable changes to Ink Monitor are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/) once we tag 1.0.

## [Unreleased]

### Added
- **Phase 1 non-usage built-ins: `weather` + `rss`.** Two new declarative
  `http` manifests in `lib/widgets/manifests/` (registered in
  `BUILTIN_MANIFESTS` and validated by `ManifestSchema`). `weather` calls
  OpenWeatherMap's `/data/2.5/weather` with a templated `{{city}}` +
  user-supplied `{{OWM_KEY}}` secret, projects the response with JSONPath
  `select` (`temp`, `cond`, `humidity`, `wind`, `icon`), and renders
  `bignum`+`text` in `1x1 / 2x2 / 4x2`; egress is pinned to
  `api.openweathermap.org`. `rss` is a generic feed reader bound to
  `{{feedUrl}}` (any public JSON-shaped feed) with an *empty* egress
  allowlist — the install prompt therefore emits the `EGRESS_UNRESTRICTED`
  notice, surfacing the trade-off to the user instead of silently allowing
  arbitrary outbound requests. Renders a `list` of titles in
  `1x2 / 2x2 / 4x4` with a header. IR vocabulary: `text.prefix?` (designer-
  controlled static label prefixed to a bound value, e.g. "humidity 62") and
  `list.primary?` is now optional (an omitted `primary` falls back to the
  item itself, so an RSS select that already unwrapped to `item[*].title`
  works without an intermediate re-shape). Sample data added to
  `manifests/sample-data.ts`; `applySelect`-level tests in
  `__tests__/weather.test.ts` and `__tests__/rss.test.ts` cover both the
  manifest validation and the post-select shape. No new dependencies.
- **Phase 1 non-usage built-ins: `clock` + `countdown`.** Two new manifests
  in `lib/widgets/manifests/` registered alongside the existing Phase 0
  references. `clock` reads a per-user time zone from `settings:clock`
  (owned-state), 24-hour wall time rendered via `bignum`+`text` layouts in
  `1x1 / 2x2 / 4x2`; `countdown` does days/hours to a target date stored at
  `settings:countdown:<instanceId>` (templated `{{instanceId}}` per widget,
  same syntax the `http` source uses for URL/body vars). Source layer:
  `resolveClockSource(tz)` / `resolveCountdownSource(target, label)` pure
  helpers in `lib/widgets/builtin-sources.ts` (client-safe; reused by the
  sample-data fixtures so the gallery always shows "now"). Schema validation
  enforced automatically by `BUILTIN_MANIFESTS`. No new dependencies.
- **Widget platform (manifest-driven).** Users now author arbitrary e-ink
  widgets through a validated declarative `WidgetManifest` (JSON), not code —
  the "Server-Driven UI for e-ink" approach. Closed, versioned IR vocabulary
  (`lib/widgets/ir.ts`): data (`bignum`, `metric`, `series`, `table`, `list`
  with `check`, `text`), media (`image`, `qr`), layout (`row`, `col`, `grid`,
  `divider`). A `Bind` is `{ "$": "path" }` into the resolved source data.
- **Six-layer architecture** wired end-to-end: L1 source trust tiers
  (`demo | builtin | http | owned | asset | album`), L2 IR vocabulary, L3
  binding resolver, L4 shared `WidgetRenderer` + `DashboardCanvas`, L5
  per-device `Placement` + `resolveFamily` + collision detection, L6
  `.claude/skills/widget/SKILL.md` (gen-UI authoring loop). See `ARCHITECTURE.md`.
- **Size families (Apple-widget model).** Each manifest declares its
  supported families (`1x1`, `2x1`, `1x2`, `2x2`, `4x2`, `4x4`) and a
  per-family layout variant. Five reference device profiles
  (`lib/widgets/devices.ts`) — Kindle Paperwhite/Oasis, 小米多看 Pro, Boox
  Note, 通用横屏 — with native pixel sizes and grids. Cross-device adaptation
  is in the data model: `Dashboard.layouts` is keyed per device and an
  `autoReflow` clamps spans when seeding a new device.
- **Source execution pipeline** (`lib/widgets/source.ts`). Single place
  provider/stock data crosses into widgets: `demo` → inline; `builtin` →
  reuses `getDisplayData`; `http` → SSRF-guarded fetch + JSONPath `select`;
  `owned` → SQLite-stored TODO/notes; `asset` → rewritten through the
  dithering proxy with HMAC-signed URLs; `album` → wall-clock-bucketed
  rotation. Provider + stock cards re-expressed as manifests (`api-usage`,
  `stocks-table`).
- **SSRF hardening.** `lib/widgets/safe-fetch.ts`: scheme allowlist,
  DNS-resolved private/loopback/metadata IP blocking, manual redirect
  re-validation, timeout + byte cap, `capabilities.egress` allowlist per
  manifest.
- **Image pipeline.** `lib/widgets/dither.ts` (Atkinson/Floyd-Steinberg +
  dependency-free PNG encoder) behind `/api/asset/dither` (uses `sharp` to
  decode, degrades to a redirect if not built). URL signing via
  `lib/widgets/sign.ts` (HMAC-SHA256 keyed by `ENCRYPTION_KEY`) so the
  proxy only serves URLs the platform itself minted.
- **Canvas editor + 1:1 preview.** `/admin/canvas` snap-grid DnD with
  device switch + live preview iframing `/preview?dashboard=<id>`. Editor
  enforces no-overlap on the client; `/preview` and `/display` go through
  the same `WidgetRenderer`, so web preview is a perfect replica of the
  glass. Persistence: `dashboards` / `widgets` / `widget_secrets` /
  `owned_state` / `user_manifests` tables + full CRUD.
- **Market + manifest library.** `/admin/market` installs widgets into a
  per-user library behind an install-time permission prompt (egress /
  secrets / writes derived from `capabilities`, `lib/widgets/capabilities.ts`).
  Share via a portable code, import by paste. Curated remote gallery at
  `/api/market` (default reads `public/market/registry.json`, override with
  `MARKET_REGISTRY_URL`); semver comparator `lib/widgets/version.ts` powers
  the "可更新" one-click update flow.
- **Hosted album upload (new backends).** `vercel-blob` and `s3` adapters in
  `lib/widgets/album-store.ts`, pluggable via `ALBUM_STORE=vercel-blob|s3`
  (or auto-detect on Vercel with `BLOB_READ_WRITE_TOKEN` / `S3_BUCKET` +
  `S3_REGION`). `@vercel/blob` and `@aws-sdk/client-s3` ship as
  `optionalDependencies` and are dynamic-imported so they don't force the
  install. R2/MinIO work via `S3_ENDPOINT` + `forcePathStyle`.
- **Signed/HMAC gallery auth for `MARKET_REGISTRY_URL`:** opt-in
  `MARKET_REGISTRY_TOKEN` (Bearer) or `MARKET_REGISTRY_HMAC_KEY` (HMAC over
  `METHOD\nURL\nTS` with a 5-min replay window). New `signQuery` / `verifyQuery`
  / `isFreshTimestamp` helpers in `lib/widgets/sign.ts`; client-safe
  `MARKET_AUTH_REQUIRED` mode list in `lib/widgets/registry-meta.ts` so the
  admin Market UI can show a "🔒 private registry" indicator.
- Per-user encryption: `PBKDF2(ENCRYPTION_KEY, user_id, 100k, sha256)` →
  AES-256-GCM for API key storage.
- Multi-tenant data model with `user_id` scoping and FK-cascaded deletes.
- GitHub OAuth via NextAuth, plus an opt-in `ENABLE_DEV_LOGIN` credentials
  provider for local development.
- Share link (`/display?share=…`) for handing a stable URL to a Kindle
  without exposing the user id. Revocable from `/admin`.
- OpenAI hourly usage chart (24-bar SVG) on the display.
- OpenAI-compatible presets for Groq, Mistral, DeepSeek, Moonshot, Zhipu
  GLM, OpenRouter, and Ollama.
- Pre-flight TTL warning in `/admin` tables: `⚠` below recommended, `⛔`
  below hard floor per source.
- `npx ink-monitor` CLI: `login`, `provider add`, `stock add`, `demo`,
  `list`, `open`, `deploy`.
- `/quickstart` skill for Claude Code.
- EN / 中文 i18n with `Accept-Language` auto-detection and a cookie
  switcher.
- Marketing landing page at `/` with mock e-ink device preview.
- Vercel one-click deploy button.

### Changed
- `/display` renders the user's saved dashboard through the shared
  `DashboardCanvas` (opt-in; legacy provider/stock view is the fallback when
  no dashboard exists).
- Soft refresh generalized: `app/display/soft-refresh.tsx` works for both
  legacy provider/stock pages (via `data-pid`/`data-symbol`) and the
  dashboard (via `data-w-inst`); e-ink UAs fall back to
  `<meta http-equiv="refresh">`.
- Provider fetch dispatch centralised: `fetchUsageForUser` is now the
  single fetch entry in `lib/providers/index.ts`; the duplicated
  dispatch in `lib/aggregator.ts` is gone. The fix routes
  groq/mistral/deepseek/moonshot/zhipu/openrouter/ollama to the `openai`
  fetcher (registry `REGISTRY`) instead of `custom`.
- Per-device refresh overrides: `dashboards.refresh_overrides_json` lets
  users pin a max-refresh-per-device (a cap, not a floor).
- pnpm workspace config: native builds (better-sqlite3 / esbuild / sharp)
  are skipped — they ship prebuilt binaries, the source rebuild needs
  Xcode CLT, which isn't always present.
- `/display` is now server-rendered, B&W-only, with an opt-in soft refresh
  script that detects e-ink user agents and no-ops (so the existing
  `<meta http-equiv="refresh">` keeps doing its full-screen redraw on
  Kindle / 小米 / Boox).
- Sparkline data is now 30 daily bars sourced from Eastmoney K-line with
  a deterministic synthetic fallback when upstream is rate-limited.
- Per-row `refresh_seconds` (15–86400s) overrides the global interval, and
  the display page picks the minimum of all rows as its meta-refresh.

### Fixed
- **Path traversal in `/api/albums/[name]` and `[fileId]`.** URL segments
  were passed directly to `path.join`, so `name="../../etc"` resolved
  outside the user's album directory. Now: Zod-segment whitelist on the
  route + `assertSafeAlbumPath()` with `path.resolve` prefix assertion
  inside `lib/widgets/album-store.ts`. `removeFile` only deletes items
  that actually exist in `list()`. Covered by 10 new security tests.
- **Canvas editor conflated `widgetId` and `manifestId` in `EditorItem`.**
  The internal `id` field carried a widget *instance* id while the
  single-letter `m` field carried a *manifest* id — they lived in the same
  struct without naming that difference, which made `placement`/`widgetId`
  mappings easy to get wrong (e.g. using the manifest id where an
  instance id was needed). Now: `EditorItem` has explicit
  `widgetInstanceId` (identity) and `manifestId` (type), with a docstring
  in `canvas-editor.tsx` distinguishing them. API payloads are
  unchanged — the PUT body still sends `manifestId` (for built-ins) /
  `manifest` (for custom) and the `?d=<…>` preview URL still uses the
  `{m, …}` shorthand accepted by `/preview`.
- **Canvas editor `m` field in `EditorItem` was the same shape as a
  widget `widgetId`.** Subsumed by the rename above.
- **`album-client.tsx` parsed the `fileId` out of `/api/album-asset/…/…/<id>`
  via a regex on `it.src`.** That worked only for the disk store; the
  vercel-blob and s3 stores host bytes at remote URLs that don't match
  the pattern, so deletion silently did nothing. Now: the client reads
  the store-provided `_fileId` field on each `Item` (disk/vercel-blob/s3
  all set it). The `urls` store still doesn't, which is by design —
  external URL items aren't deletable from the platform.
- **Documented `refresh_overrides` contract.** `lib/db.ts` now has an
  inline comment on `refresh_overrides_json` spelling out (a) it's a
  *per-device cap* on refresh frequency in seconds, (b) the server
  clamps to `[15, 86400]` via the PATCH zod schema, and (c) the display
  side re-applies a floor of 15 as defense-in-depth against legacy rows
  written before the clamp existed. The PATCH schema in
  `app/api/dashboards/[id]/route.ts` is now keyed by `DeviceId` and
  rejects unknown device ids, so a typo in the field name surfaces as a
  400 instead of being silently ignored.
- **`?u=<userId>` and `x-ink-user` auth bypass.** `/display` and
  `/api/snapshot` no longer honour these legacy fallbacks; only session
  cookie or `?share=<token>` is accepted. Unauthenticated reads now 401 /
  render an "auth required" page.
- **soft-refresh selector always produced `[data-="…"]`.** The previous
  `sel.split('').slice(0,6).join('')` returned `[data-` for every selector,
  so the patcher never matched `data-w-inst` / `data-pid` /
  `data-symbol`. Refactored to per-selector key groups; covered by 5 new
  tests.
- **`PUT /api/dashboards/[id]` non-atomic.** Now wraps
  `insertWidget × N + updateDashboard + gcWidgets` in a single
  `withTx()` (better-sqlite3 transaction). `gcWidgets` is currently
  user-scoped (intentional, with TODO pointer in the route for
  per-dashboard narrowing).
- **`http` source `body` was dropped silently.** Manifests can now declare
  `body`; values are templated with the same `{{VAR}}` substitution as
  `url` (config + secrets) and forwarded to `safeFetch`.
- **Prod `ENCRYPTION_KEY` was a silent fallback.** Now
  `lib/widgets/sign.ts` throws at module load if `NODE_ENV=production`
  and `ENCRYPTION_KEY` is unset (dev mode still falls back to
  `'dev-insecure-key'`).
- Tencent K-line field index off-by-one (change at parts[31], change% at
  parts[32], timestamp at parts[30] for US, HK, and CN).
- Yahoo Finance geo-block from server IPs: switched primary stock data
  source to Tencent with Sina / Yahoo / Eastmoney as fallbacks.
- `node:crypto` was being imported into the client bundle; moved server
  provider decryption to a server-only path.
- Better-sqlite3 native binding not built on a fresh `pnpm install`; added
  explicit rebuild step to the quickstart.

## [0.1.0] — 2026-06-06

### Added
- Initial commit.
- Next.js 15 + TypeScript + React 19 scaffold.
- Multi-tenant SQLite schema (users, providers, stocks, settings,
  fetch_cache).
- AES-256-GCM encryption for API keys at rest.
- Providers: OpenAI, Anthropic, Custom, Demo.
- Stock sources: Tencent (US/CN/HK), Sina fallback, Yahoo fallback.
- Admin UI: providers CRUD, stocks CRUD, settings, reorder, load-demo.
- E-ink display page with `<meta http-equiv="refresh">`.
- Per-row `refresh_seconds` override and aggregator-side TTL cache.
- Demo mode: pre-seeded 7 popular stocks; "Load demo data" button.
- Quickstart skill for Claude Code.
- README + DEPLOY.md.

[Unreleased]: https://github.com/YiJing233/ink-monitor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/YiJing233/ink-monitor/releases/tag/v0.1.0
