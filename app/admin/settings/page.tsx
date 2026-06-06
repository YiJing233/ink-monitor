'use client';

import { useEffect, useState } from 'react';

export default function SettingsAdmin() {
  const [refreshSeconds, setRefreshSeconds] = useState('60');
  const [pageTitle, setPageTitle] = useState('Monitor');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => {
        if (j?.settings?.refresh_seconds) setRefreshSeconds(j.settings.refresh_seconds);
        if (j?.settings?.page_title) setPageTitle(j.settings.page_title);
      });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh_seconds: Number(refreshSeconds),
          page_title: pageTitle,
        }),
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j?.error ? JSON.stringify(j.error) : 'Failed');
      }
      setOk('Saved.');
    } catch (e: any) {
      setErr(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Display settings</h2>
      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <form onSubmit={save}>
        <div className="field" style={{ maxWidth: 360 }}>
          <label className="label">Refresh interval (seconds)</label>
          <input
            type="number"
            min={15}
            max={3600}
            value={refreshSeconds}
            onChange={(e) => setRefreshSeconds(e.target.value)}
            style={{ width: '100%' }}
          />
          <div className="hint">
            Used by <code>&lt;meta http-equiv=&quot;refresh&quot;&gt;</code> on the display page.
            Kindle&apos;s experimental browser supports 15s minimum reliably.
          </div>
        </div>

        <div className="field" style={{ maxWidth: 360 }}>
          <label className="label">Page title</label>
          <input
            value={pageTitle}
            onChange={(e) => setPageTitle(e.target.value)}
            style={{ width: '100%' }}
            maxLength={60}
          />
        </div>

        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  );
}
