import { NextRequest, NextResponse } from 'next/server';
import { getWebhook, deleteWebhook, setWebhookActive, listDeliveries, fireEvent } from '@/lib/webhooks';
import { recordAudit } from '@/lib/audit';
import { getRequiredUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const { id } = await params;
  const wh = getWebhook(userId, id);
  if (!wh) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    id: wh.id,
    url: wh.url,
    events: wh.events,
    active: !!wh.active,
    created_at: wh.created_at,
    last_delivered_at: wh.last_delivered_at,
    last_status: wh.last_status,
    deliveries: listDeliveries(wh.id, 20).map((d) => ({
      id: d.id,
      event: d.event,
      status: d.status,
      delivered_at: d.delivered_at,
      response_excerpt: d.response_excerpt,
    })),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const { id } = await params;
  const wh = getWebhook(userId, id);
  if (!wh) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  deleteWebhook(userId, id);
  recordAudit({ userId, action: 'delete', targetType: 'webhook', targetId: id, before: { url: wh.url } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const { id } = await params;
  const wh = getWebhook(userId, id);
  if (!wh) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (body && typeof body.active === 'boolean') {
    setWebhookActive(userId, id, body.active);
    recordAudit({ userId, action: 'update', targetType: 'webhook', targetId: id, after: { active: body.active } });
  }
  return NextResponse.json({ ok: true });
}

// POST /api/webhooks/:id { action: 'test' }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const { id } = await params;
  const wh = getWebhook(userId, id);
  if (!wh) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (body?.action !== 'test') {
    return NextResponse.json({ error: 'expected { action: "test" }' }, { status: 400 });
  }

  const result = await fireEvent(userId, wh.events[0] as any, {
    test: true,
    webhook_id: wh.id,
    message: 'This is a test delivery from Ink Monitor.',
  });
  return NextResponse.json(result);
}
