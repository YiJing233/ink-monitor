import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRequiredUserId } from '@/lib/session';
import { getWidget } from '@/lib/db';
import { safeJson } from '@/lib/safe-json';
import { resolveLocale, t } from '@/lib/i18n';
import EditNotesClient from './edit-notes-client';

export const dynamic = 'force-dynamic';

/**
 * Per-widget QR-backed editor for the `notes` widget.
 *
 * Flow:
 *   - The notes widget renders a QR (via `NotesWidget` in the canvas) that
 *     links here. Scanning the QR with a phone takes the user straight to
 *     this page for the specific widget instance, so editing on a phone is
 *     "open the phone, scan, type, save" — no manual URL juggling.
 *   - The server pre-populates the textarea from `widget.config_json.lines`
 *     (the same field the Source layer reads at render time, so what the
 *     user sees in the form is exactly what the e-ink display will render).
 *   - Save POSTs to `/api/widgets/[id]/config`, which validates the body
 *     (≤ 50 lines, ≤ 200 chars each) and writes back via `updateWidget`.
 *
 * Auth: owner-only. We resolve the userId at the page boundary and pass it
 * to the client; the API does its own ownership re-check so the server is
 * always the source of truth, even if the client URL is tampered with.
 */
export default async function EditNotesPage({ params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    // No session → bounce to sign-in. We don't render the editor shell for
    // unauthenticated users; the layout would have already redirected, but
    // the explicit guard makes the contract auditable.
    redirect('/signin');
  }

  const { id } = await params;
  const widget = getWidget(userId, id);
  const c = await cookies();
  const h = await headers();
  const locale = resolveLocale(c.get('NEXT_LOCALE')?.value || null, h.get('accept-language'));
  if (!widget) {
    return (
      <div>
        <h2 style={{ marginTop: 0 }}>{t(locale, 'admin.editNotes.h')}</h2>
        <div className="err" dangerouslySetInnerHTML={{ __html: t(locale, 'admin.editNotes.notFound', { id }) }} />
        <Link className="btn" href="/admin/canvas">
          {t(locale, 'admin.editNotes.backToCanvas')}
        </Link>
      </div>
    );
  }

  // Read the lines straight out of config_json. The Source layer treats
  // a non-array `lines` field as "never configured", so we coerce + cap to
  // the editor's limits (50 lines, 200 chars each) — anything outside the
  // limits was either written by a buggy client or pre-dates the schema,
  // and the form clamps it for the user to re-save cleanly.
  const cfg = (safeJson(widget.config_json, 'widgets.config_json') as { lines?: unknown } | null) || {};
  const raw = Array.isArray(cfg.lines) ? cfg.lines : [];
  const initialLines = raw
    .filter((l): l is string => typeof l === 'string' && l.length > 0)
    .map((l) => l.slice(0, 200))
    .slice(0, 50);

  // Pull the manifest name for the header. We don't validate it server-side
  // here (the widget row itself was validated at insert time), but a parse
  // failure is tolerated — fall back to the manifest id so the page still
  // renders something useful.
  let manifestName = id;
  let manifestId = id;
  try {
    const m = JSON.parse(widget.manifest_json);
    if (typeof m.name === 'string') manifestName = m.name;
    if (typeof m.id === 'string') manifestId = m.id;
  } catch {
    /* fall back */
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{t(locale, 'admin.editNotes.editorH')}</h2>
      <p className="hint">{t(locale, 'admin.editNotes.body')}</p>

      <div className="panel">
        <div className="field">
          <span className="label">{t(locale, 'admin.editNotes.field.widgetId')}</span>
          <code>{id}</code>
        </div>
        <div className="field">
          <span className="label">{t(locale, 'admin.editNotes.field.manifest')}</span>{' '}
          <strong>{manifestName}</strong> <span className="hint">({manifestId})</span>
        </div>
      </div>

      <EditNotesClient widgetId={id} initialLines={initialLines} locale={locale} />

      <div style={{ marginTop: 16 }}>
        <Link className="btn" href="/admin/canvas">
          {t(locale, 'admin.editNotes.backToCanvas')}
        </Link>
      </div>
    </div>
  );
}
