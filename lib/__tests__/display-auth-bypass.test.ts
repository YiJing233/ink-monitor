import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Static-assertion tests for the F2/F12/F18 auth-bypass fixes on
// /display and /api/snapshot.
//
// The two routes depend on `next/headers`, `getServerSession`, and the
// Next.js request context, which are non-trivial to spin up in vitest.
// Instead of a full integration test, this suite greps the source
// files for the patterns that used to let anyone view any user's
// dashboard. If any of these patterns re-appear, the test fails.

const DISPLAY_PAGE = readFileSync(
  resolve(__dirname, '../../app/display/page.tsx'),
  'utf8',
);
const SNAPSHOT_ROUTE = readFileSync(
  resolve(__dirname, '../../app/api/snapshot/route.ts'),
  'utf8',
);

describe('F2/F12/F18 — /display no longer honors ?u= or x-ink-user', () => {
  it('does not read the `?u=` query param as an auth fallback', () => {
    // The old code did: `if (!userId) userId = params.u || null;`
    // We allow the literal token `?u=` to appear in comments / the type
    // signature, but we must not see it being assigned to `userId`.
    expect(DISPLAY_PAGE).not.toMatch(/userId\s*=\s*params\.u/);
    // Also: the canonical-self-link must not emit `?u=` anymore — once
    // we've removed the auth bypass, any emitted `?u=` link would be
    // dead-on-arrival for unauthenticated visitors.
    expect(DISPLAY_PAGE).not.toMatch(/`\?u=\$\{encodeURIComponent\(userId\)\}`/);
  });

  it('does not read the `x-ink-user` header as an auth fallback', () => {
    // The old code did: `h.get('x-ink-user')`. Match the call site, not the
    // bare token (which may legitimately appear in explanatory comments).
    expect(DISPLAY_PAGE).not.toMatch(/\.get\(\s*['"]x-ink-user['"]\s*\)/);
    // And it shouldn't be importing `next/headers` just for that — the
    // header fallback was the only consumer.
    expect(DISPLAY_PAGE).not.toMatch(/from\s+['"]next\/headers['"]/);
  });

  it('still accepts session and ?share=<token> as the two legitimate auth paths', () => {
    expect(DISPLAY_PAGE).toMatch(/getCurrentUserId/);
    expect(DISPLAY_PAGE).toMatch(/getUserIdFromShareToken/);
    expect(DISPLAY_PAGE).toMatch(/params\.share/);
  });

  it('renders an auth-required message when neither session nor share resolves a user', () => {
    expect(DISPLAY_PAGE).toMatch(/Sign in or open a share link/);
  });
});

describe('F2/F12/F18 — /api/snapshot no longer honors ?u= as auth', () => {
  it('does not read the `u` query param as an auth fallback', () => {
    // Old: `userId = req.nextUrl.searchParams.get('u') || null;`
    expect(SNAPSHOT_ROUTE).not.toMatch(/searchParams\.get\(\s*['"]u['"]\s*\)/);
  });

  it('returns 401 JSON `{ error: "auth required" }` when neither session nor share resolves a user', () => {
    expect(SNAPSHOT_ROUTE).toMatch(/status:\s*401/);
    expect(SNAPSHOT_ROUTE).toMatch(/error:\s*['"]auth required['"]/);
  });

  it('still accepts session and ?share=<token>', () => {
    expect(SNAPSHOT_ROUTE).toMatch(/getCurrentUserId/);
    expect(SNAPSHOT_ROUTE).toMatch(/getUserIdFromShareToken/);
    expect(SNAPSHOT_ROUTE).toMatch(/searchParams\.get\(\s*['"]share['"]\s*\)/);
  });
});