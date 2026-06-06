# Pricing — decision guide

Ink Monitor is currently free to self-host. This document is the
**decision template** for when you turn on a hosted paid plan.

## Suggested tiers (starting point)

| Tier | Price | Limits | Best for |
|---|---|---|---|
| **Free** | $0 | 2 providers, 5 stocks, 1 share link, 1h refresh min | Trying it out |
| **Pro** | $5/mo | 20 providers, 50 stocks, 5 share links, 15s refresh min | Power users with multiple AI subs |
| **Team** | $20/mo | 100 providers, 500 stocks, 30 share links, org-scoped | Small teams sharing a dashboard on a wall-mounted Kindle |
| **Self-host** | Free | Unlimited | Anyone who wants full control |

Numbers are placeholders. The right answer depends on:

- What your unit cost is (compute + storage per user per month)
- What you think the value is to a "I have 6 AI subscriptions" power user
- Whether you want to compete on free (more users, more word-of-mouth) or
  on paid (higher ARPU, less support burden)

## What costs you money per user

- **Compute**: Next.js on Vercel. Free tier: 100GB-hr/mo. Each user uses
  ~1-3 GB-hr/mo on this app. At our scale, this stays free until ~30
  active users. Beyond that, Pro plan starts covering it.
- **Storage**: SQLite-on-Vercel via Turso: 9 GB free, then $0.40/GB-mo.
  Each user is ~1-10 KB.
- **API calls to upstream providers**: NOT your cost. We only call
  `/v1/usage` (aggregated) and rate-limit headers, both cheap.
- **GitHub OAuth**: free.
- **Email** (transactional, password-reset): Postmark $0.40/1k emails.

## What to charge for

Charge for **convenience** not for **usage**:
- Hosted vs self-host: $5/mo for "I don't want to set this up"
- Multiple share links: $5/mo for "I have 3 Kindles around the house"
- Sub-minute refresh: $5/mo for "I want to see it move"
- Team accounts: $20/mo for "all 4 of us want our own dashboard"

Don't charge for more providers/stocks — they cost you nothing.

## Discount / annual

- 20% off annual = 2 months free
- 50% off for students (GitHub Student Developer Pack)
- Free for verified open-source maintainers (link to GitHub Sponsors)

## Don't do

- Don't charge per API call to upstream. Users will hate you. Your
  cost per user is roughly fixed regardless of how many providers they
  track.
- Don't gate by data volume. Tokens and ticks are tiny.
- Don't auto-upgrade. The cancellation flow has to be one click.

## How to actually charge (when ready)

See [`BILLING.md`](./BILLING.md) for the Stripe integration plan. Until
then, the app is free and you accept that.
