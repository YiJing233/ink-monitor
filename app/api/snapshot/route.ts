import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, getUserIdFromShareToken } from '@/lib/session';
import { getDisplayData } from '@/lib/aggregator';

export const dynamic = 'force-dynamic';

/**
 * Public snapshot — used by the unauthenticated /display page.
 * Reads the session cookie if present, otherwise expects a `u` query param
 * (legacy) or a `share` token. Without any of those, returns an empty
 * snapshot (so the landing page can be rendered publicly).
 */
export async function GET(req: NextRequest) {
  let userId = await getCurrentUserId();
  if (!userId) {
    userId = await getUserIdFromShareToken(req.nextUrl.searchParams.get('share'));
  }
  if (!userId) {
    userId = req.nextUrl.searchParams.get('u') || null;
  }
  if (!userId) {
    return NextResponse.json(
      {
        generatedAt: Date.now(),
        pageTitle: 'Monitor',
        refreshSeconds: 60,
        defaultRefreshSeconds: 60,
        providers: [],
        stocks: [],
      },
      { headers: { 'Cache-Control': 'no-store, must-revalidate' } },
    );
  }
  const data = await getDisplayData(userId);
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store, must-revalidate' },
  });
}
