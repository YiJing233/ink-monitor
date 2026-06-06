# Contributing

Thanks for your interest in Ink Monitor! This is a small, opinionated
project — contributions that match the existing style and the e-ink
constraints are very welcome.

## Ground rules

1. **E-ink first.** Anything that ends up on `/display` must work on a
   2014-era WebKit browser (Kindle experimental). Server-render, no client
   JS, no CSS Grid, no `:has()`, no Web Fonts, no transitions/animations.
   If you're adding a new feature, ask: "would this still look right on a
   Kindle?"
2. **No new client-side dependencies.** The whole project relies on
   `next`, `react`, `next-auth`, `better-sqlite3`, and `zod`. If you need
   more, justify it.
3. **B&W only.** No color tokens, no grey gradients, no shadows. The
   `globals.css` palette is exhaustive — if a color isn't there, it
   shouldn't exist.
4. **Keep tests fast.** The lib/ helpers (crypto, ttl, providers, stocks)
   should be unit-testable. Add a test alongside the change.

## Development setup

```bash
pnpm install
pnpm rebuild better-sqlite3
ENCRYPTION_KEY=$(openssl rand -hex 32) \
  NEXTAUTH_SECRET=$(openssl rand -hex 32) \
  ENABLE_DEV_LOGIN=true \
  pnpm dev
```

The dev provider accepts any email, so you can sign in with
`demo@local` to seed a user and try the dashboard.

## Running tests

```bash
pnpm test
```

Tests live next to the source under `lib/**/__tests__/` and use Vitest.

## Code style

- TypeScript strict mode. No `any` in shared types.
- Server-only code is marked with `import 'server-only'` and lives in
  `lib/` under a path that doesn't get bundled into the client.
- Components in `app/` are server-rendered by default; opt into `'use
  client'` only when interactivity is required.
- Use `cn(...)` from `lib/utils.ts` for className composition.

## Filing issues

Please include:

- The e-ink device + browser version, if it's a display-side bug.
- The provider / market, if it's a data-source bug.
- A snapshot of `/api/snapshot` if it's a parsing / display issue.

## Security

If you find a security issue (key leak path, XSS, auth bypass), please
**do not** open a public issue. Email the maintainer instead.
