import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';
import { getWidget, updateWidget } from '@/lib/db';
import { safeJson } from '@/lib/safe-json';

export const dynamic = 'force-dynamic';

/**
 * POST /api/widgets/[id]/config
 *
 * Owner-only write-back for the `notes` widget's per-instance lines (and a
 * natural extension point for other per-widget config the QR editor might
 * surface). The body shape is intentionally minimal — only the `lines` field
 * is validated and persisted; everything else in `config_json` is left
 * untouched, so adding more writable config fields later doesn't require a
 * route change.
 *
 * Auth: requires an authenticated session AND ownership of the widget row
 * (the getWidget(userId, id) check scopes the lookup per user).
 *
 * Validation (zod):
 *   - `lines` must be an array of strings
 *   - ≤ 50 entries (matches the layout's `max: 16` for the largest family
 *     with comfortable headroom; the renderer caps at 16 anyway, but the API
 *     is the source of truth for what's writable)
 *   - each line ≤ 200 characters (the e-ink list renderer can't wrap; longer
 *     lines just truncate visually)
 *
 * The two failure modes the spec asks us to surface explicitly:
 *   - 401 when no session
 *   - 403 when the widget exists but belongs to someone else
 *
 * The note that 404 covers "doesn't exist at all" (the route can't
 * distinguish 404 from 403 on principle — we collapse both to "not yours" by
 * returning 404, matching the existing /api/widgets/[id] PATCH behavior).
 */
const LineSchema = z.string().min(1).max(200);
const BodySchema = z.object({
  lines: z.array(LineSchema).max(50),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  // Ownership check: `getWidget` is keyed by (user_id, id), so a foreign widget
  // returns `undefined` — same shape as "doesn't exist". The spec calls for 403
  // when "the widget belongs to someone else"; we surface that with a distinct
  // status so the test can assert on it directly.
  const widget = getWidget(userId, id);
  if (!widget) {
    // First peek: does the widget exist at all? If yes but it's not ours,
    // it's an authz violation (403); if no, it's 404. We do a separate query
    // rather than rely on a global `getWidgetById` (none exists) — a single
    // SQLite point lookup is cheap, and the extra branch makes the authz
    // contract auditable in code review.
    const { getDb } = await import('@/lib/db');
    const row = getDb().prepare('SELECT user_id FROM widgets WHERE id = ?').get(id) as
      | { user_id: string }
      | undefined;
    if (row && row.user_id !== userId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Merge with the existing config so unrelated keys (e.g. `city` for a
  // weather widget, future config fields) survive. Today the only writer is
  // the notes editor, but the route is the natural extension point for any
  // per-widget config the QR editor grows to surface.
  const existing = (safeJson(widget.config_json, 'widgets.config_json') as Record<string, unknown>) || {};
  const next = { ...existing, lines: parsed.data.lines };
  updateWidget(userId, id, { config_json: JSON.stringify(next) });
  return NextResponse.json({ ok: true, lines: parsed.data.lines });
}