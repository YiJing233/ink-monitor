'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Manifest } from '@/lib/widgets/ir';
import { safeValidateManifest } from '@/lib/widgets/ir';
import { describeCapabilities, requiredSecrets } from '@/lib/widgets/capabilities';
import { isNewer } from '@/lib/widgets/version';

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

export default function MarketClient({ gallery, installedIds }: { gallery: MarketEntry[]; installedIds: string[] }) {
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
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : '安装失败');
      setInstalled((prev) => new Set(prev).add(manifest.id));
      if (manifest.version) setInstalledVersions((prev) => ({ ...prev, [manifest.id]: manifest.version! }));
      setStatus(`已安装 ${manifest.name}`);
      setPending(null);
    } catch (e: any) {
      setStatus('安装失败: ' + (e?.message || String(e)));
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
      setStatus(`已移除 ${id}`);
    } catch (e: any) {
      setStatus('移除失败: ' + (e?.message || String(e)));
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
        setStatus('无法解析：请粘贴 manifest JSON 或分享码');
        return;
      }
    }
    const res = safeValidateManifest(json);
    if (!res.success) {
      setStatus('manifest 不合法（不符合 IR schema）');
      return;
    }
    beginInstall(res.data, 'custom');
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('已复制到剪贴板');
    } catch {
      setStatus('复制失败');
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
            搜索
          </span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名称、作者、ID…" style={{ width: '100%' }} />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="label" style={{ margin: 0 }}>
            分类
          </span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">全部</option>
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
            显示已安装
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
          />
        ))}
      </div>

      {filtered.length === 0 && <div className="hint" style={{ marginTop: 16 }}>没有匹配的组件。</div>}

      {/* Import */}
      <h3 style={{ marginTop: 24 }}>从分享码 / JSON 导入</h3>
      <textarea
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
        placeholder="粘贴 manifest JSON 或分享码…"
        rows={4}
        style={{ width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
      />
      <div style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={doImport}>
          解析并安装
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
        {localVersion && installed && <span style={{ color: '#000' }}>· 本地 v{localVersion}</span>}
        {updateAvailable && (
          <span className="pill" style={{ background: '#000', color: '#fff' }}>
            可更新
          </span>
        )}
      </div>
      {manifest.description && <div style={{ fontSize: 13 }}>{manifest.description}</div>}
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
        {notices.map((n, i) => (
          <li key={i}>{n.text}</li>
        ))}
      </ul>
      <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
        {updateAvailable ? (
          <button className="btn primary" onClick={onUpdate}>
            更新
          </button>
        ) : installed ? (
          <>
            <span className="pill" style={{ background: '#000', color: '#fff' }}>
              已安装
            </span>
            <button className="btn danger" onClick={onUninstall}>
              移除
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={onInstall}>
            安装
          </button>
        )}
        <button className="btn" onClick={onShare}>
          分享码
        </button>
        <button className="btn" onClick={onCopyJson}>
          复制 JSON
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
}: {
  manifest: Manifest;
  secretInputs: Record<string, string>;
  onSecretChange: (name: string, value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const notices = describeCapabilities(manifest);
  const secrets = requiredSecrets(manifest);
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
        <h3 style={{ marginTop: 0 }}>安装「{manifest.name}」？</h3>
        <p style={{ fontSize: 13 }}>该组件将获得以下权限：</p>
        <ul style={{ fontSize: 13, paddingLeft: 18 }}>
          {notices.map((n, i) => (
            <li key={i}>
              <strong>{n.kind}</strong> &mdash; {n.text}
            </li>
          ))}
          {notices.length === 0 && <li>无外部访问，无需密钥。</li>}
        </ul>
        {secrets.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="label">填写所需密钥（留空可稍后在设置里补）</div>
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
            取消
          </button>
          <button className="btn primary" onClick={onConfirm}>
            确认安装
          </button>
        </div>
      </div>
    </div>
  );
}
