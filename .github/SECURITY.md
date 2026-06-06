# Security policy

## Supported versions

| Version | Supported |
|---|---|
| `main` branch | ✅ |
| Tagged releases ≤ 0.1.x | ✅ (best-effort) |
| Older | ❌ |

## Threat model — what we protect against

Ink Monitor stores **API keys** (OpenAI, Anthropic, custom endpoints) on
behalf of authenticated users. The keys are sensitive — anyone with a key
can incur real cost on the user's account. We treat the storage layer as
the highest-asset surface.

1. **Database exfiltration**: An attacker copies `data/monitor.db`. They
   have encrypted API key blobs, but no plaintext. Without the master
   `ENCRYPTION_KEY` (held in your deployment's environment, never in the
   database), the keys are unrecoverable. PBKDF2 with 100k iterations and
   per-user salts raises brute-force cost further.

2. **Master-key leak**: If `ENCRYPTION_KEY` is exposed (e.g. via a leaked
   `.env`), the per-user layer no longer protects. **Rotate immediately**:
   the rotation procedure is `npx ink-monitor admin reencrypt --new-key`
   (planned — for now, prompt each user to re-add their keys after the
   rotation, then delete the old encrypted rows).

3. **Share-token leak**: A leaked `?share=…` URL exposes the dashboard
   (usage numbers, stock watchlist) to anyone who has it. It does **not**
   expose API keys. Revoke from `/admin → Share link → Revoke` to
   invalidate immediately.

4. **OAuth account compromise**: An attacker who steals a user's GitHub
   session can read the user's dashboard and use the share token. They
   cannot extract the underlying API keys (encrypted at rest, decrypted
   only server-side per-request). The user should revoke GitHub access at
   <https://github.com/settings/applications>.

5. **XSS via provider data**: Provider responses are parsed and rendered
   to HTML. The display page escapes all dynamic values through React's
   default escaping. If you add a `dangerouslySetInnerHTML` path,
   **don't** — or if you must, sanitize first.

## Reporting a vulnerability

**Please do not file a public issue.** Email `security@ink-monitor.local`
with:

- A clear description of the vulnerability
- Reproduction steps (proof of concept preferred)
- The impact you believe it has
- Any workarounds you've found

We aim to acknowledge within **48 hours** and ship a fix or mitigation
within **7 days** for critical issues, **30 days** for the rest.

After a fix ships we will publish a GitHub Security Advisory and credit
you (unless you prefer to remain anonymous).

## What we will NOT do

- We will not threaten or take legal action against you for good-faith
  research that follows this policy.
- We will not ask you to keep the vulnerability secret beyond what is
  needed to ship a fix (typically 7–30 days coordinated disclosure).

## Hardening checklist for self-hosters

Before exposing `/display` to the public internet:

- [ ] HTTPS via Caddy / nginx / Cloudflare (NextAuth requires `NEXTAUTH_URL=https://…`)
- [ ] `ENCRYPTION_KEY` rotated on each deploy (don't reuse an old one)
- [ ] `data/` directory not in a public asset path
- [ ] Reverse proxy rate-limit on `/api/auth/*` (5 req / min / IP)
- [ ] Backup `data/monitor.db` off-box daily (see `scripts/backup.sh`)
- [ ] Logs go to a separate service — never log encrypted ciphertext
- [ ] If self-hosting with no managed OAuth, set `ENABLE_DEV_LOGIN=false` always

## Cryptography details

- Master key: `ENCRYPTION_KEY`, expected 64-hex (32 bytes). Anything else
  is padded / warned at boot.
- Per-user key: `PBKDF2-SHA256(master_key, user_id, 100_000 iter, 32 bytes)`
- Cipher: AES-256-GCM with random 12-byte IV per record
- Tag: 16 bytes (default)
- Output format: `<iv-hex>:<tag-hex>:<ct-hex>` (all hex, no base64)
- The PBKDF2 cost is deliberately tuned to take ~50ms on a 2020-era server
  CPU per derivation, which is then cached per-process
