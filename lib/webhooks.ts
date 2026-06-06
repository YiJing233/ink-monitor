import { getDb } from './db';
import { createHmac, randomBytes } from 'node:crypto';

// --- Webhook CRUD ---
export type WebhookEvent =
  | 'provider.created'
  | 'provider.updated'
  | 'provider.deleted'
  | 'stock.created'
  | 'stock.updated'
  | 'stock.deleted'
  | 'usage.above_threshold'
  | 'usage.below_threshold'
  | 'stock.above_threshold'
  | 'stock.below_threshold'
  | 'account.deleted';

export const ALL_WEBHOOK_EVENTS: WebhookEvent[] = [
  'provider.created', 'provider.updated', 'provider.deleted',
  'stock.created', 'stock.updated', 'stock.deleted',
  'usage.above_threshold', 'usage.below_threshold',
  'stock.above_threshold', 'stock.below_threshold',
  'account.deleted',
];

export interface Webhook {
  id: string;
  user_id: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
  active: number;
  created_at: number;
  last_delivered_at: number | null;
  last_status: number | null;
}

export function listWebhooks(userId: string): Webhook[] {
  return getDb()
    .prepare('SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map(rowToWebhook);
}

export function getWebhook(userId: string, id: string): Webhook | undefined {
  const row = getDb()
    .prepare('SELECT * FROM webhooks WHERE user_id = ? AND id = ?')
    .get(userId, id) as any;
  return row ? rowToWebhook(row) : undefined;
}

export function insertWebhook(w: Omit<Webhook, 'created_at' | 'last_delivered_at' | 'last_status' | 'active'>): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO webhooks (id, user_id, url, events, secret, active, created_at)
       VALUES (@id, @user_id, @url, @events, @secret, 1, @created_at)`,
    )
    .run({
      ...w,
      events: JSON.stringify(w.events),
      created_at: now,
    });
}

export function deleteWebhook(userId: string, id: string): void {
  getDb().prepare('DELETE FROM webhooks WHERE user_id = ? AND id = ?').run(userId, id);
}

export function setWebhookActive(userId: string, id: string, active: boolean): void {
  getDb()
    .prepare('UPDATE webhooks SET active = ? WHERE user_id = ? AND id = ?')
    .run(active ? 1 : 0, userId, id);
}

function rowToWebhook(row: any): Webhook {
  return {
    ...row,
    events: JSON.parse(row.events || '[]'),
  };
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

export function newWebhookId(): string {
  return `wh_${randomBytes(12).toString('base64url')}`;
}

// --- Delivery ---
export interface DeliveryRecord {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  status: number | null;
  response_excerpt: string | null;
  delivered_at: number;
}

export function recordDelivery(d: DeliveryRecord): void {
  getDb()
    .prepare(
      `INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, response_excerpt, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(d.id, d.webhook_id, d.event, d.payload, d.status, d.response_excerpt, d.delivered_at);
  getDb()
    .prepare('UPDATE webhooks SET last_delivered_at = ?, last_status = ? WHERE id = ?')
    .run(d.delivered_at, d.status, d.webhook_id);
}

export function listDeliveries(webhookId: string, limit = 50): DeliveryRecord[] {
  return getDb()
    .prepare('SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY delivered_at DESC LIMIT ?')
    .all(webhookId, limit) as DeliveryRecord[];
}

/**
 * Fire a webhook event for a user. Looks up all active webhooks subscribed
 * to the event, signs with HMAC-SHA256, and POSTs. Records every attempt
 * regardless of success.
 */
export async function fireEvent(
  userId: string,
  event: WebhookEvent,
  data: Record<string, any>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ delivered: number; failed: number }> {
  const hooks = listWebhooks(userId).filter((h) => h.active && h.events.includes(event));
  if (hooks.length === 0) return { delivered: 0, failed: 0 };

  const payload = JSON.stringify({
    event,
    delivered_at: new Date().toISOString(),
    data,
  });

  let delivered = 0;
  let failed = 0;

  // Fire in parallel; each handles its own timeout + record.
  await Promise.all(
    hooks.map(async (h) => {
      const sig = createHmac('sha256', h.secret).update(payload).digest('hex');
      const id = `dlv_${randomBytes(8).toString('hex')}`;
      const t0 = Date.now();
      let status: number | null = null;
      let excerpt: string | null = null;
      try {
        const r = await fetchImpl(h.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Ink-Monitor-Event': event,
            'X-Ink-Monitor-Delivery': id,
            'X-Ink-Monitor-Signature': `sha256=${sig}`,
            'User-Agent': 'ink-monitor-webhook/1.0',
          },
          body: payload,
          signal: AbortSignal.timeout(10_000),
        });
        status = r.status;
        excerpt = (await r.text().catch(() => '')).slice(0, 200);
        if (r.ok) delivered++;
        else failed++;
      } catch (e: any) {
        status = 0;
        excerpt = e?.message || String(e);
        failed++;
      }
      recordDelivery({
        id,
        webhook_id: h.id,
        event,
        payload,
        status,
        response_excerpt: excerpt,
        delivered_at: Date.now(),
      });
    }),
  );

  return { delivered, failed };
}
