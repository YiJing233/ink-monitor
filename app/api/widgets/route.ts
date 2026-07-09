import { NextRequest, NextResponse } from 'next/server';
import { getRequiredUserId } from '@/lib/session';
import { listWidgets, insertWidget } from '@/lib/db';
import { randomId } from '@/lib/utils';
import { safeValidateManifest } from '@/lib/widgets/ir';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const widgets = listWidgets(userId).map((w) => {
    let manifest: unknown = null;
    try {
      manifest = JSON.parse(w.manifest_json);
    } catch {
      /* ignore */
    }
    let config: unknown = {};
    try {
      config = JSON.parse(w.config_json);
    } catch {
      /* ignore */
    }
    return { id: w.id, manifest, config };
  });
  return NextResponse.json({ widgets });
}

/**
 * Create a widget instance from a manifest. The manifest is validated against
 * the IR schema before storage. Pass `{ validateOnly: true }` (used by the
 * `widget` skill's preview loop) to validate without persisting.
 */
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

  const result = safeValidateManifest(body?.manifest);
  if (!result.success) {
    return NextResponse.json({ error: 'invalid manifest', issues: result.error.flatten() }, { status: 400 });
  }
  if (body?.validateOnly) {
    return NextResponse.json({ ok: true, valid: true, manifest: result.data });
  }

  const id = randomId();
  insertWidget({
    id,
    user_id: userId,
    manifest_json: JSON.stringify(result.data),
    config_json: JSON.stringify(body?.config ?? {}),
  });
  recordAudit({
    userId,
    action: 'widget.create',
    targetType: 'widget',
    targetId: id,
    after: { manifest_id: result.data.id, config: body?.config ?? {} },
  });
  return NextResponse.json({ id, ok: true });
}
