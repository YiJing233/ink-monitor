# Ink Monitor

> A B&W monitoring dashboard tuned for **Kindle** and **小米电纸书** — track your
> AI token-plan usage, a stock watchlist, and any e-ink widget you can describe
> in JSON, on a screen that barely uses power.
> **Manifest-driven widget platform**, multi-tenant SaaS, GitHub OAuth, per-user
> encrypted API keys, one-click deploy.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYiJing233%2Fink-monitor%2Ftree%2Fmain&env=GITHUB_ID,GITHUB_SECRET,ENCRYPTION_KEY,NEXTAUTH_SECRET&envDescription=Required%20env%20vars&envLink=https%2F%2Fgithub.com%2Fyour-org%2Fink-monitor%2Fblob%2Fmain%2FDEPLOY.md)

---

## Why

Most monitoring tools (Datadog, Grafana, Vercel dashboards) are designed for
always-on color displays. E-ink readers are different:

- **Battery lasts weeks**, not hours — a dashboard you can leave open.
- **No backlight, no eye strain** — glanceable from a bedside table.
- **Glare-free in sunlight** — useful for outdoor / kitchen / lab use.
- **Cheap to leave running** — no power-hungry laptop required.

Kindle and 小米电纸书 both have a working browser. We render a server-only
HTML page that auto-refreshes every minute via `<meta http-equiv="refresh">`.
No JavaScript required for the display side; an opt-in soft refresh runs on
modern browsers only.

---

## Features at a glance

### Token-plan monitoring

| Provider | Endpoint | Notes |
|---|---|---|
| **OpenAI / Codex** | `GET /v1/usage` | Rolling 24h aggregation across hourly buckets |
| **Anthropic Claude** | `POST /v1/messages` (1-token probe) | Parses `anthropic-ratelimit-*` response headers |
| **Groq** | `GET /openai/v1/usage` | OpenAI-compatible |
| **Mistral AI** | `GET /v1/usage` | OpenAI-compatible |
| **DeepSeek** | `GET /v1/usage` | OpenAI-compatible |
| **Moonshot (月之暗面)** | `GET /v1/usage` | OpenAI-compatible |
| **Zhipu GLM (智谱)** | `GET /api/paas/v4/usage` | OpenAI-compatible |
| **OpenRouter** | `GET /api/v1/usage` | OpenAI-compatible |
| **Ollama (local)** | `GET /api/usage` | OpenAI-compatible, `localhost:11434` |
| **Custom** | Any URL | User supplies base URL, endpoint, and dot-path to used/limit/reset |
| **Demo** | none | Canned, time-varying sample data — perfect for trying the product |

Each provider card on `/display` shows:

- Live **used / limit** with a B&W usage bar
- A **24-hour history** of token usage (24-bar SVG chart, hatched fill)
- The **next reset time** when the API exposes it
- A **cached / fresh** indicator and the row's own `refresh_seconds`

### Stock watchlist

- **US** (AAPL, MSFT, NVDA, TSLA, BABA, …) — Tencent `qt.gtimg.cn` (real-time).
- **CN / A-share** (贵州茅台, 比亚迪, …) — Tencent with Sina fallback.
- **HK** (腾讯 00700, 阿里 09988, …) — Tencent.
- **30-day sparkline** on every row (SVG, B&W hatch pattern, no animation).
- **Minute-level refresh** — cached server-side for 60s by default.

### SaaS infrastructure

- **GitHub OAuth** via NextAuth (with optional local-dev login for testing).
- **Multi-tenant data**: every row scoped by `user_id`, FK-cascaded on delete.
- **Per-user encryption**: `PBKDF2(ENCRYPTION_KEY, user_id, 100k, sha256)` →
  AES-256-GCM. The DB alone is useless without the server's master key.
- **Share link** (`/display?share=<token>`) — hand a stable URL to your Kindle
  without exposing your `user_id`. Revocable from `/admin`.
- **Pre-flight TTL warning** in `/admin` — flags rows whose `refresh_seconds`
  is below the upstream's known latency. Prevents accidental rate-limit
  burn on Anthropic / OpenAI.
