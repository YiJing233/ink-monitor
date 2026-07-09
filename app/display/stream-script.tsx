/**
 * Client-side EventSource script for /display. Mirrors the e-ink UA detection
 * already in `app/display/soft-refresh.tsx` so the e-ink contract holds:
 *   - e-ink readers (Kindle, 小米, Boox, …) get `<meta http-equiv="refresh">`
 *     and NO EventSource. A long-lived connection would be wasted battery
 *     and a full redraw is what e-ink wants.
 *   - Normal browsers (laptop / phone for "live" debugging) get an
 *     EventSource that:
 *       - On `refresh` event → location.reload() (heartbeat / fallback path;
 *         covers anything the partial-patcher doesn't know how to replace).
 *       - On `patch`   event → fetch /api/display/widget?instance=<id>
 *         and replace the corresponding `[data-w-inst="<id>"]` node in the
 *         live DOM via outerHTML. Legacy provider/stock patches (the SSE
 *         emits `provider:<id>` / `stock:<id>` for those — they have no
 *         DOM marker) get the same `fetch + outerHTML` attempt; a 404
 *         gracefully falls back to `location.reload()`.
 *
 * The partial-patch model is intentionally coarse: the server returns the
 * SAME wrapper element the canvas emits (`<div data-w-inst>…</div>`, no
 * `data-display-root` around it) so `outerHTML = html` keeps the locator key
 * intact. We use outerHTML, not innerHTML, so the absolute-positioned style
 * + data-w-inst attribute land back on the same node the SSE used to find it.
 *
 * The script is intentionally inline (no module system, no bundler dep) and
 * survives AdBlock / no-JS environments because it sits at the end of <body>
 * where the e-ink contract never depended on JS in the first place.
 */
import { EINK_UA_PATTERN } from './soft-refresh';

export interface LiveStreamScriptProps {
  /**
   * Share token from the current /display URL — forwarded to the SSE endpoint
   * and to the per-widget fetch so the Kindle-scan flow (no session cookie)
   * still authenticates. May be `null` for session-authed users; the browser
   * sends the cookie itself.
   */
  share: string | null;
}

export function LiveStreamScript({ share }: LiveStreamScriptProps) {
  // Build the SSE URL on the server. We escape the share token defensively
  // — the page-level redirect from /admin already validates it, but routing
  // it through encodeURIComponent keeps the script source predictable.
  const qs = share ? `?share=${encodeURIComponent(share)}` : '';
  const src = `/api/display/stream${qs}`;
  // Per-widget fetch URL needs the same share token. Re-quote every time we
  // issue the request so a stale captured value can't outlast a token rotate.
  const widgetBase = `/api/display/widget`;
  const shareTokenJson = JSON.stringify(share ?? null);
  return (
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: `(function(){
  try {
    var ua = navigator.userAgent || '';
    var isEink = ${EINK_UA_PATTERN.toString()}.test(ua);
    if (isEink) return;
    if (typeof window === 'undefined') return;
    if (typeof EventSource === 'undefined') return;
    var url = ${JSON.stringify(src)};
    var widgetBase = ${JSON.stringify(widgetBase)};
    var shareToken = ${shareTokenJson};
    function withShare(qs) {
      return shareToken ? (qs + (qs.indexOf('?') === -1 ? '?' : '&') + 'share=' + encodeURIComponent(shareToken)) : qs;
    }
    function attrEscape(s) {
      // CSS attribute-selector escaping: backslash-escape quotes and
      // backslashes so a placement id containing a literal " can't
      // break out of the selector.
      return String(s).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
    }
    var es = new EventSource(url);
    // refresh = heartbeat. Either keep the connection warm or — for older
    // code paths that couldn't partial-patch — recover from any drift. Cheap
    // to reload here because the request happens at most once per 15s.
    es.addEventListener('refresh', function(){ try { location.reload(); } catch (e) { /* swallow */ } });
    // patch = a single widget tile's refresh period just elapsed. Try to
    // partial-patch in place; on any failure (network, 404 for a legacy
    // instance id, no matching data-w-inst node) fall back to a full reload
    // so we never leave the page in a stale state.
    es.addEventListener('patch', function(e){
      try {
        var raw = (e && e.data) != null ? String(e.data) : '{}';
        var payload;
        try { payload = JSON.parse(raw); } catch (_) { payload = {}; }
        var instanceId = payload && payload.instanceId;
        if (!instanceId) { location.reload(); return; }
        var widgetUrl = withShare(widgetBase + '?instance=' + encodeURIComponent(instanceId));
        fetch(widgetUrl, { cache: 'no-store', headers: { 'Accept': 'text/html' } })
          .then(function(res){
            if (!res.ok) { location.reload(); return null; }
            return res.text();
          })
          .then(function(html){
            if (html == null) return;
            var sel = '[data-w-inst="' + attrEscape(instanceId) + '"]';
            var node = document.querySelector(sel);
            if (!node) { location.reload(); return; }
            // outerHTML (not innerHTML) so the absolute-positioned wrapper
            // + data-w-inst key land back on the same element the SSE used
            // to find this tile. The server already returned exactly that
            // wrapper shape (see /api/display/widget/route.ts).
            node.outerHTML = html;
          })
          .catch(function(){ try { location.reload(); } catch (_) { /* swallow */ } });
      } catch (_) { try { location.reload(); } catch (__) { /* swallow */ } }
    });
    // Surface connection errors in dev; the browser's auto-reconnect
    // handles the rest.
    es.addEventListener('error', function(){
      try { es.close(); } catch (e) { /* swallow */ }
    });
  } catch (e) { /* swallow — meta refresh is the fallback */ }
})();`,
      }}
    />
  );
}
