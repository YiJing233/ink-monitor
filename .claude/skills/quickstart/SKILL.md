---
name: quickstart
description: One-sentence deploy of the Kindle E-ink Monitor. Installs deps, generates an encryption key, starts the dev server, and prints URLs to the admin and display pages. Optionally deploys to Vercel.
---

# Kindle E-ink Monitor — Quickstart

End-to-end bring-up of the monitoring dashboard in this repo, with sensible
defaults so the user sees a working `/display` page in under 60 seconds.

## What the user sees

1. Dependencies installed (pnpm + better-sqlite3 native binding)
2. A fresh `ENCRYPTION_KEY` generated
3. Dev server running on `http://localhost:3000`
4. `curl /display` showing the pre-seeded sparkline demo (AAPL, MSFT, NVDA, TSLA, BABA, 00700, 600519)
5. A one-click `Load demo data` action so a `Demo plan` provider shows realistic usage

## Invocation

The user types `/quickstart` (or invokes via the Skill tool with `name: "quickstart"`).
The skill does the rest. No questions asked, no choices to make — defaults are
chosen so the dashboard is immediately useful on `localhost:3000`.

If the user has `vercel` CLI installed and the env var `DEPLOY=vercel` is set
(or they pass `--vercel` to the prompt), the skill will instead:

1. Run the local bring-up steps
2. Run `vercel --prod` to deploy
3. Print the public URL of the deployed `/display` page

## Steps the skill executes

1. Check `node --version` (need ≥ 20) and `pnpm --version` (need ≥ 9)
2. `pnpm install` — pulls deps, prompts to approve `better-sqlite3` build
3. `pnpm rebuild better-sqlite3` — compiles the native binding
4. `cp .env.example .env` if missing
5. Generate `ENCRYPTION_KEY` via `openssl rand -hex 32` and write to `.env`
6. Run `npx next dev -p 3000` in the background
7. `curl -fsS http://localhost:3000/display > /dev/null` to confirm
8. `curl -fsS -X POST http://localhost:3000/api/demo` to load the demo provider
9. Print the URLs the user should open:
   - `http://localhost:3000/admin` — manage providers & stocks
   - `http://localhost:3000/display` — the e-ink view (this is what you bookmark on the Kindle)

## Optional args

- `--vercel` — deploy to Vercel after bring-up. Requires `vercel` CLI logged in.
- `--port=4000` — change the dev port.
- `--no-demo` — skip the auto `Load demo data` call.
- `--reset` — delete `data/monitor.db` before starting (clean slate).

## Compatibility

- Tested on macOS, Linux. On Windows use WSL.
- E-ink targets: any Kindle with experimental browser, any Xiaomi / 多看 e-reader.
- Mobile / desktop browsers: works fully (B&W only, by design).

## What the user does next

- **Try the demo** — open `/display`, see sparklines and a demo provider.
- **Add real data** — open `/admin/providers`, paste an OpenAI or Anthropic
  API key, save. The dashboard starts showing real data within one refresh window.
- **Add stocks** — `/admin/stocks`, add `AAPL` (US), `00700` (HK), `600519` (CN).
- **Set on Kindle** — open `/display` on the device, bookmark it, enable
  "Article Mode" in the experimental browser if available. The page
  auto-refreshes every 60s (configurable per-row and globally).
- **Deploy publicly** — `vercel --prod` with `ENCRYPTION_KEY` set. Note
  SQLite won't persist on Vercel serverless; use a Turso / libSQL adapter
  or accept the loss of provider configs (display + stocks will still
  resolve, just won't remember them across deploys).
