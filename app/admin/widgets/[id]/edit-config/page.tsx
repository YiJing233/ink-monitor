import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRequiredUserId } from '@/lib/session';
import { getWidget } from '@/lib/db';
import { safeJson } from '@/lib/safe-json';
import { resolveLocale, t } from '@/lib/i18n';
import { safeValidateManifest, type ConfigField } from '@/lib/widgets/ir';
import EditConfigClient from './edit-config-client';

export const dynamic = 'force-dynamic';

/**
 * Generic per-widget QR-backed editor.
 *
 * Replaces `/admin/widgets/[id]/edit-notes` for every widget that declares
 * a `config_schema` in its manifest. The widget's `manifest_json` is
 * parsed + validated server-side; the resulting `config_schema` array
 * drives the form (one input per entry). The `widget.config_json` row is
 * the pre-fill — the same data the Source layer reads at render time, so
 * "what the user sees in the form" is exactly what the e-ink display
 * will render.
 *
 * Save POSTs to `/api/widgets/[id]/config`, which validates the body
 * against the manifest's schema (the server is the source of truth — a
 * tampered client can't write fields the manifest didn't declare).
 *
 * Auth: owner-only. We resolve the userId at the page boundary and pass
 * it to the client; the API does its own ownership re-check so the
 * server is always the source of truth, even if the client URL is
 * tampered with.
 *
 * Widgets without a `config_schema` get the same not-found panel the
 * notes page used — a widget author can opt into the QR editor by
 * adding the field to their manifest, no code change required.
 */
export default async function EditConfigPage({ params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
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
        <h2 style={{ marginTop: 0 }}>{t(locale, 'admin.editConfig.h')}</h2>
        <div className="err" dangerouslySetInnerHTML={{ __html: t(locale, 'admin.editConfig.notFound', { id }) }} />
        <Link className="btn" href="/admin/canvas">
          {t(locale, 'admin.editConfig.backToCanvas')}
        </Link>
      </div>
    );
  }

  // Parse + validate the manifest. We use the safe-parse variant so a
  // corrupt row (legacy install, half-migrated share code) renders an
  // explicit error panel instead of crashing the page.
  let manifestName = id;
  let manifestId = id;
  let fields: ConfigField[] = [];
  const parsed = safeValidateManifest(safeJson(widget.manifest_json, 'widgets.manifest_json'));
  if (parsed.success) {
    if (typeof parsed.data.name === 'string') manifestName = parsed.data.name;
    if (typeof parsed.data.id === 'string') manifestId = parsed.data.id;
    fields = parsed.data.config_schema ?? [];
  }

  if (fields.length === 0) {
    return (
      <div>
        <h2 style={{ marginTop: 0 }}>{t(locale, 'admin.editConfig.h')}</h2>
        <div className="err">
          {t(locale, 'admin.editConfig.noSchema', { manifest: manifestName })}
        </div>
        <p className="hint">{t(locale, 'admin.editConfig.noSchemaHint')}</p>
        <Link className="btn" href="/admin/canvas">
          {t(locale, 'admin.editConfig.backToCanvas')}
        </Link>
      </div>
    );
  }

  // Pre-fill from the existing config_json row. We coerce each field's
  // value (defaulting to the manifest's `default` when the key is
  // missing) so the form is always fully populated — partial writes can
  // then leave other fields untouched without us forcing the user to
  // re-type everything.
  const cfg = (safeJson(widget.config_json, 'widgets.config_json') as Record<string, unknown>) || {};
  const initialValues: Record<string, unknown> = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(cfg, f.key)) {
      initialValues[f.key] = cfg[f.key];
    } else if (Object.prototype.hasOwnProperty.call(f, 'default')) {
      initialValues[f.key] = f.default;
    } else {
      // Empty per-type so the editor renders an empty control.
      initialValues[f.key] = f.type === 'number' ? null : f.type === 'boolean' ? false : '';
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{t(locale, 'admin.editConfig.editorH')}</h2>
      <p className="hint">{t(locale, 'admin.editConfig.body')}</p>

      <div className="panel">
        <div className="field">
          <span className="label">{t(locale, 'admin.editConfig.field.widgetId')}</span>
          <code>{id}</code>
        </div>
        <div className="field">
          <span className="label">{t(locale, 'admin.editConfig.field.manifest')}</span>{' '}
          <strong>{manifestName}</strong> <span className="hint">({manifestId})</span>
        </div>
      </div>

      <EditConfigClient
        widgetId={id}
        fields={fields}
        initialValues={initialValues}
        locale={locale}
      />

      <div style={{ marginTop: 16 }}>
        <Link className="btn" href="/admin/canvas">
          {t(locale, 'admin.editConfig.backToCanvas')}
        </Link>
      </div>
    </div>
  );
}