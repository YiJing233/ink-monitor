# Billing — Stripe integration plan

This document is the **architecture plan** for adding paid plans. The
code is intentionally not yet present; the goal is to make the eventual
implementation mechanical.

## When to add billing

Don't add billing until you have **at least 100 active self-hosted
users** OR **at least 5 users asking for a hosted option**. Premature
billing costs more in lost trust than it earns in revenue.

## Architecture

```
┌────────────────┐
│   User signs   │
│   in (GitHub)  │
└────────┬───────┘
         │
         ▼
┌────────────────┐      ┌────────────────┐
│  /admin/billing│─────▶│ Stripe Customer│
│  Shows:       │      │ created on     │
│  - Plan       │      │ first interaction
│  - Card       │      └────────┬───────┘
│  - Invoices   │               │
└────────┬───────┘               ▼
         │              ┌────────────────┐
         │              │  Stripe        │
         ▼              │  Subscription  │
┌────────────────┐       │  (Pro/Team)    │
│  Webhook      │◀──────│  state lives   │
│  /api/stripe/  │       │  in Stripe     │
│  webhook       │       └────────────────┘
└────────────────┘
```

Stripe is the source of truth for plan state. Our DB stores
`stripe_customer_id` and `stripe_subscription_id` per user.

## What we need

### New table: `subscriptions`

```sql
CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL,                    -- 'free' | 'pro' | 'team'
  status TEXT NOT NULL,                  -- 'active' | 'canceled' | 'past_due' | ...
  current_period_end INTEGER,
  cancel_at_period_end INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### New env vars

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_TEAM=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

### New routes

- `GET  /api/billing` — current plan, customer portal link
- `POST /api/billing/checkout` — creates a Stripe Checkout session
- `POST /api/billing/portal` — creates a Stripe Customer Portal session
- `POST /api/stripe/webhook` — handles `customer.subscription.*` events
- `GET  /admin/billing` — UI for plan / card / invoices

### Limit enforcement

Currently nothing on the app is gated by plan. The minimum to add:

- **Free**: 2 providers, 5 stocks, 1 share link, minimum 1h refresh
- **Pro**: 20 providers, 50 stocks, 5 share links, minimum 15s refresh
- **Team**: 100 providers, 500 stocks, 30 share links

Wrap the existing POST endpoints:
```ts
if (countProviders(userId) >= LIMIT_FOR_PLAN(plan)) {
  return NextResponse.json({ error: 'plan limit reached' }, { status: 402 });
}
```

### What NOT to do

- Don't store credit cards (Stripe handles this)
- Don't roll your own subscription state machine
- Don't tier by data volume (it's tiny)
- Don't make users cancel via email (always one-click)

## Stripe setup (1 hour)

1. Create a Stripe account at https://dashboard.stripe.com
2. Activate your business (or use Atlas for incorporation)
3. Create 2 products with recurring prices: Pro ($5/mo) and Team ($20/mo)
4. Add the env vars to your deployment
5. Deploy the new routes
6. Test with Stripe test mode keys first
7. Use [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward
   webhooks locally
8. Switch to live keys

## Customer portal

Don't build a custom "manage subscription" UI. Use Stripe's
[Customer Portal](https://stripe.com/docs/billing/subscriptions/customer-portal):

- Pre-built for cancel, update card, view invoices
- PCI-compliant by default (Stripe hosts it)
- One redirect: `POST /api/billing/portal` returns a one-time URL

## Webhook events to handle

```js
const events = {
  'customer.subscription.created':  updateSubscription,
  'customer.subscription.updated':  updateSubscription,
  'customer.subscription.deleted':  downgradeToFree,
  'invoice.paid':                   logPaid,
  'invoice.payment_failed':         markPastDue,
};
```

Verify the signature with `STRIPE_WEBHOOK_SECRET` in middleware. Return
2xx within 5s or Stripe will retry.

## Tax

If you charge > $0 to users in the EU / UK, you need VAT / GST
compliance. Use **Stripe Tax** ($0.50 per transaction) to automate
calculation + remittance. Without it, you're on the hook for filing
in every jurisdiction you have a paying customer in.

For US sales tax: similar story, use Stripe Tax.

## Refund policy

- 30-day money-back, no questions asked, for Pro and Team
- Self-cancel anytime; access continues to the end of the paid period
- Don't auto-renew with a sneaky "renew at higher price" — see PRICING.md

## What to do when plan changes mid-period

If a user downgrades from Pro to Free and they have 50 stocks (over
the Free limit of 5), do **not** delete their data. Mark their account
as `over_limit_until: <30 days from now>` and let them keep the data
for 30 days. Email them on day 25: "your data will be hidden on
display but kept in your account for another 5 days, then archived".

The actual enforcement: when over_limit, only show the first N rows
on /display. The data is still in the DB, just hidden.

## Migration path (if pricing changes)

If you change plans on existing users, you owe them notice. The
Stripe subscription has `proration_behavior: 'create_prorations'` by
default which charges the prorated difference. For a downgrade, the
credit carries over to the next invoice.

Always email users 30 days before a price change. Always let them
keep their existing price for at least 6 months. See `TERMS.md` for
the language to use.

## Time estimate

To get billing live end-to-end (test mode to live mode):
- 2 days engineering
- 1 day testing + Stripe CLI
- 1 day docs / support macros / email templates
- 1 day edge cases (refunds, dunning, failed payments)

So ~1 week of focused work, after you have customers asking for it.
