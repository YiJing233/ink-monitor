/**
 * Built-in manifest registry. The JSON files are the canonical examples the
 * `widget` skill points to; loading them through ManifestSchema here proves the
 * schema accepts real manifests (and fails loudly if one drifts out of spec).
 *
 * Client-safe — imported by both the server preview route and the client editor.
 */
import { validateManifest, type Manifest } from './ir';
import apiUsage from './manifests/api-usage.json';
import todoLark from './manifests/todo-lark.json';
import gallery from './manifests/gallery.json';
import stocksTable from './manifests/stocks-table.json';
import clock from './manifests/clock.json';
import countdown from './manifests/countdown.json';
import weather from './manifests/weather.json';
import rss from './manifests/rss.json';
import calendar from './manifests/calendar.json';
import notes from './manifests/notes.json';
import { SAMPLE_DATA } from './manifests/sample-data';

export const BUILTIN_MANIFESTS: Record<string, Manifest> = {
  'api-usage': validateManifest(apiUsage),
  'stocks-table': validateManifest(stocksTable),
  'todo-lark': validateManifest(todoLark),
  gallery: validateManifest(gallery),
  clock: validateManifest(clock),
  countdown: validateManifest(countdown),
  weather: validateManifest(weather),
  rss: validateManifest(rss),
  calendar: validateManifest(calendar),
  notes: validateManifest(notes),
};

export const BUILTIN_LIST: Manifest[] = Object.values(BUILTIN_MANIFESTS);

export { SAMPLE_DATA };

/**
 * Dev-time cross-check: every built-in manifest should have a SAMPLE_DATA
 * entry, otherwise the preview route (`/preview`) renders an empty widget
 * for that manifest. TypeScript can't catch this (it's two unrelated
 * records), so we emit a warning at module load — devs see it in their
 * terminal, CI catches it via `pnpm dev` smoke runs. We intentionally
 * do NOT throw: a stray sample-data omission shouldn't crash production
 * (the worst case is an empty preview tile, which the production /display
 * path doesn't use SAMPLE_DATA for at all).
 */
if (process.env.NODE_ENV !== 'production') {
  for (const id of BUILTIN_LIST.map((m) => m.id)) {
    if (!(id in SAMPLE_DATA)) {
      // eslint-disable-next-line no-console
      console.warn(`[registry] missing SAMPLE_DATA for "${id}"`);
    }
  }
}

export function getManifest(id: string): Manifest | undefined {
  return BUILTIN_MANIFESTS[id];
}
