# Deploy to Vercel

One-click deploy of the Ink Monitor SaaS to your own Vercel account.

## Option 1: Vercel deploy button

Add this to your README to let users deploy with a single click:

```markdown
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2F<your-org>%2F<your-repo>%2Ftree%2Fmain&env=GITHUB_ID,GITHUB_SECRET,ENCRYPTION_KEY,NEXTAUTH_SECRET&envDescription=Required%20env%20vars&envLink=https%3A%2F%2Fgithub.com%2F<your-org>%2F<your-repo>%2Fblob%2Fmain%2FDEPLOY.md)
```

The button clones the repo and prompts for these env vars:

| Var | Required | Description |
|---|---|---|
| `GITHUB_ID` | yes | OAuth app client id from github.com/settings/developers |
| `GITHUB_SECRET` | yes | OAuth app client secret |
| `ENCRYPTION_KEY` | yes | 64-hex chars: `openssl rand -hex 32` |
| `NEXTAUTH_SECRET` | yes | Any random string ≥ 32 chars |
| `ENABLE_DEV_LOGIN` | no | `true` to allow no-OAuth dev login (NEVER in prod) |
| `DEFAULT_REFRESH_SECONDS` | no | Default 60 |
| `STOCK_CACHE_TTL` | no | Default 60 |

## Option 2: Manual `vercel --prod`

```bash
# install vercel CLI
npm i -g vercel

# login
vercel login

# link or create
vercel link

# set env vars
vercel env add GITHUB_ID
vercel env add GITHUB_SECRET
vercel env add ENCRYPTION_KEY
vercel env add NEXTAUTH_SECRET

# deploy
vercel --prod
```

## Vercel-specific notes

### SQLite on serverless

`better-sqlite3` requires a persistent filesystem. Vercel serverless functions
have a **read-only filesystem** outside of `/tmp`, and `/tmp` is per-invocation
and not shared across functions.

For a production SaaS deploy, switch the DB layer to a hosted option. The
easiest is **Turso** (libSQL) — a managed fork of SQLite with a generous free
tier. The change is in `lib/db.ts`:

```bash
pnpm add @libsql/client
# replace better-sqlite3 import with @libsql/client
# set DATABASE_URL=libsql://your-db.turso.io
# set DATABASE_TOKEN=...
```

The data shape is unchanged, so all the rest of the code works as-is.

### GitHub OAuth callback URL

When you set up the OAuth app on github.com, the callback URL must be:

```
https://<your-vercel-domain>/api/auth/callback/github
```

### Cookies and HTTPS

NextAuth requires `NEXTAUTH_URL=https://<your-vercel-domain>` in env for
production cookies. Vercel sets this automatically for `next start`, but if
you have any cookie issues, set it explicitly.

## Local production smoke test

```bash
# build
pnpm build

# run prod server locally
ENCRYPTION_KEY=$(openssl rand -hex 32) \
  NEXTAUTH_SECRET=$(openssl rand -hex 32) \
  GITHUB_ID=<your-id> GITHUB_SECRET=<your-secret> \
  pnpm start
```

Open http://localhost:3000 and click "Sign in with GitHub".
