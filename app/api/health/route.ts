import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STARTED_AT = Date.now();

/**
 * Health check for uptime monitors and CI deploy verification.
 *
 *   GET /api/health       → 200 with { status, db, uptime, version }
 *   GET /api/health/ready → 200 only if DB is reachable
 */
export async function GET() {
  const dbStatus = checkDb();
  const body = {
    status: dbStatus.ok ? 'ok' : 'degraded',
    db: dbStatus,
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    version: process.env.npm_package_version || '0.0.0',
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    status: dbStatus.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, must-revalidate' },
  });
}

function checkDb(): { ok: boolean; latencyMs: number; error?: string } {
  const t0 = Date.now();
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    if (!row || row.ok !== 1) {
      return { ok: false, latencyMs: Date.now() - t0, error: 'unexpected query result' };
    }
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - t0, error: e?.message || String(e) };
  }
}
