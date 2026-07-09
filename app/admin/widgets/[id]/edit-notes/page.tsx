import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getRequiredUserId } from '@/lib/session';
import { getWidget } from '@/lib/db';
import { safeJson } from '@/lib/safe-json';
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
  if (!widget) {
    return (
      <div>
        <h2 style={{ marginTop: 0 }}>Notes widget</h2>
        <div className="err">找不到 widget <code>{id}</code>，或它不属于当前账号。</div>
        <Link className="btn" href="/admin/canvas">
          ← 返回 Canvas
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
      <h2 style={{ marginTop: 0 }}>Notes widget 编辑</h2>
      <p className="hint">
        在水墨屏上扫码后看到的就是这里。每行一条笔记，空行会被自动丢弃。
        最多 50 行 · 每行 ≤ 200 字符。
      </p>

      <div className="panel">
        <div className="field">
          <span className="label">Widget id</span>
          <code>{id}</code>
        </div>
        <div className="field">
          <span className="label">Manifest</span>{' '}
          <strong>{manifestName}</strong> <span className="hint">({manifestId})</span>
        </div>
      </div>

      <EditNotesClient widgetId={id} initialLines={initialLines} />

      <div style={{ marginTop: 16 }}>
        <Link className="btn" href="/admin/canvas">
          ← 返回 Canvas
        </Link>
      </div>
    </div>
  );
}