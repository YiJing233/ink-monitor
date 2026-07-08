/**
 * JSONPath-lite extraction for declarative `http` sources. Supports dotted
 * paths, `[n]` indices, `[*]` (alias `[@]`) wildcards that map over an array,
 * and a `length` token (top-level or `.length` after any node) that returns
 * the length of an array or string.
 *
 *   selectPath(json, 'data.items')        -> json.data.items
 *   selectPath(json, 'list[0].main.temp') -> json.list[0].main.temp
 *   selectPath(json, 'list[*].main.temp') -> [ ...each item's main.temp ]
 *   selectPath(json, 'list.length')       -> list.length
 *   selectPath(arr,  '[*].title')         -> [title, title, ...] (when root is array)
 *   selectPath(arr,  'length')            -> arr.length
 *
 * Client-safe (pure).
 */
export function selectPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  // Normalize: [n] -> .n, [*] / [@] -> .*
  const norm = path
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\[\*\]/g, '.*')
    .replace(/\[@\]/g, '.*');
  const tokens = norm.split('.').filter((t) => t !== '');
  return walk(obj, tokens);
}

// Tokens that walk the prototype chain or return constructors; explicitly
// rejected so a JSON response carrying a "__proto__" payload can't leak
// Object.prototype or pollute the IR. (F11)
const FORBIDDEN_TOKENS = new Set(['__proto__', 'constructor', 'prototype']);

function walk(cur: unknown, tokens: string[]): unknown {
  if (cur == null) return undefined;
  if (tokens.length === 0) return cur;
  const [t, ...rest] = tokens;
  // Refuse prototype-chain / constructor lookups: a hostile JSON body like
  // {"__proto__":{"secret":"x"}} must not let `__proto__` resolve to
  // Object.prototype (or to `constructor.prototype`), which would either
  // leak inherited keys or poison downstream objects via prototype writes.
  if (FORBIDDEN_TOKENS.has(t)) return undefined;
  // Element wildcard: map over an array.
  if (t === '*') {
    if (!Array.isArray(cur)) return undefined;
    return cur.map((item) => walk(item, rest));
  }
  // Length: number for an array or string.
  if (t === 'length') {
    if (Array.isArray(cur)) return cur.length;
    if (typeof cur === 'string') return cur.length;
    return undefined;
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