- **i18n** — English / 中文 with `Accept-Language` auto-detection and a
  cookie-persisted switcher in the nav.

### Developer experience

- **`npx ink-monitor`** CLI (`bin/ink-monitor.mjs`) — `login`, `provider add`,
  `stock add`, `demo`, `list`, `open`, `deploy`.
- **Vercel deploy button** in this README and on the landing page.
- **Demo mode** — one-click "Load demo data" on the admin overview adds a
  demo provider and 7 popular tickers. No API keys required to see the
  product working.
- **Open-source skill** — `.claude/skills/quickstart/SKILL.md` packages the
  full setup for Claude Code.

### Widget platform

- **Declarative widget platform** — a widget is a validated `WidgetManifest`
  (JSON), not code. Closed, versioned IR (`lib/widgets/ir.ts`), one trusted
  renderer, multi-tenant safe by construction.
- **8 built-in widgets** — `api-usage`, `stocks-table`, `todo-lark`, `gallery`,
  `clock`, `countdown`, `weather`, `rss`. Drop them onto the canvas, save, done.
- **Canvas editor with 1:1 e-ink preview** — `/admin/canvas` snap-grid DnD,
  device switch, live `/preview?dashboard=<id>` iframe at native pixels. The
  preview uses the same renderer as `/display`, so what you see is what the
  glass will show.
- **Curated Market + signed/private registry** — `/admin/market` installs
  widgets into a per-user library with an install-time permission prompt
  (egress / secrets / writes). Optional `MARKET_REGISTRY_TOKEN` (Bearer) or
  `MARKET_REGISTRY_HMAC_KEY` (HMAC) auth for a private registry.
- **Multi-backend album upload** — `disk` (self-host), `vercel-blob`
  (auto-detected on Vercel via `BLOB_READ_WRITE_TOKEN`), and `s3` (S3 / R2 /
  MinIO via `S3_ENDPOINT`). Pick with `ALBUM_STORE=...`; SDKs are
  `optionalDependencies`, so they don't force-install.
- **SSRF-hardened + HMAC-signed asset proxy** — `/api/asset/dither` only serves
  URLs the platform itself minted (HMAC-SHA256 keyed by `ENCRYPTION_KEY`);
  1-bit Atkinson / Floyd-Steinberg dithering for crisp e-ink photos.

---

## Widget Platform

Ink Monitor ships as a **manifest-driven widget platform** — the "Server-Driven
UI for e-ink" approach (think Block Kit / Adaptive Cards, but tuned for
B&W Kindle glass).

- A widget is a validated **`WidgetManifest`** (JSON), never code. The
  authoring surface — LLM via the skill, or the canvas editor — is constrained
  to producing valid manifests; the platform owns the trusted renderer.
- Six layers wired end-to-end: source trust tiers → IR vocabulary → binding
  resolver → renderer → per-device placement → gen-UI authoring loop. See
  [ARCHITECTURE.md](ARCHITECTURE.md) for the deep dive.
- Eight built-in widgets: **`api-usage`**, **`stocks-table`**, **`todo-lark`**,
  **`gallery`**, **`clock`**, **`countdown`**, **`weather`**, **`rss`**.
- Five reference device profiles (Kindle Paperwhite / Oasis, 小米多看 Pro,
  Boox Note, 通用横屏) — the canvas editor keeps one layout per device and
  auto-reflows when you seed a new one.
- Install-time permission prompt (egress / secrets / writes) comes from the
  manifest's `capabilities`, so the user sees exactly what they're agreeing to
  before a widget ships a request.

An AI-assisted authoring loop lives at
[`.claude/skills/widget/SKILL.md`](.claude/skills/widget/SKILL.md) — it walks
Claude through interview → manifest → validate → preview → install.

## Widget development

Widgets are authored as JSON. The simplest built-in (`api-usage`, the
token-usage card) reads like this:

