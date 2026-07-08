/**
 * Client-side EventSource script for /display. Mirrors the e-ink UA detection
 * already in `app/display/soft-refresh.tsx` so the e-ink contract holds:
 *   - e-ink readers (Kindle, 小米, Boox, …) get `<meta http-equiv="refresh">`
 *     and NO EventSource. A long-lived connection would be wasted battery
 *     and a full redraw is what e-ink wants.
 *   - Normal browsers (laptop / phone for "live" debugging) get an
 *     EventSource that:
 *       - On `refresh` event → location.reload()
 *       - On `patch`   event → location.reload() (Phase 1: same as refresh.
 *         A future commit can do a real DOM patch on top of the soft-refresh
 *         `data-w-inst` markers — the server already sends the widgetId.)
 *
 * The script is intentionally inline (no module system, no bundler dep) and
 * survives AdBlock / no-JS environments because it sits at the end of <body>
 * where the e-ink contract never depended on JS in the first place.
 */
import { EINK_UA_PATTERN } from './soft-refresh';

export interface LiveStreamScriptProps {
  /**
   * Share token from the current /display URL — forwarded to the SSE endpoint
   * so the Kindle-scan flow (no session cookie) still authenticates. May be
   * `null` for session-authed users; the browser sends the cookie itself.
   */
  share: string | null;
}

export function LiveStreamScript({ share }: LiveStreamScriptProps) {
  // Build the SSE URL on the server. We escape the share token defensively
  // — the page-level redirect from /admin already validates it, but routing
  // it through encodeURIComponent keeps the script source predictable.
  const qs = share ? `?share=${encodeURIComponent(share)}` : '';
  const src = `/api/display/stream${qs}`;
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
    var es = new EventSource(url);
    // Phase 1: both events trigger a full reload. Keeping the dispatch
    // separate (instead of es.onmessage = reload) means a future commit
    // can branch on event.type and switch the patch event to a real DOM
    // patch without changing the wire protocol.
    es.addEventListener('refresh', function(){ location.reload(); });
    es.addEventListener('patch',   function(){ location.reload(); });
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
