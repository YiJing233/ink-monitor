'use client';

import { useEffect, useState } from 'react';
import { PROVIDER_LABELS, PROVIDER_DEFAULTS } from '@/lib/providers/labels';
import { checkProviderTtl } from '@/lib/ttl';

interface Provider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'custom' | 'demo' | 'groq' | 'mistral' | 'deepseek' | 'moonshot' | 'zhipu' | 'openrouter' | 'ollama';
  base_url: string | null;
  endpoint: string | null;
  json_path: string | null;
  refresh_seconds: number | null;
  has_key: boolean;
  api_key_masked: string;
}

const DEFAULTS: Record<Provider['type'], { base_url: string; endpoint: string; json_path: string }> = {
  openai: { base_url: 'https://api.openai.com', endpoint: '/v1/usage', json_path: '' },
  anthropic: { base_url: 'https://api.anthropic.com', endpoint: '/v1/messages', json_path: '' },
  custom: { base_url: '', endpoint: '/v1/usage', json_path: 'data.used' },
  demo: { base_url: '', endpoint: '', json_path: '' },
  groq: PROVIDER_DEFAULTS.groq,
  mistral: PROVIDER_DEFAULTS.mistral,
  deepseek: PROVIDER_DEFAULTS.deepseek,
  moonshot: PROVIDER_DEFAULTS.moonshot,
  zhipu: PROVIDER_DEFAULTS.zhipu,
  openrouter: PROVIDER_DEFAULTS.openrouter,
  ollama: PROVIDER_DEFAULTS.ollama,
} as Record<Provider['type'], { base_url: string; endpoint: string; json_path: string }>;

import { PROVIDER_TTL } from '@/lib/ttl';
function recommendedForType(t: Provider['type']): number {
  return PROVIDER_TTL[t]?.recommended ?? 60;
}