```json
{
  "v": 1,
  "id": "api-usage",
  "name": "API Usage",
  "source": { "kind": "builtin", "ref": "provider" },
  "families": ["1x1", "2x1", "2x2"],
  "layout": {
    "1x1": { "t": "bignum", "value": { "$": "used_pct" }, "unit": "%", "sub": { "$": "name" } },
    "2x2": {
      "t": "col",
      "children": [
        { "t": "metric", "label": "Tokens", "value": { "$": "used" }, "max": { "$": "limit" }, "unit": "tok" },
        { "t": "series", "kind": "bar", "data": { "$": "hourly" }, "window": "24h", "unit": "tok" }
      ]
    }
  },
  "capabilities": { "egress": ["api.openai.com"], "secrets": ["OPENAI_API_KEY"] },
  "refresh": 300
}
```

A `Bind` is `{ "$": "path" }` into the resolved source data. For the full
schema — `bignum`, `metric`, `series`, `table`, `list` (+ `check`), `text`,
`image`, `qr`, `row`, `col`, `grid`, `divider` — see
[`lib/widgets/ir.ts`](lib/widgets/ir.ts).

Run the widget test suite locally:

```bash
pnpm test                          # vitest: safe-fetch, select, dither, sign, qr, …
pnpm test lib/widgets              # widget-specific suite
```

---

## Quickstart

```bash
# clone & install
git clone <this-repo> ink-monitor
cd ink-monitor
pnpm install
pnpm rebuild better-sqlite3     # native binding

# generate secrets
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export NEXTAUTH_SECRET=$(openssl rand -hex 32)
export ENABLE_DEV_LOGIN=true     # skip GitHub OAuth for local testing

pnpm dev
```

Open <http://localhost:3000>, click **Sign in** (the dev provider accepts any
email), then **Load demo data** in `/admin` — your dashboard will be live in
10 seconds.

For production, drop `ENABLE_DEV_LOGIN` and set `GITHUB_ID` / `GITHUB_SECRET`
from <https://github.com/settings/developers> (callback URL:
`https://<your-domain>/api/auth/callback/github`).

---

## Project layout

```
app/
  layout.tsx                       Root layout + globals.css
  page.tsx                         Server: detect locale → LandingClient
  landing-client.tsx               Client: marketing page (i18n)
  signin/page.tsx                  GitHub OAuth + dev login
  providers.tsx                    SessionProvider
  locale-switcher.tsx              i18n picker
  globals.css                      E-ink B&W design tokens + landing styles
  display/
    page.tsx                       ← the e-ink view (server-rendered + soft refresh)
  admin/                           Modern-browser config UI
    layout.tsx                     Nav + sign-out
    page.tsx                       Status, demo button, share panel
    share-panel.tsx                Share-link create/regenerate/revoke
    load-demo-button.tsx           One-click demo seed
    providers/page.tsx             CRUD + reorder + TTL warning
    stocks/page.tsx                CRUD + reorder + TTL warning
    settings/page.tsx              Refresh interval + page title
  api/                             All HTTP endpoints (auth-gated by middleware)
    auth/[...nextauth]/route.ts    NextAuth handler
    share/route.ts                 Share-token mint/rotate/revoke
    me/route.ts                    Current user info
    demo/route.ts                  Load sample data
    snapshot/route.ts              Full display payload (public via ?share=)
    providers/route.ts             POST/GET
    providers/[id]/route.ts        PATCH/DELETE/move
    stocks/route.ts                POST/GET
    stocks/[id]/route.ts           DELETE/move
    settings/route.ts              GET/POST
  auth/cli/route.ts                CLI OAuth entry

lib/
  db.ts                            better-sqlite3 schema (users, providers, stocks,
                                   settings, fetch_cache) + CRUD
  crypto.ts                        Per-user PBKDF2 → AES-256-GCM
  auth.ts                          NextAuth config (GitHub + dev)
  session.ts                       getCurrentUserId / getRequiredUserId /
                                   getUserIdFromShareToken
  aggregator.ts                    One snapshot per user, per-row TTL cache
  i18n.ts                          EN / 中文 dictionaries
  ttl.ts                           Pre-flight TTL guidance per source
  seed.ts                          First-run pre-seed + loadDemoData
  stocks.ts                        Tencent / Sina / Yahoo + Eastmoney K-line +
                                   synthetic fallback for sparkline
  providers/
    openai.ts                      /v1/usage, rolling 24h, hourly history
    anthropic.ts                   rate-limit headers from probe
    custom.ts                      dot-path JSON parser
    demo.ts                        canned time-varying sample data
    labels.ts                      PROVIDER_LABELS + PROVIDER_DEFAULTS
    index.ts                       fetcher registry (server-only)
    types.ts                       UsageMetric / UsageSnapshot

bin/
  ink-monitor.mjs                  CLI (login, provider add, stock add, demo,
                                   list, open, deploy)

.claude/
  skills/quickstart/SKILL.md        One-sentence deploy for Claude Code

data/                              SQLite, gitignored
```

