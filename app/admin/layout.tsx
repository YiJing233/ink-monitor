'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';

const tabs = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/canvas', label: 'Canvas' },
  { href: '/admin/market', label: 'Market' },
  { href: '/admin/albums', label: 'Albums' },
  { href: '/admin/providers', label: 'Providers' },
  { href: '/admin/stocks', label: 'Stocks' },
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/diagnostics', label: 'Diagnostics' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  return (
    <div className="admin">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Monitor · admin</h1>
        <div className="row" style={{ fontSize: 12 }}>
          {session?.user && (
            <span className="pill">
              {(session.user as any).name || session.user.email}
            </span>
          )}
          {session ? (
            <button className="btn" onClick={() => signOut({ callbackUrl: '/' })}>Sign out</button>
          ) : (
            <Link className="btn primary" href="/signin">Sign in</Link>
          )}
        </div>
      </div>
      <div className="nav">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={pathname === t.href ? 'active' : ''}
          >
            {t.label}
          </Link>
        ))}
        <Link href="/display" target="_blank">/display ↗</Link>
      </div>
      {children}
    </div>
  );
}
