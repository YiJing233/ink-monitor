import { NextRequest, NextResponse } from 'next/server';
import { getRequiredUserId } from '@/lib/session';
import { getWidget, updateWidget, deleteWidget } from '@/lib/db';
import { safeValidateManifest } from '@/lib/widgets/ir';

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
  if (!getWidget(userId, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  deleteWidget(userId, id);
  return NextResponse.json({ ok: true });
}
