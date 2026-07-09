import { NextRequest, NextResponse } from 'next/server';
import { getRequiredUserId } from '@/lib/session';
import { getWidget, updateWidget, deleteWidget } from '@/lib/db';
import { safeValidateManifest } from '@/lib/widgets/ir';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!getWidget(userId, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body?.manifest !== undefined) {
    const result = safeValidateManifest(body.manifest);
    if (!result.success) return NextResponse.json({ error: 'invalid manifest', issues: result.error.flatten() }, { status: 400 });
    patch.manifest_json = JSON.stringify(result.data);
  }
  if (body?.config !== undefined) patch.config_json = JSON.stringify(body.config);

  updateWidget(userId, id, patch);
  recordAudit({
    userId,
    action: 'widget.update',
    targetType: 'widget',
    targetId: id,
    after: { manifest: body?.manifest !== undefined, config: body?.config !== undefined },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const existing = getWidget(userId, id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let manifestId: string | null = null;
  try {
    manifestId = (JSON.parse(existing.manifest_json) as { id?: string })?.id ?? null;
  } catch {
    /* ignore corrupt manifest_json -- the row is about to be deleted anyway */
  }
  deleteWidget(userId, id);
  recordAudit({
    userId,
    action: 'widget.delete',
    targetType: 'widget',
    targetId: id,
    before: { manifest_id: manifestId },
  });
  return NextResponse.json({ ok: true });
}
