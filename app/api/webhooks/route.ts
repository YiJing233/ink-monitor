import { NextRequest, NextResponse } from 'next/server';
import { listWebhooks, insertWebhook, newWebhookId, newWebhookSecret, ALL_WEBHOOK_EVENTS } from '@/lib/webhooks';
import { recordAudit } from '@/lib/audit';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.enum(ALL_WEBHOOK_EVENTS as [string, ...string[]])).min(1).max(50),
});

export async function GET() {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const hooks = listWebhooks(userId).map((h) => ({
    id: h.id,
    url: h.url,
    events: h.events,
    active: !!h.active,
    created_at: h.created_at,
    last_delivered_at: h.last_delivered_at,
    last_status: h.last_status,
  }));
  return NextResponse.json({ webhooks: hooks });
}

export async function POST(req: NextRequest) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Reject localhost / private addresses in production (SSRF guard)
  if (process.env.NODE_ENV === 'production') {
    const host = new URL(parsed.data.url).hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(host)) {
      return NextResponse.json({ error: 'webhook URL must be a public address' }, { status: 400 });
    }
  }

  const id = newWebhookId();
  const secret = newWebhookSecret();
  insertWebhook({
    id,
    user_id: userId,
    url: parsed.data.url,
    events: parsed.data.events as any,
    secret,
  });
  recordAudit({
    userId,
    action: 'create',
    targetType: 'webhook',
    targetId: id,
    after: { url: parsed.data.url, events: parsed.data.events },
  });

  // Return the secret ONCE — only on creation. After this, callers must
  // read it from their own records.
  return NextResponse.json({ id, secret, ok: true });
}
