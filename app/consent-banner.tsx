'use client';

import { useEffect, useState } from 'react';

const COOKIE = 'NEXT_COOKIE_CONSENT';

type Consent = 'accepted' | 'essential-only' | null;

export function ConsentBanner() {
  const [consent, setConsent] = useState<Consent>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const c = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
    if (c) {
      setConsent(c[1] as Consent);
      setVisible(false);
    } else {
      setVisible(true);
    }
  }, []);

  function set(value: Consent) {
    document.cookie = `${COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 180}; SameSite=Lax`;
    setConsent(value);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 9999,
        background: '#fff',
        border: '2px solid #000',
        padding: 14,
        maxWidth: 720,
        margin: '0 auto',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 6 }}>Cookies on ink-monitor</strong>
      <p style={{ margin: '0 0 10px' }}>
        We use only <em>essential</em> cookies: your session (signed JWT) and
        your language preference. We do <strong>not</strong> set analytics or
        advertising cookies.
      </p>
      <p style={{ margin: '0 0 10px', fontSize: 12 }}>
        See <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => set('essential-only')}>
          Essential only
        </button>
        <button className="btn primary" onClick={() => set('accepted')}>
          Accept
        </button>
      </div>
    </div>
  );
}
