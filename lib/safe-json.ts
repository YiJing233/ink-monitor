/**
 * Parse a JSON column defensively. Historically these were silent `{}` fallbacks
 * on parse failure — that hid corrupt rows from ops. We still fall back (the
 * caller usually needs *some* shape so the page renders), but we also emit a
 * `console.warn` tagged with the column it came from so a tail of `safeJson`
 * warnings points at the table that's broken.
 *
 * `label` should be the caller's column/table identifier
 * (e.g. `'dashboards.layouts_json'`) so a log search narrows to one place.
 */
export function safeJson(s: string, label = 'unknown'): unknown {
  try {
    return JSON.parse(s);
  } catch {
    // eslint-disable-next-line no-console
    console.warn(`[safeJson] ${label}: parse failed for ${s.slice(0, 80)}`);
    return {};
  }
}