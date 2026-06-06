import { NextRequest, NextResponse } from 'next/server';
import { listStocks, insertStock } from '@/lib/db';
import { randomId } from '@/lib/utils';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  symbol: z.string().min(1).max(20).transform((s) => s.trim().toUpperCase()),
  market: z.enum(['us', 'cn', 'hk']),
  display_name: z.string().optional().nullable(),
  refresh_seconds: z.coerce.number().int().min(15).max(86400).optional().nullable(),
});

export async function GET() {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  return NextResponse.json({ stocks: listStocks(userId) });
}

export async function POST(req: NextRequest) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const id = randomId();
  const existing = listStocks(userId);
  try {
    insertStock({
      id,
      user_id: userId,
      symbol: parsed.data.symbol,
      market: parsed.data.market,
      display_name: parsed.data.display_name || null,
      display_order: existing.length,
      refresh_seconds: parsed.data.refresh_seconds ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Insert failed' }, { status: 400 });
  }
  return NextResponse.json({ id, ok: true });
}
