# Privacy Policy

_Ink Monitor_ is a self-hostable, e-ink-friendly dashboard. This policy
covers the **hosted** version of the product (when you sign in at our
domain). If you self-host, this policy does not apply to your
deployment — you are the data controller.

**Effective date**: 2026-06-07

## What we collect

### When you sign in with GitHub

| Field | Why | Storage |
|---|---|---|
| GitHub user id (`id` as string) | To scope your dashboard | Our database, `users.id` |
| GitHub login name | Display in the admin nav | Our database, `users.name` |
| Email (if granted by `user:email` scope) | Optional, for password-reset / important notices | Our database, `users.email` |
| Avatar URL | Display in the admin nav | Our database, `users.avatar_url` |

**We do not see, request, or store:**

- Your GitHub password
- Any of your private repositories
- Your private email address (only the public one if you grant it)
- Your SSH keys, GPG keys, OAuth tokens for other apps
- Any data outside of `read:user user:email` scope

### When you configure a provider

| Field | Why | Storage |
|---|---|---|
| API key (OpenAI / Anthropic / custom) | To call upstream APIs on your behalf | AES-256-GCM encrypted, key derived per-user via PBKDF2-SHA256 (100k iter) |
| Provider type and endpoint config | To know how to call the upstream | Plaintext in our database |
| Display name (your choice) | To label the card on `/display` | Plaintext |
| Refresh interval | To set the polling cadence | Plaintext (integer) |

**The API key never appears in our logs.** We use it once per refresh
window to make a single upstream call, then drop it from memory.

### When you add a stock to your watchlist

| Field | Why | Storage |
|---|---|---|
| Symbol + market | To know what to fetch | Plaintext |
| Display name | To label the row on `/display` | Plaintext |

Stock data is fetched from Tencent / Sina / Eastmoney / Yahoo. Those
services see your IP address and request pattern; we do not proxy any
identifying information to them.

### When you visit `/display`

`/display` is a public route. The only state we keep per request is in
the URL (`?share=…` or your session cookie) and in our server-side
`fetch_cache` table (TTL'd per the row's `refresh_seconds`).

### Cookies

- `__Secure-next-auth.session-token` (HTTPS) or `next-auth.session-token`
  (HTTP) — your session, signed JWT, HttpOnly, SameSite=Lax. Expires
  when the session ends.
- `NEXT_LOCALE` — your chosen UI language, plain string. Expires in
  one year.

We do **not** use third-party analytics, ad networks, or tracking
pixels.

## How we protect your data

- **Encryption at rest**: API keys are stored as
  `<iv-hex>:<tag-hex>:<ct-hex>` where the encryption key is derived from
  your user id via PBKDF2-SHA256 with 100,000 iterations. The master
  encryption key lives in our deployment's environment variables, never
  the database.
- **Encryption in transit**: All traffic to and from the hosted service
  uses HTTPS. The CLI uses bearer tokens.
- **No password storage**: We never have a password for your account.
  Authentication is delegated to GitHub.
- **No data sharing**: We do not sell, rent, or share your data with
  third parties. Period.

## How long we keep your data

| Data | Retention |
|---|---|
| User account | Until you delete it |
| Provider configs + encrypted API keys | Until you delete them |
| Stock watchlist | Until you delete it |
| `fetch_cache` (latest snapshot) | TTL = row's `refresh_seconds` (default 60s) |
| Server logs | 30 days, then deleted |
| Audit logs (admin actions) | 90 days, then deleted |

## Your rights (GDPR / CCPA / etc.)

You can, at any time:

- **Access** your data: GET `/api/me` returns your user record;
  `GET /api/providers` and `GET /api/stocks` return your config.
- **Export** your data: `npx ink-monitor export` (planned) returns a
  JSON dump of your user, providers, stocks, and settings.
- **Delete** your data: from `/admin → Account → Delete` (planned).
  This will delete your user row, all provider rows, all stock rows,
  all settings, all `fetch_cache` rows, and your share token, in a
  single transaction.
- **Revoke** your share link: `/admin → Share link → Revoke`.
- **Disconnect** GitHub: <https://github.com/settings/applications> →
  Ink Monitor → Revoke. We will treat your account as deleted on the
  next session refresh.

To exercise any of these, sign in and use the admin UI. If you can't
sign in (lost access to GitHub), email `privacy@ink-monitor.local` from
the email associated with your GitHub account.

## Children

Ink Monitor is not directed at children under 13 (or under 16 in the
EU/UK). We do not knowingly collect data from children. If you believe
a child has signed in, email `privacy@ink-monitor.local` and we will
delete the account.

## Changes to this policy

We will update this page and bump the "Effective date" at the top. For
material changes, we will email you (if you have a verified email
attached to your account) and post a 30-day notice in the GitHub
Discussions.

## Contact

`privacy@ink-monitor.local` — for data access, deletion, and any
privacy-related question.
