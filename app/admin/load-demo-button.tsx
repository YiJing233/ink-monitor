'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LoadDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/demo', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Failed');
      setMsg(`Added ${j.addedProvider} demo provider and ${j.addedStocks} sample stock(s). Open /display now.`);
      setTimeout(() => router.refresh(), 600);
    } catch (e: any) {
      setMsg(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
      <button className="btn primary" onClick={go} disabled={busy}>
        {busy ? 'Loading…' : 'Load demo data'}
      </button>
      {msg && <div className="ok" style={{ alignSelf: 'stretch' }}>{msg}</div>}
    </div>
  );
}
