import { NextRequest, NextResponse } from 'next/server';
import { listProviders, listStocks, insertProvider, insertStock, setSetting, getSetting } from '@/lib/db';
import { encryptForUser } from '@/lib/crypto';
import { randomId } from '@/lib/utils';
import { getRequiredUserId } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const ImportSchema = z.object({
  version: z.number(),
  providers: z.array(z.object({
    name: z.string(),
    type: z.enum(['openai', 'anthropic', 'custom', 'demo', 'groq', 'mistral', 'deepseek', 'moonshot', 'zhipu', 'openrouter', 'ollama']),
    base_url: z.string().nullable().optional(),
    endpoint: z.string().nullable().optional(),
    json_path: z.string().nullable().optional(),
    display_order: z.number().optional(),
    refresh_seconds: z.number().nullable().optional(),
  })).optional().default([]),
  stocks: z.array(z.object({
    symbol: z.string(),
    market: z.enum(['us', 'cn', 'hk']),
    display_name: z.string().nullable().optional(),
    display_order: z.number().optional(),
    refresh_seconds: z.number().nullable().optional(),
  })).optional().default([]),
  settings: z.record(z.string(), z.string()).optional().default({}),
});

export async function POST(req: NextRequest) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }

  const body = await req.json().catch(() => null);
  const parsed = ImportSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { providers, stocks, settings } = parsed.data;
  let addedP = 0, skippedP = 0, addedS = 0, skippedS = 0, setSettings = 0;

  // Providers — only re-create as 'demo' for the imported entries since we
  // can't carry the encrypted key across users/machines. The user must add
  // real keys through the admin UI after import.
  for (const p of providers) {
    try {
      insertProvider({
        id: randomId(),
        user_id: userId,
        name: `${p.name} (imported)`,
        type: 'demo', // placeholder
        api_key_encrypted: encryptForUser(userId, 'demo-not-used'),
        base_url: p.base_url ?? null,
        endpoint: p.endpoint ?? null,
        json_path: p.json_path ?? null,
        display_order: listProviders(userId).length,
        refresh_seconds: p.refresh_seconds ?? null,
      });
      addedP++;
    } catch {
      skippedP++;
    }
  }

  // Stocks
  for (const s of stocks) {
    try {
      insertStock({
        id: randomId(),
        user_id: userId,
        symbol: s.symbol,
        market: s.market,
        display_name: s.display_name ?? null,
        display_order: listStocks(userId).length,
        refresh_seconds: s.refresh_seconds ?? null,
      });
      addedS++;
    } catch {
      skippedS++;
    }
  }

  // Settings
  for (const [k, v] of Object.entries(settings)) {
    if (k === 'seeded_v1' || k === 'share_token') continue; // don't import these
    setSetting(userId, k, v);
    setSettings++;
  }

  recordAudit({
    userId,
    action: 'create',
    targetType: 'account',
    after: { action: 'import', addedP, skippedP, addedS, skippedS, setSettings },
  });

  return NextResponse.json({
    ok: true,
    added: { providers: addedP, stocks: addedS, settings: setSettings },
    skipped: { providers: skippedP, stocks: skippedS },
  });
}