---

## How `/display` works

`/display` is the heart of the product. It must run on:

- **Old Kindle** (Paperwhite 3+, Oasis) — WebKit 2014-era experimental browser.
  No Grid, no `:has()`, no WebSocket, no IntersectionObserver, very limited
  modern CSS.
- **小米电纸书 / 多看** — modern Android WebView.
- **Any desktop or mobile browser** — looks the same, behaves the same.

To meet all of these, the page is **server-rendered, no client JS required**:

- HTML is plain semantic divs + tables, Flexbox for layout (not Grid).
- Colors are pure B&W — no grey gradients, no shadows, no transparency.
- Fonts are system stack only — no Web Font download, no FOUT.
- All animations and transitions are disabled globally.
- `<meta http-equiv="refresh" content="N">` for polling — works on every
  browser, no JS needed.
- All numeric values use thousand separators (`1,272.86 CNY`) so they read
  well without tabular-nums support.

For **capable browsers** (desktop, modern mobile), an opt-in soft refresh
script runs:

- Detects e-ink user agents (Kindle, Xiaomi, Boox, …) and no-ops, leaving the
  full `<meta refresh>` to do its full-screen redraw.
- On other browsers, fetches `/api/snapshot` every N seconds, parses the new
  HTML with `DOMParser`, and patches the existing DOM in place — no layout
  shift, no flash.

---

## How the data flow works

```
                                       ┌──────────────────┐
                                       │   /admin (auth)  │
                                       │  Manage rows +   │
                                       │  share link +    │
                                       │  settings        │
                                       └────────┬─────────┘
                                                │ CRUD
                                                ▼
┌──────────────────┐                  ┌──────────────────────────┐
│   GitHub OAuth   │──── session ────▶│  lib/db.ts (SQLite)      │
│   / NextAuth     │                  │  users, providers,       │
└──────────────────┘                  │  stocks, settings,       │
                                       │  fetch_cache, share_tok  │
                                       └────────┬─────────────────┘
                                                │
                                                ▼
                                       ┌──────────────────────────┐
                                       │  lib/aggregator.ts       │
                                       │  Per-row TTL cache       │
                                       │  Display refresh =       │
                                       │  min(all rows)           │
                                       └────────┬─────────────────┘
                                                │
                          ┌─────────────────────┼────────────────────┐
                          ▼                     ▼                    ▼
                ┌───────────────────┐  ┌─────────────────┐  ┌────────────────┐
                │  lib/providers/   │  │  lib/stocks.ts  │  │  /api/share    │
                │  openai / anthropic│ │  Tencent / Sina │  │  (token mint)  │
                │  custom / demo    │  │  Yahoo / Eastm  │  └────────────────┘
                │  groq / mistral … │  │  + synthetic    │
                └───────────────────┘  └─────────────────┘
                          │                     │
                          └──────────┬──────────┘
                                     ▼
                            ┌─────────────────┐
                            │  /api/snapshot  │
                            │  Public via     │
                            │  ?share=TOKEN   │
                            └────────┬────────┘
                                     │ polled by
                                     ▼
                            ┌─────────────────┐
                            │  /display       │
                            │  <meta refresh> │
                            │  + soft refresh │
                            │  on capable UAs │
                            └─────────────────┘
```

---

## Security model

