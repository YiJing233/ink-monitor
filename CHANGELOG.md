# Changelog

All notable changes to Ink Monitor are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/) once we tag 1.0.

## [Unreleased]

### Added
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
- `/display` is now server-rendered, B&W-only, with an opt-in soft refresh
  script that detects e-ink user agents and no-ops (so the existing
  `<meta http-equiv="refresh">` keeps doing its full-screen redraw on
  Kindle / 小米 / Boox).
- Sparkline data is now 30 daily bars sourced from Eastmoney K-line with
  a deterministic synthetic fallback when upstream is rate-limited.
- Per-row `refresh_seconds` (15–86400s) overrides the global interval, and
  the display page picks the minimum of all rows as its meta-refresh.

### Fixed
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

[Unreleased]: https://github.com/your-org/ink-monitor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/ink-monitor/releases/tag/v0.1.0
