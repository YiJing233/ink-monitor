import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, setSetting } from '@/lib/db';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

const UpdateSchema = z.object({
  refresh_seconds: z.coerce.number().int().min(15).max(3600).optional(),
  page_title: z.string().min(1).max(60).optional(),
});

export async function GET() {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  return NextResponse.json({ settings: getAllSettings(userId) });
}

export async function POST(req: NextRequest) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  for (const [k, v] of Object.entries(parsed.data)) {
    setSetting(userId, k, String(v));
  }
  return NextResponse.json({ ok: true });
}
