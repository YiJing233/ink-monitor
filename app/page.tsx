import { cookies, headers } from 'next/headers';
import { resolveLocale, type Locale } from '@/lib/i18n';
import LandingClient from './landing-client';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  // Detect locale from cookie or Accept-Language (centralized in lib/i18n).
  const c = await cookies();
  const h = await headers();
  const locale: Locale = resolveLocale(c.get('NEXT_LOCALE')?.value || null, h.get('accept-language'));
  return <LandingClient locale={locale} />;
}
