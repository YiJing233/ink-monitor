'use client';

/**
 * Client island for the public /widgets gallery. The server component
 * (`page.tsx`) hands us a flat list of entries plus the sign-in flag;
 * we render the search box, category chips, and the card grid. Filtering
 * is purely client-side (the data is already in memory) so the user sees
 * results as they type.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  categoryOf,
  filterGallery,
  listCategories,
  type GalleryEntry,
} from '@/lib/widgets/gallery-filter';

export default function GalleryClient({
  entries,
  signedIn,
}: {
  entries: GalleryEntry[];
  signedIn: boolean;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');

  const categories = useMemo(() => listCategories(entries), [entries]);
  const filtered = useMemo(() => filterGallery(entries, { query, category }), [entries, query, category]);

  const installHref = signedIn ? '/admin/market' : '/signin?callbackUrl=/admin/market';

  return (
    <>
      <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6, flex: 1, minWidth: 220 }}>
          <span className="label" style={{ margin: 0 }}>
            搜索
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名称、说明、ID…"
            style={{ width: '100%' }}
            data-testid="gallery-search"
          />
        </label>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} data-testid="gallery-categories">
          <span className="label" style={{ margin: 0 }}>
            分类
          </span>
          <CategoryChip value="all" active={category === 'all'} onClick={() => setCategory('all')}>
            全部
          </CategoryChip>
          {categories.map((c) => (
            <CategoryChip
              key={c}
              value={c}
              active={category === c}
              onClick={() => setCategory(c)}
              data-testid={`gallery-cat-${c}`}
            >
              {c}
            </CategoryChip>
          ))}
        </div>
        <span className="hint" style={{ marginLeft: 'auto' }} data-testid="gallery-count">
          {filtered.length} / {entries.length}
        </span>
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}
        data-testid="gallery-grid"
      >
        {filtered.map((entry) => (
          <GalleryCard key={entry.manifest.id} entry={entry} installHref={installHref} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="hint" style={{ marginTop: 16 }}>
          没有匹配的组件。
        </div>
      )}
    </>
  );
}

function CategoryChip({
  value,
  active,
  onClick,
  children,
  ...rest
}: {
  value: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  [key: string]: unknown;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? 'true' : 'false'}
      data-cat={value}
      style={{
        border: '2px solid #000',
        background: active ? '#000' : '#fff',
        color: active ? '#fff' : '#000',
        padding: '4px 10px',
        font: 'inherit',
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function GalleryCard({
  entry,
  installHref,
}: {
  entry: GalleryEntry;
  installHref: string;
}) {
  const { manifest, icon, author } = entry;
  const cat = categoryOf(entry);
  return (
    <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid={`gallery-card-${manifest.id}`}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>
          {icon ? `${icon} ` : ''}
          {manifest.name}
        </strong>
        <span className="pill">{manifest.families.join(' ')}</span>
      </div>
      <div className="row" style={{ gap: 6, fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace' }}>
        <span className="pill" data-testid={`gallery-card-${manifest.id}-category`}>
          {cat}
        </span>
        {author && <span>· @{author}</span>}
        {manifest.version && <span>· v{manifest.version}</span>}
      </div>
      {manifest.description && <div style={{ fontSize: 13 }}>{manifest.description}</div>}
      <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
        <Link
          className="btn primary"
          href={`/preview?demo=${encodeURIComponent(manifest.id)}`}
          target="_blank"
          rel="noreferrer"
          data-testid={`gallery-card-${manifest.id}-preview`}
        >
          Preview
        </Link>
        <Link
          className="btn"
          href={`/widgets/${encodeURIComponent(manifest.id)}`}
          data-testid={`gallery-card-${manifest.id}-detail`}
        >
          View manifest
        </Link>
        <Link className="btn" href={installHref} style={{ marginLeft: 'auto' }}>
          Install
        </Link>
      </div>
    </div>
  );
}