| Layer | Protection |
|---|---|
| **At rest — API keys** | AES-256-GCM, per-user key via `PBKDF2(ENCRYPTION_KEY, user_id, 100k, sha256)`. Random IV per record. Production refuses to boot if `ENCRYPTION_KEY` is unset. |
| **In transit** | HTTPS via Vercel / your reverse proxy. The CLI uses bearer tokens. |
| **Master key** | `ENCRYPTION_KEY` lives only in your deployment's env. If leaked: rotate, and re-encrypt every row. |
| **DB alone** | Useless. Every key is bound to `user_id`; without the master, PBKDF2 can't derive the per-user key. |
| **OAuth** | GitHub scope is `read:user user:email`. We never see private repos. No password is stored. |
| **Public surface** | `/display` and `/api/snapshot` are the only public endpoints. Snapshot is scoped by session cookie OR `?share=TOKEN`. Legacy `?u=<userId>` and `x-ink-user` fallbacks are removed — anonymous reads return 401. |
| **Share token** | 24-byte base64url, revocable. Without it, `/display?share=…` returns an empty snapshot. |
| **Widget source (`http`)** | `lib/widgets/safe-fetch.ts`: scheme allowlist, DNS-resolved private/loopback/metadata IP blocking, manual redirect re-validation, timeout + byte cap, `capabilities.egress` per-manifest allowlist. Closes SSRF for user-installed widgets. |
| **Asset proxy** | `/api/asset/dither` only serves URLs the platform itself minted — HMAC-SHA256 over the path, keyed by `ENCRYPTION_KEY` (`lib/widgets/sign.ts`). Closes the open-proxy hole for dithered images. |
| **Album paths** | Zod-segment whitelist on `/api/albums/[name]` / `[fileId]` + `assertSafeAlbumPath()` (`path.resolve` prefix assertion) inside `lib/widgets/album-store.ts`. Closes the path-traversal `name="../../etc"` vector. |
| **Widget save** | `PUT /api/dashboards/[id]` wraps insert + update + GC in a single `withTx()` (better-sqlite3 transaction). No half-saved dashboards. |
| **Registry auth** | Opt-in `MARKET_REGISTRY_TOKEN` (Bearer) or `MARKET_REGISTRY_HMAC_KEY` (HMAC over `METHOD\nURL\nTS`, 5-min replay window) flips the curated `/api/market` from anonymous to authenticated. |

### Threat model — what can go wrong

1. **DB leak** (e.g. backup exposed). Attacker has ciphertext + user_ids, but
   no `ENCRYPTION_KEY`. PBKDF2 with 100k iterations makes brute-forcing the
   master key infeasible.
2. **Master key leak** + DB leak. Rotate `ENCRYPTION_KEY` immediately and
   prompt users to re-enter their API keys.
3. **Share token leak**. Visit `/admin → Share link → Revoke`, then
   `Regenerate` to issue a new token. The old URL stops working immediately.
4. **OAuth compromise**. Users can revoke GitHub access from
   <https://github.com/settings/applications>. Their data in our DB remains
   encrypted but inaccessible (no session, no valid share token).

---

## Configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `ENCRYPTION_KEY` | yes | — | 64-hex chars: `openssl rand -hex 32`. Master key for API key encryption. |
| `NEXTAUTH_SECRET` | yes | — | 32+ char random string. JWT signing. |
| `GITHUB_ID` | yes (prod) | — | OAuth app client id. |
| `GITHUB_SECRET` | yes (prod) | — | OAuth app client secret. |
| `ENABLE_DEV_LOGIN` | no | unset | `true` enables the email-only dev provider. NEVER in prod. |
| `DEFAULT_REFRESH_SECONDS` | no | `60` | Default display refresh. |
| `STOCK_CACHE_TTL` | no | `60` | Server-side stock quote cache TTL (ms). |
| `INK_MONITOR_API` | no (CLI) | `https://ink-monitor.example.com` | CLI target base URL. |
| `INK_MONITOR_TOKEN` | no (CLI) | — | CLI bearer token. |

---

## CLI

```bash
npx ink-monitor login                                # OAuth (opens browser)
npx ink-monitor provider add openai sk-...           # add OpenAI key
npx ink-monitor provider add groq gsk-...             # add Groq
npx ink-monitor provider add anthropic sk-ant-...     # add Anthropic
npx ink-monitor stock add AAPL us                     # add US stock
npx ink-monitor stock add 600519 cn                   # add CN stock
npx ink-monitor stock add 00700 hk                    # add HK stock
npx ink-monitor demo                                  # load sample data
npx ink-monitor list                                  # show current config
npx ink-monitor open                                  # open /display in browser
npx ink-monitor deploy --target=vercel                # deploy instructions
```

