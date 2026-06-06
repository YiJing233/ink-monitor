import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/session';
import { getUser } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const id = await getCurrentUserId();
  if (!id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const user = getUser(id);
  return NextResponse.json({ id, email: user?.email, name: user?.name });
}
