import { NextResponse } from 'next/server';
import { listProviders, listStocks, getAllSettings, getUser } from '@/lib/db';
import { getRequiredUserId } from '@/lib/session';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const EXPORT_VERSION = 1;

export async function GET() {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }

  const user = getUser(userId);
  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
    },
    providers: listProviders(userId).map((p) => ({
      // NOTE: api_key_encrypted is intentionally NOT included in the export.
      // Re-importing will require the user to re-enter keys.
      name: p.name,
      type: p.type,
      base_url: p.base_url,
      endpoint: p.endpoint,
      json_path: p.json_path,
      display_order: p.display_order,
      refresh_seconds: p.refresh_seconds,
    })),
    stocks: listStocks(userId).map((s) => ({
      symbol: s.symbol,
      market: s.market,
      display_name: s.display_name,
      display_order: s.display_order,
      refresh_seconds: s.refresh_seconds,
    })),
    settings: getAllSettings(userId),
  };

  recordAudit({ userId, action: 'login', targetType: 'session', targetId: null, after: { action: 'export' } });

  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="ink-monitor-export-${userId.slice(0, 8)}-${Date.now()}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
