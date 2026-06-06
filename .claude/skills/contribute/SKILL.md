---
name: contribute
description: Walk a first-time contributor through forking, coding, testing, and opening a PR for the Ink Monitor repo. Reduces the time-to-first-merged-PR from hours to minutes.
---

# Ink Monitor — First-time contributor

For someone who has never opened a PR against Ink Monitor. Assumes basic
git / GitHub knowledge but no familiarity with our conventions.

## When to invoke

A new contributor (or the user playing the role of one) says "I want to
contribute", "open a PR", "submit a fix", etc.

## Step 1 — Pick an issue

Look at https://github.com/YiJing233/ink-monitor/issues and filter by
labels `good first issue` or `help wanted`. The skill should:

- List the 3 most recent `good first issue`s with their titles
- For each, summarize in one sentence what the change is
- Ask the user which one they want to tackle

If they have something specific in mind that's not in the issue
tracker, help them open a new issue first (the `bug` or `feature`
template).

## Step 2 — Fork and clone

```bash
gh repo fork YiJing233/ink-monitor --clone
cd ink-monitor
```

If they don't have `gh` installed, fall back to:
1. Click "Fork" on https://github.com/YiJing233/ink-monitor
2. `git clone https://github.com/<their-username>/ink-monitor.git`
3. `git remote add upstream https://github.com/YiJing233/ink-monitor.git`

Verify the setup:
```bash
git remote -v
# should show:
#   origin    https://github.com/<their-username>/ink-monitor.git
#   upstream  https://github.com/YiJing233/ink-monitor.git
```

## Step 3 — Local setup

```bash
pnpm install
pnpm rebuild better-sqlite3
cp .env.example .env
# Edit .env to set:
#   ENCRYPTION_KEY=$(openssl rand -hex 32)
#   NEXTAUTH_SECRET=$(openssl rand -hex 32)
#   ENABLE_DEV_LOGIN=true   (for local testing)
pnpm dev
```

Open http://localhost:3000, click "Sign in", use the dev provider
(any email works), click "Load demo data" to seed.

Verify it works by visiting http://localhost:3000/display.

## Step 4 — Branch

```bash
git checkout -b fix/<short-description>
# e.g.
git checkout -b fix/anthropic-rate-limit-warning
```

## Step 5 — Make the change

The skill should:
1. Show the file(s) most likely to need editing for the issue type
2. Walk through the change one file at a time
3. **For `/display` changes** — run the e-ink checklist verbally:
   - No new CSS Grid, `:has()`, `backdrop-filter`, transitions
   - No new client-side dependency
   - All numerics use thousand separators
4. **For `/api/*` or `lib/crypto.ts` changes** — security checklist:
   - User-scoped queries still pass `userId`
   - No new field logged at info+
   - Backwards-compatible encryption (existing ciphertexts decrypt)
5. **For `lib/db.ts` schema changes** — write the migration as
   idempotent `ALTER TABLE` so existing DBs migrate cleanly

## Step 6 — Test

```bash
pnpm test
pnpm build
```

Both must pass. If they don't, fix and re-run.

For new functionality, add a test in the same `lib/__tests__/` style as
existing tests. Use the existing test for `crypto.ts` or `utils.ts` as
a template.

## Step 7 — Commit

```bash
git add <changed files>
git commit -m "<type>: <description>

<body explaining the why, not the what>"
```

`<type>` is one of: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

Example:
```
fix: surface rate-limit warning for Anthropic

Anthropic's hard floor is 60s; below that we waste input tokens
on probe calls. This change adds a danger badge in /admin when
refresh_seconds < 60 for any Anthropic provider.
```

## Step 8 — Push and open a PR

```bash
git push -u origin fix/<short-description>
gh pr create --title "..." --body "..."
```

If `gh` isn't authenticated, fall back to:
1. `git push -u origin fix/<short-description>`
2. Open https://github.com/YiJing233/ink-monitor/compare/main...<branch>
3. Click "Create pull request"

The PR body should reference the issue it closes:
```
Closes #42

## What
<one sentence>

## Why
<one sentence>

## How to test
1. <step>
2. <step>

## Checklist
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] e-ink checklist (if /display changed)
- [ ] security checklist (if /api or lib/crypto changed)
- [ ] CHANGELOG.md updated under [Unreleased]
```

## Step 9 — Wait for review

Maintainers review within 7 days. Address feedback by pushing new
commits to the same branch — do NOT force-push after the review has
started.

## Step 10 — Celebrate

Once merged, the maintainer will:
- Tag you in the release notes
- Add you to `CONTRIBUTORS.md` (if you want)
- Send a thank-you in the next release post

Take a break. You earned it.

## Common pitfalls for first-timers

- Forgot to `git pull` from upstream before branching — leads to
  merge conflicts on the PR. Run `git pull upstream main` first.
- Committed `.env` or `data/monitor.db` — both are gitignored, but
  double-check with `git status` before pushing.
- Pushed to `main` instead of a feature branch — easy fix: revert
  the commit on main, then re-apply on a new branch.
- PR is too big (>500 lines) — split into smaller PRs that can be
  reviewed independently.

## Help

Stuck? Open a Discussion at
https://github.com/YiJing233/ink-monitor/discussions or mention
@maintainer in your PR.
