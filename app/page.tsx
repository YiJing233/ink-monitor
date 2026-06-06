import { cookies, headers } from 'next/headers';
import { getLocaleFromCookie, type Locale } from '@/lib/i18n';
import LandingClient from './landing-client';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  // Detect locale from cookie or Accept-Language
  const c = await cookies();
  const cookieLocale = getLocaleFromCookie(c.get('NEXT_LOCALE')?.value || null);
  const h = await headers();
  const acceptLang = h.get('accept-language') || '';
  let locale: Locale = cookieLocale;
  if (cookieLocale === 'en' && /^zh/i.test(acceptLang)) {
    locale = 'zh';
  }
  return <LandingClient locale={locale} />;
}
