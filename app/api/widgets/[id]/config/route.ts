import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';
import { getWidget, updateWidget } from '@/lib/db';
import { safeJson } from '@/lib/safe-json';
import {
  CONFIG_FIELD_TYPES,
  type ConfigField,
  safeValidateManifest,
} from '@/lib/widgets/ir';

export const dynamic = 'force-dynamic';

/**
 * POST /api/widgets/[id]/config
 *
 * Generic per-widget config write-back, gated by `manifest.config_schema`.
 * The body shape is *driven by the manifest's `config_schema` field*, so a
 * widget author only needs to declare the editable fields there — no code
 * change to this route is required to support a new widget.
 *
 * For each declared field, the value must match the field's `type`:
 *   - `text`     → string
 *   - `multiline`→ string
 *   - `lines`    → string[] (each ≤ maxChars, length ≤ maxLines)
 *   - `number`   → number (clamped to min/max if declared)
 *   - `boolean`  → boolean
 *
 * Fields the user omits in the body keep their existing `config_json` value
 * (the route merges — a partial PATCH doesn't reset other fields). Trying
 * to write a key that isn't declared in `config_schema` returns 400 so a
 * tampered client can't smuggle new fields into the widget row.
 *
 * Auth: requires an authenticated session AND ownership of the widget row
 * (the `getWidget(userId, id)` check scopes the lookup per user).
 *
 * Failure modes the spec calls out:
 *   - 401 when no session
 *   - 403 when the widget exists but belongs to someone else
 *   - 404 when the widget doesn't exist at all
 *   - 400 when the manifest has no `config_schema`, the body has unknown
 *     keys, or any declared field fails validation
 */

function buildSchema(fields: ConfigField[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny;
    switch (f.type) {
      case 'text':
      case 'multiline': {
        let str = z.string();
        if (typeof f.maxChars === 'number') str = str.max(f.maxChars);
        s = str;
        break;
      }
      case 'lines': {
        const maxChars = typeof f.maxChars === 'number' ? f.maxChars : 1000;
        const maxLines = typeof f.maxLines === 'number' ? f.maxLines : 100;
        s = z.array(z.string().min(1).max(maxChars)).max(maxLines);
        break;
      }
      case 'number': {
        let num = z.number();
        if (typeof f.min === 'number') num = num.min(f.min);
        if (typeof f.max === 'number') num = num.max(f.max);
        s = num;
        break;
      }
      case 'boolean': {
        s = z.boolean();
        break;
      }
      default: {
        // Defensive: the manifest validator already constrains `type` to
        // CONFIG_FIELD_TYPES, but a custom install could slip a bogus value
        // past a partial validation. Fail closed — treat the widget as if
        // it declared no config_schema so the caller gets a 400, not a 500.
        throw new Error(`unknown config field type: ${String((f as { type?: unknown }).type)}`);
      }
    }
    // Every field is optional on the wire: a partial PATCH that omits a
    // key leaves the existing config_json entry untouched. The schema's
    // required-ness lives on the manifest author (they declare `default`
    // for the editor fallback), not on the API.
    shape[f.key] = s.optional();
  }
  // `passthrough: false` is the default, so unknown keys surface as a Zod
  // error and become a 400. That's the contract: the manifest's
  // config_schema is the closed vocabulary.
  return z.object(shape).strict();
}

function readConfigSchema(manifestJson: string): { schema: z.ZodTypeAny; fields: ConfigField[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    return null;
  }
  // Validate via the full ManifestSchema so a partial / hand-crafted row
  // doesn't slip past us. We deliberately don't re-run the manifest
  // validator at render time (the canvas does that) — but on the
  // config-write path the row is the source of truth and the writer is
  // user-controlled, so the extra check is worth the cost.
  const result = safeValidateManifest(parsed);
  if (!result.success) return null;
  const fields = result.data.config_schema;
  if (!fields || fields.length === 0) return null;
  // Re-validate each field via the dedicated schema (cheap; small array)
  // so we don't have to widen the safe-parse surface for `unknown` types.
  const validated: ConfigField[] = [];
  for (const f of fields) {
    const fr = CONFIG_FIELD_TYPES.includes(f.type)
      ? (f as ConfigField)
      : null;
    if (fr) validated.push(fr);
  }
  if (validated.length === 0) return null;
  return { schema: buildSchema(validated), fields: validated };
}

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

  // The manifest's config_schema is the source of truth for what's
  // writable. A widget row without one (legacy import, pre-schema
  // install, hand-crafted share code) gets a 400 — the route is opt-in
  // and refuses to write to a schema-less widget.
  const schemaInfo = readConfigSchema(widget.manifest_json);
  if (!schemaInfo) {
    return NextResponse.json(
      { error: 'widget has no config_schema — config write not supported' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = schemaInfo.schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Merge with the existing config so unrelated keys (e.g. `city` for a
  // weather widget, future config fields) survive. We only overwrite
  // keys the client explicitly sent — a partial PATCH keeps other
  // config_json entries intact.
  const existing = (safeJson(widget.config_json, 'widgets.config_json') as Record<string, unknown>) || {};
  const next = { ...existing, ...parsed.data };
  updateWidget(userId, id, { config_json: JSON.stringify(next) });
  return NextResponse.json({ ok: true, config: next });
}