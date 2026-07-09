'use client';

import { useRef, useState } from 'react';
import { t, type Locale } from '@/lib/i18n';

interface Item {
  src: string;
  caption?: string;
  // F23: present on disk / vercel-blob / s3 store items — the store-internal
  // handle (disk filename, Vercel pathname, S3 key) used to delete the
  // underlying bytes. The `urls` store never sets this (no remote bytes
  // owned by us), which is by design: external URL items are not deletable
  // from here.
  _fileId?: string;
}

export default function AlbumClient({
  album,
  initialItems,
  uploadSupported,
  locale,
}: {
  album: string;
  initialItems: Item[];
  uploadSupported: boolean;
  locale: Locale;
}) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [status, setStatus] = useState('');
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const r = await fetch(`/api/albums/${encodeURIComponent(album)}`);
    const j = await r.json();
    if (r.ok) setItems(j.items || []);
  }

  async function addUrl() {
    if (!url.trim()) return;
    const next = [...items, { src: url.trim(), caption: caption.trim() || undefined }];
    await replaceAll(next);
    setUrl('');
    setCaption('');
  }

  async function remove(idx: number) {
    const it = items[idx];
    // F23: prefer the store-provided `_fileId` over parsing the URL. The
    // disk / vercel-blob / s3 stores all set this; the `urls` store
    // doesn't, since external URLs aren't deletable from the platform.
    if (it._fileId) {
      await fetch(`/api/albums/${encodeURIComponent(album)}/${encodeURIComponent(it._fileId)}`, {
        method: 'DELETE',
      });
    }
    const next = items.filter((_, i) => i !== idx);
    await replaceAll(next);
  }

  async function replaceAll(next: Item[]) {
    const r = await fetch(`/api/albums/${encodeURIComponent(album)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: next }),
    });
    if (r.ok) {
      setItems(next);
      setStatus(t(locale, 'admin.albums.status.saved', { count: next.length }));
    } else {
      setStatus(t(locale, 'admin.albums.status.saveFailed'));
    }
  }

  async function uploadFile(e: React.FormEvent) {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    if (caption.trim()) fd.append('caption', caption.trim());
    const r = await fetch(`/api/albums/${encodeURIComponent(album)}`, { method: 'POST', body: fd });
    const j = await r.json();
    if (r.ok) {
      setStatus(t(locale, 'admin.albums.status.uploaded', { name: f.name }));
      setCaption('');
      if (fileRef.current) fileRef.current.value = '';
      await refresh();
    } else {
      setStatus(t(locale, 'admin.albums.status.uploadFailed', { message: j.error || r.status }));
    }
  }

  return (
    <div>
      <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label className="label">{t(locale, 'admin.albums.label.albumName')}</label>
          <input value={album} disabled style={{ width: '100%' }} />
        </div>
      </div>

      {status && <div className="ok">{status}</div>}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{t(locale, 'admin.albums.section.url.h')}</h3>
        <div className="field">
          <label className="label">{t(locale, 'admin.albums.section.url.label.src')}</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t(locale, 'admin.albums.section.url.placeholder.src')}
            style={{ width: '100%' }}
          />
        </div>
        <div className="field">
          <label className="label">{t(locale, 'admin.albums.section.url.label.caption')}</label>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} style={{ width: '100%' }} />
        </div>
        <button className="btn primary" onClick={addUrl}>
          {t(locale, 'admin.albums.section.url.add')}
        </button>
      </div>

      {uploadSupported && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{t(locale, 'admin.albums.section.upload.h')}</h3>
          <form onSubmit={uploadFile}>
            <div className="field">
              <label className="label">{t(locale, 'admin.albums.section.upload.label.file')}</label>
              <input ref={fileRef} type="file" accept="image/*" />
            </div>
            <div className="field">
              <label className="label">{t(locale, 'admin.albums.section.upload.label.caption')}</label>
              <input value={caption} onChange={(e) => setCaption(e.target.value)} style={{ width: '100%' }} />
            </div>
            <button className="btn primary" type="submit">
              {t(locale, 'admin.albums.section.upload.submit')}
            </button>
          </form>
        </div>
      )}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{t(locale, 'admin.albums.section.list.h', { count: items.length })}</h3>
        {items.length === 0 ? (
          <div className="hint" dangerouslySetInnerHTML={{ __html: t(locale, 'admin.albums.section.list.empty') }} />
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>{t(locale, 'admin.albums.section.list.col.preview')}</th>
                <th>{t(locale, 'admin.albums.section.list.col.source')}</th>
                <th>{t(locale, 'admin.albums.section.list.col.caption')}</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={(it as any)._fileId || it.src}>
                  <td>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.src} alt="" style={{ width: 50, height: 50, objectFit: 'cover', border: '1px solid #000' }} />
                  </td>
                  <td className="eink-mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                    {it.src}
                  </td>
                  <td>{it.caption || ''}</td>
                  <td>
                    <button className="btn danger" onClick={() => remove(i)}>
                      {t(locale, 'admin.albums.section.list.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