export default function ProvidersAdmin() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/providers', { cache: 'no-store' });
      const j = await r.json();
      setProviders(j.providers || []);
    } catch (e: any) {
      setErr(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function move(id: string, direction: 'up' | 'down') {
    await fetch(`/api/providers/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', direction }),
    });
    load();
  }

  return (
    <>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Add provider</h2>
        <ProviderForm onAdded={load} />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Configured ({providers.length})</h2>
        {err && <div className="err">{err}</div>}
        {loading ? <p>Loading…</p> : providers.length === 0 ? (
          <p>No providers yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Endpoint</th>
                <th>Refresh</th>
                <th>API key</th>
                <th>Order</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p, i) => {
                const ttl = checkProviderTtl(p.type, p.refresh_seconds, 60);
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td><span className="pill">{PROVIDER_LABELS[p.type] || p.type}</span></td>
                    <td>
                      <code style={{ fontSize: 11 }}>
                        {p.base_url || '—'}{p.endpoint || ''}
                      </code>
                    </td>
                    <td>
                      <span className="pill">{p.refresh_seconds ? `${p.refresh_seconds}s` : 'default'}</span>
                      {ttl.severity === 'warn' && (
                        <span className="pill" title={ttl.message} style={{ marginLeft: 4, fontSize: 11 }}>
                          ⚠ {ttl.message}
                        </span>
                      )}
                      {ttl.severity === 'danger' && (
                        <span className="pill" title={ttl.message} style={{ marginLeft: 4, fontSize: 11, fontWeight: 700, background: '#000', color: '#fff' }}>
                          ⛔ {ttl.message}
                        </span>
                      )}
                    </td>
                    <td><span className="pill">{p.api_key_masked}</span></td>
                    <td>
                      <button className="btn" onClick={() => move(p.id, 'up')} disabled={i === 0} aria-label="move up">↑</button>{' '}
                      <button className="btn" onClick={() => move(p.id, 'down')} disabled={i === providers.length - 1} aria-label="move down">↓</button>
                    </td>
                    <td>
                      <button
                        className="btn danger"
                        onClick={async () => {
                          if (!confirm(`Delete ${p.name}?`)) return;
                          await fetch(`/api/providers/${p.id}`, { method: 'DELETE' });
                          load();
                        }}
                      >Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ProviderForm({ onAdded }: { onAdded: () => void }) {
  const [type, setType] = useState<Provider['type']>('openai');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULTS.openai.base_url);
  const [endpoint, setEndpoint] = useState(DEFAULTS.openai.endpoint);
  const [jsonPath, setJsonPath] = useState(DEFAULTS.openai.json_path);
  const [refresh, setRefresh] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function applyDefaults(t: Provider['type']) {
    setType(t);
    setBaseUrl(DEFAULTS[t].base_url);
    setEndpoint(DEFAULTS[t].endpoint);
    setJsonPath(DEFAULTS[t].json_path);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    if (!name.trim() || !apiKey.trim()) {
      setErr('Name and API key are required');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type,
          api_key: apiKey.trim(),
          base_url: baseUrl.trim() || null,
          endpoint: endpoint.trim() || null,
          json_path: jsonPath.trim() || null,
          refresh_seconds: refresh.trim() ? Number(refresh) : null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ? JSON.stringify(j.error) : 'Failed');
      setOk(`Added "${name}"`);
      setName('');
      setApiKey('');
      setRefresh('');
      onAdded();
    } catch (e: any) {
      setErr(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        {(['openai', 'anthropic', 'groq', 'mistral', 'deepseek', 'moonshot', 'zhipu', 'openrouter', 'ollama', 'custom', 'demo'] as const).map((t) => (
          <label key={t} className="row" style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="type"
              checked={type === t}
              onChange={() => applyDefaults(t)}
              style={{ width: 16, height: 16 }}
            />
            <span>{PROVIDER_LABELS[t]}</span>
          </label>
        ))}
      </div>

      <div className="field">
        <label className="label">Display name</label>
        <input
          style={{ width: '100%', maxWidth: 360 }}
          placeholder={type === 'openai' ? 'My OpenAI org' : type === 'anthropic' ? 'Claude work' : type === 'demo' ? 'Demo plan' : 'My MiniMax'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {type !== 'demo' && (
        <div className="field">
          <label className="label">API key</label>
          <input
            type="password"
            style={{ width: '100%', maxWidth: 480 }}
            placeholder="sk-... or equivalent"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="hint">Stored encrypted with AES-256-GCM at rest.</div>
        </div>
      )}

      {type === 'demo' && (
        <div className="hint" style={{ marginBottom: 12 }}>
          Demo provider returns canned, time-varying data. No API key needed.
        </div>
      )}

      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 280px' }}>
          <label className="label">Base URL</label>
          <input
            style={{ width: '100%' }}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com"
          />
        </div>
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label className="label">Endpoint path</label>
          <input
            style={{ width: '100%' }}
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="/v1/usage"
          />
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label className="label">Refresh (s)</label>
          <input
            type="number"
            min={15}
            max={86400}
            style={{ width: '100%' }}
            value={refresh}
            onChange={(e) => setRefresh(e.target.value)}
            placeholder="global"
          />
          <div className="hint">
            Optional. Recommended ≥ {recommendedForType(type)}s for {PROVIDER_LABELS[type]}.
          </div>
        </div>
      </div>

      {type === 'custom' && (
        <div className="field">
          <label className="label">JSON paths (used | limit | reset)</label>
          <input
            style={{ width: '100%', maxWidth: 480 }}
            value={jsonPath}
            onChange={(e) => setJsonPath(e.target.value)}
            placeholder="data.used | data.limit | data.reset_at"
          />
          <div className="hint">
            Pipe-separated: path 1 = used value, path 2 = limit, path 3 = reset (epoch s/ms or ISO string).
          </div>
        </div>
      )}

      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add provider'}
      </button>
    </form>
  );
}
