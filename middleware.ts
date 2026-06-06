import { withAuth } from 'next-auth/middleware';

/**
 * Gate /admin and /api (except /api/auth, /api/health, /api/snapshot for the
 * unauthenticated display page). E-ink display page /display stays public
 * so users can bookmark it without a session cookie — we resolve the user
 * by the session cookie when present, else by a "shared link" token in
 * the query string.
 */
export default withAuth({
  pages: { signIn: '/signin' },
});

export const config = {
  matcher: [
    '/admin/:path*',
    // /api/providers, /api/stocks, /api/settings, /api/demo, /api/snapshot-me
    // but NOT /api/auth, /api/snapshot (public), /api/health, /api/deploy
    '/api/providers/:path*',
    '/api/stocks/:path*',
    '/api/settings/:path*',
    '/api/demo',
  ],
};
