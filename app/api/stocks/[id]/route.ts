import { NextRequest, NextResponse } from 'next/server';
import { deleteStock, listStocks, swapStockOrder } from '@/lib/db';
import { getRequiredUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const { id } = await params;
  const exists = listStocks(userId).find((s) => s.id === id);
  if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  deleteStock(userId, id);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const { id } = await params;
  const all = listStocks(userId);
  const idx = all.findIndex((s) => s.id === id);
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
  swapStockOrder(userId, id, all[swapWith].id);
  return NextResponse.json({ ok: true });
}
