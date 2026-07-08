import { NextRequest, NextResponse } from 'next/server';
import { getRequiredUserId } from '@/lib/session';
import { deleteUserManifest } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  deleteUserManifest(userId, id);
  return NextResponse.json({ ok: true });
}
