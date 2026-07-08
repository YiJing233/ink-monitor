/**
 * JSONPath-lite extraction for declarative `http` sources. Supports dotted
 * paths, `[n]` indices, and a `[*]` wildcard that maps over an array. Used to
 * normalize a raw API response into the flat object a manifest's binds read.
 *
 *   selectPath(json, 'data.items')        -> json.data.items
 *   selectPath(json, 'list[0].main.temp') -> json.list[0].main.temp
 *   selectPath(json, 'list[*].main.temp') -> [ ...each item's main.temp ]
 *
 * Client-safe (pure).
 */
export function selectPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const norm = path.replace(/\[(\d+)\]/g, '.$1').replace(/\[\*\]/g, '.*');
  const tokens = norm.split('.').filter(Boolean);
  return walk(obj, tokens);
}

function walk(cur: unknown, tokens: string[]): unknown {
  if (cur == null) return undefined;
  if (tokens.length === 0) return cur;
  const [t, ...rest] = tokens;
  if (t === '*') {
    if (!Array.isArray(cur)) return undefined;
    return cur.map((item) => walk(item, rest));
  }
  return walk((cur as Record<string, unknown>)[t], rest);
}

/** Apply a manifest's `select` map (outputKey -> JSONPath) to a raw response. */
export function applySelect(raw: unknown, select?: Record<string, string>): unknown {
  if (!select) return raw;
  const out: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(select)) out[key] = selectPath(raw, p);
  return out;
}
