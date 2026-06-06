'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function LocaleSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      value={current}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value;
        document.cookie = `NEXT_LOCALE=${v}; path=/; max-age=31536000`;
        start(() => router.refresh());
      }}
      style={{
        font: 'inherit',
        border: '2px solid #000',
        background: '#fff',
        color: '#000',
        padding: '4px 6px',
        borderRadius: 0,
        cursor: 'pointer',
      }}
    >
      <option value="en">English</option>
      <option value="zh">中文</option>
      <option value="ja">日本語</option>
    </select>
  );
}
