'use client';

import { useEffect, useState } from 'react';

export function SharePanel({ origin }: { origin: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/share', { cache: 'no-store' });
      const j = await r.json();
      if (j?.token) setToken(j.token);
    } catch (e: any) {
      setErr(e?.message || 'load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function regenerate() {
    if (!confirm('Regenerate the share link? The old URL will stop working.')) return;
    setBusy(true);
    try {
      const r = await fetch('/api/share', { method: 'POST' });
      const j = await r.json();
      if (j?.token) setToken(j.token);
    } catch (e: any) {
      setErr(e?.message || 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm('Revoke the share link? Your Kindle will stop showing the dashboard.')) return;
    setBusy(true);
    try {
      await fetch('/api/share', { method: 'DELETE' });
      setToken(null);
    } catch (e: any) {
      setErr(e?.message || 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!token) return;
    const url = `${origin}/display?share=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
      document.body.removeChild(ta);
    }
  }

  if (loading) return <p>Loading share link…</p>;
  if (err) return <div className="err">{err}</div>;

  const url = token ? `${origin}/display?share=${token}` : null;

  return (
    <div>
      {url ? (
        <>
          <p>
            Bookmark this URL on your Kindle, Xiaomi, or any e-reader browser.
            The token does not expire automatically — regenerate or revoke below
            to invalidate.
          </p>
          <div className="row" style={{ gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              style={{ flex: '1 1 360px', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            />
            <button className="btn" onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
            <a className="btn" href={url} target="_blank" rel="noreferrer">Open</a>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={regenerate} disabled={busy}>Regenerate</button>
            <button className="btn danger" onClick={revoke} disabled={busy}>Revoke</button>
          </div>
        </>
      ) : (
        <>
          <p>No share link yet. Create one to bookmark your dashboard on an e-reader.</p>
          <button className="btn primary" onClick={regenerate} disabled={busy}>
            Create share link
          </button>
        </>
      )}
    </div>
  );
}
