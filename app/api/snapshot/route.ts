import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, getUserIdFromShareToken } from '@/lib/session';
import { getDisplayData } from '@/lib/aggregator';

export const dynamic = 'force-dynamic';

/**
 * Auth-gated snapshot (F2/F12/F18). Only two paths resolve a user:
 *   1. A valid NextAuth session cookie.
 *   2. A valid `?share=<token>` credential (Kindle / e-ink scan flow).
 *
 * The previous implementation also accepted an unauthenticated `?u=<id>`
 * query param, which let anyone enumerate and read any user's dashboard.
 * That fallback has been removed: unauthenticated callers now get a 401.
 *
 * Note: there is intentionally no `x-ink-user` header path on the server
 * route either — that header was a client-side preview hint on the page,
 * and it has also been removed (see app/display/page.tsx).
 */
export async function GET(req: NextRequest) {
  let userId = await getCurrentUserId();
  if (!userId) {
    userId = await getUserIdFromShareToken(req.nextUrl.searchParams.get('share'));
  }
  if (!userId) {
    return NextResponse.json(
      { error: 'auth required' },
      { status: 401, headers: { 'Cache-Control': 'no-store, must-revalidate' } },
    );
  }
  const data = await getDisplayData(userId);
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store, must-revalidate' },
  });
}