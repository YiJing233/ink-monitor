'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';

export default function SignInPageWrapper() {
  return (
    <Suspense fallback={<div className="admin"><h1>Sign in</h1></div>}>
      <SignInPage />
    </Suspense>
  );
}

function SignInPage() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get('callbackUrl') || '/admin';
  const { data: session, status } = useSession();
  const [devEmail, setDevEmail] = useState('demo@local');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authenticated') {
      router.push(callbackUrl);
    }
  }, [status, callbackUrl, router]);

  async function githubSignIn() {
    setErr(null);
    setBusy(true);
    try {
      await signIn('github', { callbackUrl });
    } catch (e: any) {
      setErr(e?.message || 'Sign-in failed');
      setBusy(false);
    }
  }

  async function devSignIn() {
    setErr(null);
    setBusy(true);
    try {
      const r = await signIn('dev', { email: devEmail, redirect: false, callbackUrl });
      if (r?.error) throw new Error(r.error);
      router.push(callbackUrl);
    } catch (e: any) {
      setErr(e?.message || 'Sign-in failed');
      setBusy(false);
    }
  }

  return (
    <div className="admin" style={{ maxWidth: 480 }}>
      <h1>Sign in</h1>
      <p>Your dashboard and your API keys live behind this account.</p>

      <div className="panel">
        <button
          className="btn primary"
          style={{ width: '100%', fontSize: 16, padding: '12px 16px' }}
          onClick={githubSignIn}
          disabled={busy}
        >
          ⌥  Sign in with GitHub
        </button>
        <p className="hint" style={{ marginTop: 8 }}>
          Recommended. We use your GitHub id only to identify your dashboard —
          no email access, no repo access.
        </p>
      </div>

      {process.env.NODE_ENV !== 'production' && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Dev login (local only)</h2>
          <p className="hint">Disabled in production. Use to test without a GitHub OAuth app.</p>
          <div className="field">
            <label className="label">Email</label>
            <input
              style={{ width: '100%' }}
              value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)}
            />
          </div>
          <button className="btn" onClick={devSignIn} disabled={busy}>
            Sign in locally
          </button>
        </div>
      )}

      {err && <div className="err">{err}</div>}
    </div>
  );
}
