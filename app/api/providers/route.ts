import { NextRequest, NextResponse } from 'next/server';
import { listProviders, insertProvider } from '@/lib/db';
import { encryptForUser } from '@/lib/crypto';
import { randomId } from '@/lib/utils';
import { sanitizeProvider, maskKey } from '@/lib/aggregator';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(['openai', 'anthropic', 'custom', 'demo', 'groq', 'mistral', 'deepseek', 'moonshot', 'zhipu', 'openrouter', 'ollama']),
  api_key: z.string().optional(),
  base_url: z.string().optional().nullable(),
  endpoint: z.string().optional().nullable(),
  json_path: z.string().optional().nullable(),
  refresh_seconds: z.coerce.number().int().min(15).max(86400).optional().nullable(),
});

export async function GET() {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  const providers = listProviders(userId).map((p) => ({
    ...sanitizeProvider(p),
    api_key_masked: maskKey(p.api_key_encrypted),
  }));
  return NextResponse.json({ providers });
}

export async function POST(req: NextRequest) {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.type !== 'demo' && !parsed.data.api_key) {
    return NextResponse.json({ error: 'API key is required for this provider type' }, { status: 400 });
  }
  const apiKey = parsed.data.type === 'demo' ? 'demo-not-used' : (parsed.data.api_key || '');

  const id = randomId();
  const existing = listProviders(userId);
  insertProvider({
    id,
    user_id: userId,
    name: parsed.data.name,
    type: parsed.data.type,
    api_key_encrypted: encryptForUser(userId, apiKey),
    base_url: parsed.data.base_url || null,
    endpoint: parsed.data.endpoint || null,
    json_path: parsed.data.json_path || null,
    display_order: existing.length,
    refresh_seconds: parsed.data.refresh_seconds ?? null,
  });

  return NextResponse.json({ id, ok: true });
}
