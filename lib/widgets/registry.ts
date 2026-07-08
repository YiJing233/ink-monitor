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
import { SAMPLE_DATA } from './manifests/sample-data';

export const BUILTIN_MANIFESTS: Record<string, Manifest> = {
  'api-usage': validateManifest(apiUsage),
  'stocks-table': validateManifest(stocksTable),
  'todo-lark': validateManifest(todoLark),
  gallery: validateManifest(gallery),
  clock: validateManifest(clock),
  countdown: validateManifest(countdown),
};

export const BUILTIN_LIST: Manifest[] = Object.values(BUILTIN_MANIFESTS);

export { SAMPLE_DATA };

export function getManifest(id: string): Manifest | undefined {
  return BUILTIN_MANIFESTS[id];
}
