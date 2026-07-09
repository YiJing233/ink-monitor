import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';
import { encryptForUser } from '@/lib/crypto';
import { listWidgetSecretNames, setWidgetSecret, deleteWidgetSecret } from '@/lib/db';
import { recordAudit } from '@/lib/audit';

/**
 * Per-user secrets for `http` widget sources (e.g. OWM_KEY). Values are
 * AES-256-GCM encrypted with the user's derived key; only names are ever read
 * back. The display never sees the plaintext — `lib/widgets/source.ts` decrypts
 * server-side at fetch time.
 */
export const dynamic = 'force-dynamic';

const SetSchema = z.object({ name: z.string().min(1).max(64).regex(/^[A-Za-z0-9_]+$/), value: z.string().min(1) });

export async function GET() {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ names: listWidgetSecretNames(userId) });
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
  const parsed = SetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  // Audit BEFORE encrypt+store: we only persist the name, never the plaintext.
  setWidgetSecret(userId, parsed.data.name, encryptForUser(userId, parsed.data.value));
  recordAudit({
    userId,
    action: 'secret.add',
    targetType: 'secret',
    targetId: parsed.data.name,
    // Intentionally do not include value/ciphertext — name only.
    after: { name: parsed.data.name },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const name = req.nextUrl.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  deleteWidgetSecret(userId, name);
  recordAudit({
    userId,
    action: 'secret.remove',
    targetType: 'secret',
    targetId: name,
    before: { name },
  });
  return NextResponse.json({ ok: true });
}
