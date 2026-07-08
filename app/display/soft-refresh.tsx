/**
 * Soft-refresh script: on capable browsers, fetch the current URL and patch
 * the DOM in place instead of a full reload. On e-ink browsers (Kindle
 * experimental, Xiaomi reader, Boox, …) the script no-ops so the existing
 * <meta http-equiv="refresh"> does its job — a full-screen reflash is what
 * e-ink wants.
 *
 * Works against ANY content that has [data-display-root] + per-instance nodes
 * with [data-w-inst] (or the legacy provider/stock markers). For each marked
 * node, we replace its innerHTML from the matching node in the freshly fetched
 * document. Coarse but primitive-agnostic — no per-field markup required.
 */

/**
 * Heuristic regex for e-ink reader user-agents. A full allow/deny list is
 * inherently fragile (vendors change UA strings silently, new devices ship
 * under a new label) — this is a best-effort filter. The fallback is the
 * `<meta http-equiv="refresh">` already in the page, so a false negative
 * (we treat an e-ink browser as a normal one) just causes some wasted
 * partial-refresh attempts before the next full reload, not data loss.
 *
 * Covering the long tail: Kindle (incl. Silk-prefixed variants), Kobo
 * (Libra / Clara / Sage / Elipsa), PocketBook, Barnes & Noble Nook, Onyx
 * BOOX (matches both "BOOX" and the "Onyx" parent brand), Xiaomi / Mi
 * Reader, and the Chinese-market Hyread Gaze. EBRD / INet are older ink
 * firmware tokens we've seen in the wild.
 */
export const EINK_UA_PATTERN = /Kindle|Silk\/|Kobo|PocketBook|Nook|Onyx|Boox|Xiaomi|MiReader|EBRD|INet|Hyread/i;

/**
 * Minimal shape required for the patch step. Keeps the test surface free of
 * a full DOM library (jsdom/happy-dom aren't installed) — anything with these
 * five members is enough. Matches the DOM `Element` API on the methods we use.
 */
export type DisplayNode = {
  querySelector(sel: string): DisplayNode | null;
  querySelectorAll(sel: string): DisplayNode[];
  getAttribute(name: string): string | null;
  innerHTML: string;
  textContent: string | null;
};

/**
 * Patch the live [data-display-root] in place from a freshly fetched copy.
 *
 * Bug history: the original inline script built the lookup selector by
 *   `sel.split('').slice(0,6).join('')` which always returns `[data-`,
 *   yielding `[data-="key"]` — a selector that never matched. Extracted here
 *   so it can be unit-tested with a fake DOM, and reused by the browser via
 *   `Function.prototype.toString()` inlining.
 */
export function patchDisplayRoot(oldRoot: DisplayNode, newRoot: DisplayNode): void {
  // Header (legacy): copy the timestamp text node if both docs have one.
  const oldUpdated = oldRoot.querySelector('[data-updated-at]');
  const newUpdated = newRoot.querySelector('[data-updated-at]');
  if (oldUpdated && newUpdated) oldUpdated.textContent = newUpdated.textContent;

  // Generic instance replacement: any [data-w-inst] in the new doc replaces
  // the matching instance in the old doc. Also handles [data-pid] /
  // [data-symbol] from the legacy provider/stock view for backward compat.
  // Each selector owns its key attribute — no `||` chain, no wasted lookups.
  const groups = [
    { sel: '[data-w-inst]', attr: 'data-w-inst' },
    { sel: '[data-pid]', attr: 'data-pid' },
    { sel: '[data-symbol]', attr: 'data-symbol' },
  ];
  for (const g of groups) {
    const nodes = newRoot.querySelectorAll(g.sel);
    for (const newNode of nodes) {
      const key = newNode.getAttribute(g.attr);
      if (!key) continue;
      // Strip the closing bracket from the presence selector, then attach
      // the key as `="key"`. Joining naively (`[data-w-inst]` + `="i0"]`)
      // would produce `[data-w-inst]="i0"]` — two attributes, no value —
      // which silently never matches. That was the original bug.
      const oldNode = oldRoot.querySelector(g.sel.slice(0, -1) + '="' + key.replace(/"/g, '\\"') + '"]');
      if (oldNode) oldNode.innerHTML = newNode.innerHTML;
    }
  }
}

export function SoftRefreshScript({ intervalSec }: { intervalSec: number }) {
  // The browser receives the patch body as a plain string — no module system.
  // Serialize the named function source so both the runtime and the test
  // suite share a single source of truth for the replacement logic.
  const patchSrc = patchDisplayRoot.toString();
  return (
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: `(function(){
  try {
    var ua = navigator.userAgent || '';
    var isEink = /Kindle|Silk\\/|Kobo|PocketBook|Nook|Onyx|Boox|Xiaomi|MiReader|EBRD|INet|Hyread/i.test(ua);
    if (isEink) return;
    if (!window.fetch || !window.IntersectionObserver) return;
    var interval = ${intervalSec * 1000};
    var REFRESH_URL = location.pathname + (location.search||'');
    function $(sel, root){ return (root||document).querySelector(sel); }
    function $$(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
    var __patch = ${patchSrc};
    async function tick(){
      try {
        var r = await fetch(REFRESH_URL, { cache: 'no-store', headers: { 'X-Soft-Refresh': '1' } });
        if (!r.ok) { location.reload(); return; }
        var html = await r.text();
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var newRoot = doc.querySelector('[data-display-root]');
        var oldRoot = document.querySelector('[data-display-root]');
        if (!newRoot || !oldRoot) { location.reload(); return; }
        __patch(oldRoot, newRoot);
      } catch (e) { location.reload(); }
    }
    setTimeout(tick, interval);
    setInterval(tick, interval);
  } catch(e) { /* swallow — meta refresh is the fallback */ }
})();`,
      }}
    />
  );
}