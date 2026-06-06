# Terms of Service

_Ink Monitor_ ("the Service") is a dashboard for monitoring AI token-plan
usage and stock watchlists. By creating an account or using the Service,
you agree to these terms.

**Effective date**: 2026-06-07

## 1. The Service

The Service is provided as-is. We try to make it reliable, but we do not
guarantee uptime, data accuracy, or that any specific feature will
continue to be available.

**The display data shown to you is a snapshot in time.** A usage number
of "412,000 tokens" represents what we saw at the last refresh, not a
guarantee of what your provider's billing system will record.

**Stock quotes are not financial advice.** The Service shows public
market data with a delay of up to 15 minutes (per Tencent / Sina /
Yahoo). Do not trade based on what you see here.

## 2. Your account

You sign in with GitHub. You are responsible for everything that
happens under your account, including:

- Keeping your GitHub account secure
- The accuracy of the API keys you provide
- The actions of anyone you share a `/display?share=…` link with
- Any costs your AI providers charge you based on usage

You must be at least 13 (16 in EU/UK) to use the Service.

## 3. API keys you provide

When you add an OpenAI, Anthropic, or other provider, you give us
permission to call that provider's API on your behalf, with the rate
limits and timing you configure.

- We call the upstream API only with the scope needed to read usage
  data.
- We never make write calls (no completions, no model creation, no
  billing actions).
- We will not share your API key with anyone, ever. If a court orders
  us to disclose, we will challenge the order to the extent permitted
  by law; if disclosure is unavoidable, we will notify you first.

## 4. Acceptable use

You agree not to:

- Reverse-engineer the Service to extract our private keys or other
  users' data
- Use the Service to harass, defame, or harm any person
- Use the Service to violate any applicable law
- Send automated traffic (bots, scrapers) to the Service at a rate
  that exceeds the documented `/api/health` and `/api/snapshot`
  refresh intervals for one user
- Circumvent the per-user rate limits by creating multiple accounts
  (each user gets one; if you need a team plan, contact us)

## 5. Termination

**By you**: at any time, from `/admin → Account → Delete`, or by
revoking GitHub access at <https://github.com/settings/applications>.
We will delete your data within 7 days.

**By us**: if you materially breach these terms, we will give you
14 days' notice (to the email on file) and a chance to cure, except in
cases of:

- Imminent harm to other users
- A legal order requiring immediate action
- Payment fraud (when paid plans exist)

## 6. Paid plans (future)

Today the Service is free. When we introduce paid plans:

- Prices will be listed on <https://ink-monitor.example.com/pricing>
  and on Stripe.
- Cancellation takes effect at the end of the current billing period;
  we do not pro-rate refunds unless required by law.
- If we raise prices on an existing plan, we will give 30 days' notice
  and you can keep your existing plan until you choose to switch or
  cancel.

## 7. Disclaimers

To the maximum extent permitted by law:

- The Service is provided "as is" and "as available".
- We disclaim all warranties of merchantability, fitness for a
  particular purpose, and non-infringement.
- We are not liable for any indirect, incidental, special, or
  consequential damages.

Nothing in these terms excludes liability that cannot be excluded
under applicable law (e.g. personal injury caused by negligence, fraud).

## 8. Changes

We will update these terms by bumping the "Effective date" at the top
and posting a 30-day notice in GitHub Discussions for material changes.
Continued use after the effective date constitutes acceptance.

## 9. Governing law

These terms are governed by the laws of the State of Delaware, USA,
without regard to its conflict-of-laws rules. Any dispute will be
resolved in the state or federal courts located in Delaware.

## 10. Contact

`legal@ink-monitor.local` — for questions, complaints, or notices under
these terms.
