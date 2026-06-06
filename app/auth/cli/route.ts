import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';

/**
 * CLI auth entrypoint. The CLI starts a localhost listener, hits this URL
 * with `?redirect=http://localhost:NNN/callback`, and the user completes
 * GitHub OAuth. We mint a short-lived token, redirect the user back, and
 * the CLI picks it up.
 *
 * For now: this page simply forwards the user to the GitHub OAuth start URL
 * with `prompt=select_account`. The token minting happens in the OAuth
 * callback (see lib/auth.ts).
 */
export async function GET(req: NextRequest) {
  const redirect = req.nextUrl.searchParams.get('redirect') || '/';
  // Generate a state token (carries the redirect) and stash it in a cookie
  const state = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(
    new URL(`/api/auth/signin/github?callbackUrl=${encodeURIComponent(redirect)}`, req.url),
  );
  res.cookies.set('cli-state', state, { path: '/', httpOnly: true, maxAge: 600 });
  res.cookies.set('cli-redirect', redirect, { path: '/', httpOnly: true, maxAge: 600 });
  return res;
}
