import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';
import { listDashboards, insertDashboard } from '@/lib/db';
import { randomId } from '@/lib/utils';
import { DEVICE_IDS } from '@/lib/widgets/devices';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  name: z.string().min(1).max(60),
  base_device: z.enum(DEVICE_IDS as [string, ...string[]]).optional(),
});

export async function GET() {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ dashboards: listDashboards(userId) });
}

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const id = randomId();
  insertDashboard({
    id,
    user_id: userId,
    name: parsed.data.name,
    base_device: parsed.data.base_device || 'kindle-pw',
    layouts_json: '{}',
    refresh_overrides_json: '{}',
    display_order: listDashboards(userId).length,
  });
  recordAudit({
    userId,
    action: 'dashboard.create',
    targetType: 'dashboard',
    targetId: id,
    after: { name: parsed.data.name, base_device: parsed.data.base_device || 'kindle-pw' },
  });
  return NextResponse.json({ id, ok: true });
}
