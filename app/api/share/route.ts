import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getRequiredUserId, getCurrentUserId } from '@/lib/session';
import { getUser, setShareToken, getUserByShareToken } from '@/lib/db';

export const dynamic = 'force-dynamic';

function newToken() {
  return randomBytes(24).toString('base64url');
}

/** GET /api/share — return the current share token (creates one if missing). */
export async function GET() {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  let u = getUser(userId);
  if (!u) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!u.share_token) {
    let token = newToken();
    // extremely unlikely to collide, but guard
    while (getUserByShareToken(token)) token = newToken();
    setShareToken(userId, token);
    u = { ...u, share_token: token };
  }
  return NextResponse.json({ token: u.share_token });
}

/** POST /api/share — force-regenerate the share token. */
export async function POST() {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  let token = newToken();
  while (getUserByShareToken(token)) token = newToken();
  setShareToken(userId, token);
  return NextResponse.json({ token });
}

/** DELETE /api/share — revoke the share token. */
export async function DELETE() {
  let userId: string;
  try { userId = await getRequiredUserId(); } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  setShareToken(userId, null);
  return NextResponse.json({ ok: true });
}
