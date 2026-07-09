'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Manifest } from '@/lib/widgets/ir';
import { safeValidateManifest } from '@/lib/widgets/ir';
import { describeCapabilities, requiredSecrets } from '@/lib/widgets/capabilities';
import { EGRESS_UNRESTRICTED } from '@/lib/widgets/registry-meta';
import { isNewer } from '@/lib/widgets/version';
import { t, type Locale } from '@/lib/i18n';

export interface MarketEntry {
  manifest: Manifest;
  category?: string;
  author?: string;
  icon?: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function encodeShare(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}
function decodeShare(s: string): string {
  return decodeURIComponent(escape(atob(s)));
}

export default function MarketClient({
  gallery,
  installedIds,
  locale,
}: {
  gallery: MarketEntry[];
  installedIds: string[];
  locale: Locale;
}) {
  const [installed, setInstalled] = useState<Set<string>>(new Set(installedIds));
  const [installedVersions, setInstalledVersions] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [importText, setImportText] = useState('');
  const [pending, setPending] = useState<{ manifest: Manifest; origin: 'installed' | 'custom' } | null>(null);
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});

  // Discovery filters.
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [showInstalled, setShowInstalled] = useState(true);

  // Pull the user's library to know installed versions.
  useEffect(() => {
    fetch('/api/manifests')
      .then((r) => (r.ok ? r.json() : { manifests: [] }))
      .then((j) => {
        const m: Record<string, string> = {};
        for (const x of j.manifests ?? []) {
          if (x?.manifest?.id && x.manifest.version) m[x.manifest.id] = x.manifest.version;
        }
        setInstalledVersions(m);
      })
      .catch(() => {});
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of gallery) if (e.category) set.add(e.category);
    return Array.from(set).sort();
  }, [gallery]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return gallery.filter((e) => {
      if (category !== 'all' && (e.category || 'other') !== category) return false;
      if (!showInstalled && installed.has(e.manifest.id)) return false;
      if (!q) return true;
      return (
        e.manifest.id.toLowerCase().includes(q) ||
        e.manifest.name.toLowerCase().includes(q) ||
        (e.manifest.description || '').toLowerCase().includes(q) ||
        (e.author || '').toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q)
      );
    });
  }, [gallery, query, category, showInstalled, installed]);

  function beginInstall(manifest: Manifest, origin: 'installed' | 'custom') {
    setStatus('');
    setPending({ manifest, origin });
    setSecretInputs(Object.fromEntries(requiredSecrets(manifest).map((s) => [s, ''])));
  }

  async function confirmInstall() {
    if (!pending) return;
    const { manifest, origin } = pending;
    try {
      for (const [name, value] of Object.entries(secretInputs)) {
        if (value) {
          await fetch('/api/widget-secrets', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name, value }) });
        }
      }
      const r = await fetch('/api/manifests', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ manifest, origin }) });
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : t(locale, 'admin.market.error.installFailed'));
      setInstalled((prev) => new Set(prev).add(manifest.id));
      if (manifest.version) setInstalledVersions((prev) => ({ ...prev, [manifest.id]: manifest.version! }));
      setStatus(t(locale, 'admin.market.status.installed', { name: manifest.name }));
      setPending(null);
    } catch (e: any) {
      setStatus(t(locale, 'admin.market.status.installFailed', { message: e?.message || String(e) }));
    }
  }

  async function uninstall(id: string) {
    try {
      await fetch('/api/manifests/' + encodeURIComponent(id), { method: 'DELETE' });
      setInstalled((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      setInstalledVersions((prev) => {
        const { [id]: _gone, ...rest } = prev;
        return rest;
      });
      setStatus(t(locale, 'admin.market.status.removed', { id }));
    } catch (e: any) {
      setStatus(t(locale, 'admin.market.status.removeFailed', { message: e?.message || String(e) }));
    }
  }

  function doImport() {
    const text = importText.trim();
    if (!text) return;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      try {
        json = JSON.parse(decodeShare(text));
      } catch {
        setStatus(t(locale, 'admin.market.status.parseFailed'));
        return;
      }
    }
    const res = safeValidateManifest(json);
    if (!res.success) {
      setStatus(t(locale, 'admin.market.status.invalidManifest'));
      return;
    }
    beginInstall(res.data, 'custom');
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(t(locale, 'admin.market.status.copied'));
    } catch {
      setStatus(t(locale, 'admin.market.status.copyFailed'));
    }
  }

  return (
    <div>
      {status && (
        <div className="ok" style={{ marginTop: 0 }}>
          {status}
        </div>
      )}

      {/* Discovery toolbar */}
      <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6, flex: 1, minWidth: 220 }}>
          <span className="label" style={{ margin: 0 }}>
            {t(locale, 'admin.market.search.label')}
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(locale, 'admin.market.search.placeholder')}
            style={{ width: '100%' }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="label" style={{ margin: 0 }}>
            {t(locale, 'admin.market.category.label')}
          </span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">{t(locale, 'admin.market.category.all')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={showInstalled} onChange={(e) => setShowInstalled(e.target.checked)} />
          <span className="label" style={{ margin: 0 }}>
            {t(locale, 'admin.market.showInstalled')}
          </span>
        </label>
        <span className="hint" style={{ marginLeft: 'auto' }}>
          {filtered.length} / {gallery.length}
        </span>
      </div>

      {/* Gallery */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {filtered.map((entry) => (
          <GalleryCard
            key={entry.manifest.id}
            entry={entry}
            installed={installed.has(entry.manifest.id)}
            updateAvailable={
              installed.has(entry.manifest.id) && !!entry.manifest.version && isNewer(entry.manifest.version, installedVersions[entry.manifest.id])
            }
            localVersion={installedVersions[entry.manifest.id]}
            onInstall={() => beginInstall(entry.manifest, 'installed')}
            onUpdate={() => beginInstall(entry.manifest, 'installed')}
            onUninstall={() => uninstall(entry.manifest.id)}
            onShare={() => copy(encodeShare(JSON.stringify(entry.manifest)))}
            onCopyJson={() => copy(JSON.stringify(entry.manifest, null, 2))}
            locale={locale}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="hint" style={{ marginTop: 16 }}>
          {t(locale, 'admin.market.empty')}
        </div>
      )}

      {/* Import */}
      <h3 style={{ marginTop: 24 }}>{t(locale, 'admin.market.import.h')}</h3>
      <textarea
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
        placeholder={t(locale, 'admin.market.import.placeholder')}
        rows={4}
        style={{ width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
      />
      <div style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={doImport}>
          {t(locale, 'admin.market.import.parseAndInstall')}
        </button>
      </div>

      {/* Permission prompt */}
      {pending && (
        <PermissionPrompt
          manifest={pending.manifest}
          secretInputs={secretInputs}
          onSecretChange={(name, value) => setSecretInputs((prev) => ({ ...prev, [name]: value }))}
          onConfirm={confirmInstall}
          onCancel={() => setPending(null)}
          locale={locale}
        />
      )}
    </div>
  );
}

function GalleryCard({
  entry,
  installed,
  updateAvailable,
  localVersion,
  onInstall,
  onUpdate,
  onUninstall,
  onShare,
  onCopyJson,
  locale,
}: {
  entry: MarketEntry;
  installed: boolean;
  updateAvailable: boolean;
  localVersion?: string;
  onInstall: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
  onShare: () => void;
  onCopyJson: () => void;
  locale: Locale;
}) {
  const { manifest, icon, category, author } = entry;
  const notices = useMemo(() => describeCapabilities(manifest), [manifest]);
  return (
    <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>
          {icon ? `${icon} ` : ''}
          {manifest.name}
        </strong>
        <span className="pill">{manifest.families.join(' ')}</span>
      </div>
      <div className="row" style={{ gap: 6, fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace' }}>
        {category && <span className="pill">{category}</span>}
        {author && <span style={{ color: '#000' }}>· @{author}</span>}
        {manifest.version && <span>· v{manifest.version}</span>}
        {localVersion && installed && (
          <span style={{ color: '#000' }}>· {t(locale, 'admin.market.card.localVersion', { version: localVersion })}</span>
        )}
        {updateAvailable && (
          <span className="pill" style={{ background: '#000', color: '#fff' }}>
            {t(locale, 'admin.market.card.update')}
          </span>
        )}
      </div>
      {manifest.description && <div style={{ fontSize: 13 }}>{manifest.description}</div>}
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
        {notices.map((n, i) => (
          <li
            key={i}
            style={
              n.kind === EGRESS_UNRESTRICTED
                ? { color: '#b58900', fontWeight: 600 }
                : undefined
            }
          >
            {n.text}
          </li>
        ))}
      </ul>
      <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
        {updateAvailable ? (
          <button className="btn primary" onClick={onUpdate}>
            {t(locale, 'admin.market.card.update')}
          </button>
        ) : installed ? (
          <>
            <span className="pill" style={{ background: '#000', color: '#fff' }}>
              {t(locale, 'admin.market.card.installed')}
            </span>
            <button className="btn danger" onClick={onUninstall}>
              {t(locale, 'admin.market.card.uninstall')}
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={onInstall}>
            {t(locale, 'admin.market.card.install')}
          </button>
        )}
        <button className="btn" onClick={onShare}>
          {t(locale, 'admin.market.card.share')}
        </button>
        <button className="btn" onClick={onCopyJson}>
          {t(locale, 'admin.market.card.copyJson')}
        </button>
      </div>
    </div>
  );
}

function PermissionPrompt({
  manifest,
  secretInputs,
  onSecretChange,
  onConfirm,
  onCancel,
  locale,
}: {
  manifest: Manifest;
  secretInputs: Record<string, string>;
  onSecretChange: (name: string, value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  locale: Locale;
}) {
  const notices = describeCapabilities(manifest);
  const secrets = requiredSecrets(manifest);
  const hasUnrestrictedEgress = notices.some((n) => n.kind === EGRESS_UNRESTRICTED);
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 50,
      }}
      onClick={onCancel}
    >
      <div className="panel" style={{ maxWidth: 460, width: '100%', background: '#fff', margin: 0 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{t(locale, 'admin.market.prompt.h', { name: manifest.name })}</h3>
        {hasUnrestrictedEgress && (
          <div
            role="alert"
            style={{
              background: '#fff7cc',
              border: '2px solid #b58900',
              color: '#3a2900',
              padding: '8px 10px',
              fontSize: 13,
              marginBottom: 8,
            }}
          >
            {t(locale, 'admin.market.prompt.egressWarning')}
          </div>
        )}
        <p style={{ fontSize: 13 }}>{t(locale, 'admin.market.prompt.permissions')}</p>
        <ul style={{ fontSize: 13, paddingLeft: 18 }}>
          {notices.map((n, i) => (
            <li key={i} style={n.kind === EGRESS_UNRESTRICTED ? { color: '#b58900', fontWeight: 600 } : undefined}>
              <strong>{n.kind}</strong> &mdash; {n.text}
            </li>
          ))}
          {notices.length === 0 && <li>{t(locale, 'admin.market.prompt.noAccess')}</li>}
        </ul>
        {secrets.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="label">{t(locale, 'admin.market.prompt.secrets')}</div>
            {secrets.map((s) => (
              <div className="field" key={s}>
                <label className="label">{s}</label>
                <input
                  type="password"
                  value={secretInputs[s] || ''}
                  onChange={(e) => onSecretChange(s, e.target.value)}
                  style={{ width: '100%' }}
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel}>
            {t(locale, 'admin.market.prompt.cancel')}
          </button>
          <button className="btn primary" onClick={onConfirm}>
            {t(locale, 'admin.market.prompt.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
