import { NextRequest, NextResponse } from 'next/server';
import { listAudit, parseAuditEntry } from '@/lib/audit';
import { getRequiredUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const limit = Math.max(1, Math.min(500, Number(req.nextUrl.searchParams.get('limit') || '100')));
  const entries = listAudit(userId, limit).map(parseAuditEntry);
  return NextResponse.json({ entries });
}