Auth state is stored in `~/.ink-monitor/config.json` with `0600` perms.

---

## Deployment

### Vercel (one click)

The button at the top of this README clones the repo, prompts for the four
required env vars, and deploys. See [DEPLOY.md](DEPLOY.md) for the full guide
and notes on Vercel serverless filesystem constraints (SQLite doesn't
persist — switch to Turso/libSQL for production).

### Self-host

```bash
git clone <this-repo> && cd ink-monitor
pnpm install && pnpm rebuild better-sqlite3
ENCRYPTION_KEY=$(openssl rand -hex 32) \
  NEXTAUTH_SECRET=$(openssl rand -hex 32) \
  GITHUB_ID=... GITHUB_SECRET=... \
  pnpm start
```

One process, one SQLite file, no external dependencies. Run it behind nginx /
Caddy with basic auth or Tailscale for internet exposure.

### CLI deploy helper

```bash
npx ink-monitor deploy --target=vercel
npx ink-monitor deploy --target=local
```

Prints the exact commands needed for each target.

---

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/providers` | session | list (key masked) |
| POST | `/api/providers` | session | create |
| PATCH | `/api/providers/:id` | session | update |
| DELETE | `/api/providers/:id` | session | delete |
| POST | `/api/providers/:id` | session | `{action:"move", direction:"up"\|"down"}` |
| GET | `/api/stocks` | session | list |
| POST | `/api/stocks` | session | create |
| DELETE | `/api/stocks/:id` | session | delete |
| POST | `/api/stocks/:id` | session | reorder |
| GET | `/api/settings` | session | read |
| POST | `/api/settings` | session | update |
| GET | `/api/share` | session | mint or read share token |
| POST | `/api/share` | session | regenerate share token |
| DELETE | `/api/share` | session | revoke |
| GET | `/api/me` | session | current user |
| POST | `/api/demo` | session | load sample data |
| GET | `/api/snapshot` | public | full display payload; resolves by session or `?share=` |
| GET | `/api/auth/*` | public | NextAuth |

---

## Roadmap (status: all shipped)

- [x] Multi-row refresh interval (per-provider + per-stock)
- [x] Per-provider `refresh_seconds` override
- [x] OpenAI rolling 24h aggregation
- [x] Reorder via up/down buttons in `/admin`
- [x] Client-side soft refresh for capable browsers
- [x] Pre-flight TTL warning in `/admin`
- [x] Share link (`/display?share=…`) for Kindle bookmarking
- [x] OpenAI hourly usage chart (24-bar SVG)
- [x] Groq / Mistral / DeepSeek / Moonshot / Zhipu / OpenRouter / Ollama
      OpenAI-compatible presets
- [x] GitHub OAuth + multi-tenant data model
- [x] Per-user AES-256-GCM key encryption
- [x] EN / 中文 i18n
- [x] `npx ink-monitor` CLI
- [x] `/quickstart` skill for Claude Code
- [x] Vercel one-click deploy

---

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — widget platform layers (IR, source,
  renderer, placement, canvas, market), trust tiers, and the
  `1:1 preview guarantee`.
- [CHANGELOG.md](CHANGELOG.md) — release notes (widget platform, P1 hardening,
  hosted album backends, etc.).
- [`/admin/canvas`](app/admin/canvas) — canvas editor + live device preview.
- [`/admin/market`](app/admin/market) — curated widget gallery + per-user
  library + portable share/import.
- [`/admin/albums`](app/admin/albums) — album manager (disk / Vercel Blob / S3).
- [`.claude/skills/widget/SKILL.md`](.claude/skills/widget/SKILL.md) — gen-UI
  authoring loop: interview → manifest → validate → preview → install.
- [`.claude/skills/quickstart/SKILL.md`](.claude/skills/quickstart/SKILL.md) —
  one-sentence deploy for Claude Code.

---

## License

MIT.
