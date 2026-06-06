# Handoff

This document is the comprehensive state of the Ink Monitor project as of
the last commit, with a clear split between **what is done in this repo**
and **what requires decisions or external services**.

If you are inheriting this codebase, read this first. If you are the
author, use this as your checklist for commercializing / open-sourcing.

---

## What's in the repo (done, ready to use)

### Application
- Next.js 15 + TypeScript + React 19
- Multi-tenant SaaS with per-user data isolation
- 11 provider types (OpenAI, Anthropic, Custom, Demo, Groq, Mistral,
  DeepSeek, Moonshot, Zhipu, OpenRouter, Ollama)
- 3 stock markets (US, CN, HK) with 30-day sparkline
- AES-256-GCM encryption with per-user PBKDF2-derived key
- E-ink optimized `/display` page with B&W design, SVG sparklines, hourly
  usage bars
- Opt-in soft refresh for capable browsers
- `npx ink-monitor` CLI
- GitHub OAuth + optional dev login
- Share link (`/display?share=…`)
- Pre-flight TTL warning
- EN / 中文 / 日本語 i18n
- Webhooks (subscribe + sign + deliver)
- Audit log
- OpenAPI 3.1 spec at `/openapi.json`
- Data export / import
- Hard delete account
- Cookie consent banner
- Health check + readiness endpoints
- Sentry shim (optional, lazy-loaded)

### Operations
- `scripts/backup.sh` — WAL-checkpointed, gzipped, rclone-aware
- `scripts/restore.sh` — atomic restore with rollback
- `scripts/ink-monitor.service` — hardened systemd unit
- `Dockerfile` *(TODO — not yet present)*
- `docker-compose.yml` *(TODO — not yet present)*

### Quality
- 45 unit tests (vitest), all passing
- TypeScript strict mode
- `pnpm test`, `pnpm build` clean

### Governance & community
- `LICENSE` (MIT)
- `CHANGELOG.md` (Keep-a-Changelog format)
- `CONTRIBUTING.md` (e-ink-first ground rules)
- `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1)
- `SECURITY.md` (threat model + disclosure)
- `PRIVACY.md` (data inventory, GDPR/CCPA)
- `TERMS.md` (acceptable use, paid-plan placeholder)
- `.github/ISSUE_TEMPLATE/{bug,feature,question}.md`
- `.github/PULL_REQUEST_TEMPLATE.md` (e-ink + security checklists)
- `.github/labels.yml` (label catalog)
- `.github/labeler.yml` (auto-label by path)
- `.github/dependabot.yml` (weekly, grouped)
- `.github/workflows/ci.yml` (test + build + e-ink smoke)

### Claude Code skills (`.claude/skills/`)
- `quickstart` — one-sentence local deploy
- `deploy` — Vercel one-click (planned)
- `release` — version tagging (planned)
- `contribute` — first-time PR walkthrough (planned)

### Branded assets
- `public/favicon.svg` — B&W monogram
- `public/apple-touch-icon.png` — 180×180
- `public/og.svg` — 1200×630 social preview

---

## What needs your decision or action

These are documented in dedicated files; this is the index.

| # | Item | Doc |
|---|---|---|
| 1 | Pricing tiers, free vs paid, billing | [`PRICING.md`](./PRICING.md) |
| 2 | Brand identity (logo, colors, name) | [`BRANDING.md`](./BRANDING.md) |
| 3 | Status page setup | [`STATUS_PAGE.md`](./STATUS_PAGE.md) |
| 4 | Documentation site (docs.ink-monitor.com) | [`DOCS_SITE.md`](./DOCS_SITE.md) |
| 5 | Stripe / billing integration | [`BILLING.md`](./BILLING.md) |
| 6 | Analytics (Plausible / PostHog / GA) | [`OBSERVABILITY.md`](./OBSERVABILITY.md) |
| 7 | Community channels (Discord, Discussions) | [`COMMUNITY.md`](./COMMUNITY.md) |
| 8 | First release tag (v0.1.0) | [`RELEASE.md`](./RELEASE.md) |
| 9 | Domain & DNS | this file, "First deploy" below |
| 10 | Press kit, demo video, customer logos | [`BRANDING.md`](./BRANDING.md) |

---

## First deploy checklist

Before pushing to production for the first time:

- [ ] Pick a domain (suggested: `ink-monitor.com`)
- [ ] Decide on the brand (see `BRANDING.md`)
- [ ] Generate production secrets (see below)
- [ ] Deploy to Vercel (button in README, or `vercel --prod`)
- [ ] Set up GitHub OAuth app at https://github.com/settings/developers
      with callback URL `https://<domain>/api/auth/callback/github`
- [ ] Verify the deploy hits `/api/health` and returns 200
- [ ] Set up the status page (see `STATUS_PAGE.md`)
- [ ] Set up error monitoring (Sentry — see `OBSERVABILITY.md`)
- [ ] Create the GitHub repo and push (the commit is already local)
- [ ] Apply the label catalog (see `COMMUNITY.md`)
- [ ] Publish v0.1.0 tag (see `RELEASE.md`)
- [ ] Smoke test the public /display on a Kindle or e-ink simulator

---

## Generating production secrets

```bash
ENCRYPTION_KEY=$(openssl rand -hex 32)
NEXTAUTH_SECRET=$(openssl rand -hex 32)
SENTRY_DSN=https://...@sentry.io/...   # optional
```

Save these in your platform's secret manager (Vercel env vars, GitHub
Actions secrets, AWS Secrets Manager, etc.). Never commit them.

---

## What's not in scope (yet)

Things that would each warrant a separate spec / project:

- Mobile apps (iOS, Android) — the `/display` web page is the client
- Real-time push (WebSocket) — we use polling deliberately for e-ink
- AI-driven insights ("your usage spiked 3x on Tuesday") — needs a
  history store
- Team accounts / organizations — current model is 1 user = 1 account
- White-label / on-prem enterprise — we have a self-host story but no
  per-tenant theming

These are noted in `CHANGELOG.md` under "Future directions".

---

## Contact

For questions about this handoff: open a GitHub Discussion.
For security issues: `security@ink-monitor.local` (see SECURITY.md).
