---
name: quickstart
description: One-sentence local bring-up of Ink Monitor. Installs deps, generates an encryption key, starts the dev server, and prints URLs to the admin and display pages. For public deploy, see the `deploy` skill.
---

# Ink Monitor — Quickstart (local)

End-to-end bring-up on `localhost`. The user sees a working `/display`
with pre-seeded sparklines in under 60 seconds.

## When to use

- User says "try it locally", "spin it up", "demo it on my machine"
- User wants to evaluate before deploying

For "put it on the internet" use the `deploy` skill instead.

## Steps the skill executes

1. `cd` into the project root
2. Verify `node --version` ≥ 20 and `pnpm --version` ≥ 9
3. `pnpm install` — pulls deps
4. `pnpm rebuild better-sqlite3` — compiles the native binding
5. `cp .env.example .env` if missing
6. Generate `ENCRYPTION_KEY` and `NEXTAUTH_SECRET` via `openssl rand -hex 32`
   and write to `.env`. Set `ENABLE_DEV_LOGIN=true` for password-less
   local sign-in
7. Start `npx next dev -p 3000` in the background
8. `curl -fsS http://localhost:3000/display` to confirm it's up
9. Sign-in with the dev provider (any email) and click "Load demo data"
   in `/admin` to seed a `Demo plan` provider + sample stocks

Print the URLs:
- `http://localhost:3000/` — marketing landing
- `http://localhost:3000/signin` — sign in (dev login accepts any email)
- `http://localhost:3000/admin` — manage providers / stocks / settings
- `http://localhost:3000/display` — the e-ink view (this is what to
  bookmark on the Kindle)

## Optional args

- `--port=4000` — change the dev port
- `--no-demo` — skip the auto "Load demo data" call
- `--reset` — delete `data/monitor.db` before starting (clean slate)

## Compatibility

- macOS, Linux: tested
- Windows: use WSL
- E-ink targets: any Kindle with experimental browser, Xiaomi / 多看,
  Boox, or any modern browser

## What the user does next

- Add real data — paste an OpenAI / Anthropic key in `/admin/providers`
- Add stocks — `/admin/stocks`, e.g. `AAPL` (US), `00700` (HK), `600519` (CN)
- Set on Kindle — open `/display` on the device, bookmark it, enable
  "Article Mode" in the experimental browser
- Generate a share link — `/admin` → "Share link for e-reader"
- Deploy publicly — run the `deploy` skill

