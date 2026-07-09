import { NextRequest, NextResponse } from 'next/server';
import { getRequiredUserId } from '@/lib/session';
import { deleteUserManifest, getUserManifest } from '@/lib/db';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const existing = getUserManifest(userId, id);
  deleteUserManifest(userId, id);
  recordAudit({
    userId,
    action: 'manifest.delete',
    targetType: 'manifest',
    targetId: id,
    before: existing ? { origin: existing.origin } : null,
  });
  return NextResponse.json({ ok: true });
}
