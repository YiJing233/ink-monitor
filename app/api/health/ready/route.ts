import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Readiness probe — for Kubernetes / load balancers.
 * Returns 200 if and only if the app can serve traffic.
 */
export async function GET() {
  try {
    getDb().prepare('SELECT 1').get();
    return new NextResponse('ok', {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return new NextResponse('not ready', { status: 503 });
  }
}
