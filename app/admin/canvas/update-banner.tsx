'use client';

/**
 * Auto-update banner surfaced at the top of the Canvas page when one or more
 * installed-from-market widgets have a newer version on the registry.
 *
 * Server-derived state: `updates` is pre-computed by `app/admin/canvas/page.tsx`
 * via `findAvailableUpdates(...)` and passed in. The client only needs to drive
 * the "Update all" button + show the per-widget "view details" expander.
 *
 * Server-write action: POST `/api/widgets/batch-update` with the current
 * `dashboardId`. The route re-runs the same version check against the live
 * registry, fetches the latest manifests, writes them to `widgets.manifest_json`,
 * and records a `widget.update` audit row. On success we reload so the editor
 * sees the upgraded manifests immediately.
 */
import { useState } from 'react';

export interface PendingUpdate {
  widgetId: string;
  manifestId: string;
  installedVersion: string | null;
  latestVersion: string;
}

export default function UpdateBanner({
  dashboardId,
  updates,
}: {
  dashboardId: string | null;
  updates: PendingUpdate[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  if (!updates.length) return null;
  const n = updates.length;

  async function updateAll() {
    if (!dashboardId) return;
    setBusy(true);
    setStatus('');
    try {
      const r = await fetch('/api/widgets/batch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardId }),
      });
      const j = (await r.json()) as { updated?: number; error?: string };
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'update failed');
      // Reload so CanvasEditor picks up the upgraded manifest_json rows.
      window.location.reload();
    } catch (e: any) {
      setStatus(e?.message || String(e));
      setBusy(false);
    }
  }

  return (
    <div
      className="panel"
      style={{
        borderLeft: '4px solid #e8a13b',
        background: '#fff8ec',
        marginBottom: 12,
        padding: '10px 12px',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        <strong>{n} widget{n === 1 ? '' : 's'} {n === 1 ? 'has' : 'have'} a new version available</strong>
        {expanded && (
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {updates.map((u) => (
              <li key={u.widgetId}>
                <code>{u.manifestId}</code>: v{u.installedVersion ?? '0.0.0'} → v{u.latestVersion}
              </li>
            ))}
          </ul>
        )}
        {status && <div style={{ color: '#a04040', marginTop: 4 }}>{status}</div>}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={() => setExpanded((x) => !x)} disabled={busy}>
          {expanded ? 'Hide' : 'View'}
        </button>
        <button className="btn primary" onClick={updateAll} disabled={busy || !dashboardId}>
          {busy ? 'Updating…' : 'Update all'}
        </button>
      </div>
    </div>
  );
}
