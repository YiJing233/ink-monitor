import { NextRequest, NextResponse } from 'next/server';
import { loadDemoData } from '@/lib/seed';
import { getRequiredUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const result = loadDemoData(userId);
  return NextResponse.json({ ok: true, ...result });
}
