import { NextResponse } from 'next/server';
import { getDb, getUser } from '@/lib/db';
import { getRequiredUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Hard-delete the current user. Cascades through every FK:
 *   providers, stocks, settings, fetch_cache, webhooks, webhook_deliveries,
 *   audit_log
 *
 * The user row itself is removed last.
 *
 * The session cookie is left intact but the JWT will fail on the next
 * request (the user lookup returns undefined). The user is logged out.
 */
export async function DELETE() {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const u = getUser(userId);
  if (!u) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const db = getDb();
  const tx = db.transaction(() => {
    // Delete in FK-safe order. Cascades should handle most, but be explicit.
    db.prepare('DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM webhooks WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM fetch_cache WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM stocks WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM providers WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM audit_log WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();

  return NextResponse.json({ ok: true, deleted: userId });
}
