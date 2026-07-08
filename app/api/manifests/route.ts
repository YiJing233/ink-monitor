import { NextRequest, NextResponse } from 'next/server';
import { getRequiredUserId } from '@/lib/session';
import { listUserManifests, upsertUserManifest } from '@/lib/db';
import { safeValidateManifest } from '@/lib/widgets/ir';

/**
 * The user's manifest library — what shows up in the canvas palette beyond the
 * built-ins. Populated by the `widget` skill (authoring) and by Market installs.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const manifests = listUserManifests(userId).map((r) => {
    let manifest: unknown = null;
    try {
      manifest = JSON.parse(r.manifest_json);
    } catch {
      /* ignore */
    }
    return { manifest_id: r.manifest_id, origin: r.origin, updated_at: r.updated_at, manifest };
  });
  return NextResponse.json({ manifests });
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
  const result = safeValidateManifest(body?.manifest);
  if (!result.success) {
    return NextResponse.json({ error: 'invalid manifest', issues: result.error.flatten() }, { status: 400 });
  }
  const origin = body?.origin === 'installed' ? 'installed' : 'custom';
  upsertUserManifest(userId, result.data.id, JSON.stringify(result.data), origin);
  return NextResponse.json({ ok: true, manifest_id: result.data.id });
}
