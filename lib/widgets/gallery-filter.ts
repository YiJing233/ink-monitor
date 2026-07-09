/**
 * Pure filter / categorization helpers for the public `/widgets` gallery.
 *
 * Kept separate from the page (and from `MarketEntry`) so the gallery's
 * search + category chips can be unit-tested without React. Everything here
 * is client-safe — `BUILTIN_LIST` is server-safe (no `server-only` imports)
 * and these helpers take a plain entry shape.
 */
import { BUILTIN_LIST } from './registry';
import type { Manifest } from './ir';

/**
 * One row in the public gallery. We accept an optional `category` /
 * `author` / `icon` field on the entry because the curated remote registry
 * at `/api/market` decorates each manifest with those (see
 * `lib/widgets/registry-meta.ts#RegistryItemSchema`); built-ins leave them
 * unset and let `categoryOf()` derive the category from the manifest's
 * `source.kind` so the chips reflect a real facet of the IR (http / builtin
 * / owned / asset / album) rather than a single "builtin" bucket.
 */
export interface GalleryEntry {
  manifest: Manifest;
  category?: string;
  author?: string;
  icon?: string;
}

/** Resolve the chip category for an entry. */
export function categoryOf(entry: GalleryEntry): string {
  return entry.category || entry.manifest.source.kind;
}

/** Distinct categories present in a gallery list, sorted alphabetically. */
export function listCategories(items: GalleryEntry[]): string[] {
  const set = new Set<string>();
  for (const it of items) set.add(categoryOf(it));
  return Array.from(set).sort();
}

/**
 * Filter by free-text query + category. Query is case-insensitive and
 * matches id / name / description / category. Empty / whitespace query is
 * a pass-through. `'all'` (or undefined) category is also a pass-through.
 */
export function filterGallery(
  items: GalleryEntry[],
  opts: { query?: string; category?: string }
): GalleryEntry[] {
  const q = (opts.query || '').trim().toLowerCase();
  const cat = opts.category && opts.category !== 'all' ? opts.category : '';
  return items.filter((it) => {
    if (cat && categoryOf(it) !== cat) return false;
    if (!q) return true;
    return (
      it.manifest.id.toLowerCase().includes(q) ||
      it.manifest.name.toLowerCase().includes(q) ||
      (it.manifest.description || '').toLowerCase().includes(q) ||
      categoryOf(it).toLowerCase().includes(q)
    );
  });
}

/** Every built-in manifest as a gallery row (no category override). */
export function builtinsAsGallery(): GalleryEntry[] {
  return BUILTIN_LIST.map((m) => ({ manifest: m }));
}