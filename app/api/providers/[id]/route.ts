import { NextRequest, NextResponse } from 'next/server';
import { getProvider, updateProvider, deleteProvider, swapProviderOrder, listProviders } from '@/lib/db';
import { encryptForUser } from '@/lib/crypto';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

const UpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  base_url: z.string().nullable().optional(),
  endpoint: z.string().nullable().optional(),
  json_path: z.string().nullable().optional(),
  display_order: z.number().int().optional(),
  refresh_seconds: z.union([z.coerce.number().int().min(15).max(86400), z.null()]).optional(),
  api_key: z.string().min(1).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const { id } = await params;
  const p = getProvider(userId, id);
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const update: any = { ...parsed.data };
  if (update.api_key) update.api_key_encrypted = encryptForUser(userId, update.api_key);
  delete update.api_key;

  updateProvider(userId, id, update);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const { id } = await params;
  const p = getProvider(userId, id);
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  deleteProvider(userId, id);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const { id } = await params;
  const all = listProviders(userId);
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (body?.action !== 'move' || !['up', 'down'].includes(body.direction)) {
    return NextResponse.json({ error: 'action must be { action: "move", direction: "up"|"down" }' }, { status: 400 });
  }

  const swapWith = body.direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= all.length) {
    return NextResponse.json({ ok: true, noop: true });
  }
  swapProviderOrder(userId, id, all[swapWith].id);
  return NextResponse.json({ ok: true });
}
