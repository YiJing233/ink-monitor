---
name: deploy
description: One-shot deploy of Ink Monitor to Vercel with environment variables, OAuth app, and DNS. Walks the user through every step from `vercel login` to a live https URL.
---

# Ink Monitor — Deploy

Takes a fresh checkout of the Ink Monitor repo from "I have the code" to
"there's a live https://ink-monitor-… URL with sign-in working." Targets
Vercel as the primary target; self-host is covered by the `quickstart`
skill.

## When to invoke

The user says "deploy this", "put it online", "give me a public URL",
or runs the skill with no args.

## Pre-flight

Before deploying, verify:

- [ ] `pnpm install` and `pnpm build` complete cleanly
- [ ] `.env.example` is read by the user
- [ ] User has a GitHub account
- [ ] User has or is willing to create a Vercel account

If `git status` is dirty, commit first. If `main` is behind the remote
default branch, push first.

## Steps the skill executes

### 1. Account setup (only if `vercel login` fails)

Tell the user to run `npx vercel login` in a terminal. They will get a
browser prompt. This skill can NOT complete the OAuth flow — it must be
done by the human in their own terminal.

Once they confirm, continue.

### 2. Link the project

```bash
cd /path/to/ink-monitor
npx vercel link
```

This creates `.vercel/project.json` and links the local repo to a Vercel
project. If the user wants to deploy to a new project, choose "Create
new".

### 3. Set environment variables

Vercel CLI doesn't have a non-interactive way to set env vars. Walk the
user through:

```bash
npx vercel env add ENCRYPTION_KEY
# paste the value (64 hex chars = `openssl rand -hex 32`)

npx vercel env add NEXTAUTH_SECRET
# `openssl rand -hex 32`

npx vercel env add GITHUB_ID
# create one at https://github.com/settings/developers
# callback: https://<production-domain>/api/auth/callback/github

npx vercel env add GITHUB_SECRET
# paste from the OAuth app page

# Optional
npx vercel env add SENTRY_DSN
npx vercel env add ENABLE_DEV_LOGIN   # value: "true" (NEVER in prod)
```

Production env vars are scoped to the Production environment. For preview
deploys, you may want to also set them in "Preview" so /preview URLs
work.

### 4. GitHub OAuth app

If the user doesn't have a GitHub OAuth app:

1. Open https://github.com/settings/developers → "New OAuth App"
2. Application name: `Ink Monitor (your name)`
3. Homepage URL: the Vercel domain from the next step
4. Authorization callback URL: `https://<that-domain>/api/auth/callback/github`
5. Generate client secret
6. Copy the client id and secret into the env vars above

### 5. First deploy

```bash
npx vercel --prod
```

This pushes to production. Returns a URL like
`https://ink-monitor-<hash>.vercel.app`. Note the URL.

### 6. Smoke test

```bash
curl -fsS https://<url>/api/health
# expect: { "status": "ok", "db": { "ok": true, ... } }

curl -fsS https://<url>/display
# expect: 200 + e-ink HTML with <meta http-equiv="refresh">

curl -fsS https://<url>/signin
# expect: 200 + GitHub OAuth button
```

### 7. Hand off to user

Print:
- The public URL
- The admin URL (`/admin`) and that they should sign in with GitHub
- The display URL (`/display?share=...`) after creating a share link
- The status page URL (if they set one up — see STATUS_PAGE.md)

## Common issues

- **"Invalid OAuth state"** on sign-in: the callback URL in the GitHub
  OAuth app doesn't match the production URL. Update the OAuth app.
- **"Encryption key not set"** warning: the ENCRYPTION_KEY env var is
  empty. Run `vercel env ls` to confirm it was set in the Production
  environment.
- **Better-sqlite3 native binding fails on Vercel**: Vercel serverless
  functions have a read-only filesystem. Switch to Turso / libSQL per
  DEPLOY.md. SQLite is fine for local and self-host; Vercel is the
  only path that breaks.
- **500 on /display with no rows**: the new user hasn't clicked
  "Load demo data" yet. Sign in → /admin → click the button.

## Optional: custom domain

```bash
npx vercel domains add ink-monitor.example.com
# Follow the prompt to set the DNS A / CNAME record
```

Once the domain is verified, update the GitHub OAuth app's homepage and
callback URL to the new domain, then re-set the env vars
(`npx vercel env rm GITHUB_ID && npx vercel env add GITHUB_ID`).

## Cost

Vercel's Hobby tier (free):
- 100 GB-hr serverless compute / month
- 100 GB outbound bandwidth / month
- 1 GB edge storage

Ink Monitor uses ~1 GB-hr per user per month. Free until ~100 active
users. Beyond that, Pro plan ($20/mo) extends to 1 TB-hr.
