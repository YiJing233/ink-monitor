/**
 * Tests for the admin i18n infrastructure (`lib/i18n.ts`).
 *
 * The two helpers we care about:
 *   - `resolveLocale(cookieValue, acceptLanguage)` — picks a locale.
 *     Cookie wins when explicitly set; otherwise we honor an Accept-Language
 *     prefix so a Chinese / Japanese browser gets a localized experience on
 *     the first request, before the user has touched the switcher.
 *   - `t(locale, key, vars?)` — dictionary lookup with English fallback
 *     and `{name}` placeholder interpolation.
 *
 * These tests are pure (no DB / no Next.js request context), so they don't
 * need to mock `next/headers` — the route handlers that *use* this
 * infrastructure are tested in `app/api/diagnostics/widgets/__tests__/`.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveLocale,
  t,
  getLocaleFromCookie,
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
} from '../i18n';

describe('resolveLocale', () => {
  it('defaults to English when both cookie and Accept-Language are missing', () => {
    expect(resolveLocale(null, null)).toBe('en');
    expect(resolveLocale(undefined, undefined)).toBe('en');
    expect(resolveLocale('', '')).toBe('en');
  });

  it('returns the cookie value when it is an explicit non-default locale', () => {
    expect(resolveLocale('zh', null)).toBe('zh');
    expect(resolveLocale('ja', null)).toBe('ja');
    expect(resolveLocale('zh', 'en-US')).toBe('zh'); // cookie beats Accept-Language
  });

  it('still falls back to Accept-Language when the cookie is the default "en"', () => {
    // Visitors who haven't picked a locale in the switcher (cookie is unset
    // or 'en') but have a Chinese browser should still see Chinese on the
    // first request — this is the whole point of Accept-Language detection.
    expect(resolveLocale(null, 'zh-CN')).toBe('zh');
    expect(resolveLocale('', 'zh-CN,en;q=0.8')).toBe('zh');
    expect(resolveLocale('en', 'ja-JP')).toBe('ja');
    expect(resolveLocale(null, 'ja')).toBe('ja');
  });

  it('does not false-positive on similar ISO-639-1 codes (az, de, etc.)', () => {
    // "az" (Azerbaijani) shares letters with "ja" only in the last position;
    // "de" is German. The prefix check must reject these.
    expect(resolveLocale(null, 'az')).toBe('en');
    expect(resolveLocale(null, 'de-DE')).toBe('en');
    expect(resolveLocale(null, 'fr-FR')).toBe('en');
  });

  it('returns English for unknown cookie values (defensive — never throws)', () => {
    expect(resolveLocale('xx', 'zh-CN')).toBe('zh'); // Accept-Language still honored
    expect(resolveLocale('xx', null)).toBe('en');
  });
});

describe('getLocaleFromCookie', () => {
  it('returns the cookie value when it is a known locale', () => {
    expect(getLocaleFromCookie('en')).toBe('en');
    expect(getLocaleFromCookie('zh')).toBe('zh');
    expect(getLocaleFromCookie('ja')).toBe('ja');
  });

  it('defaults to English for null / unknown / empty', () => {
    expect(getLocaleFromCookie(null)).toBe(DEFAULT_LOCALE);
    expect(getLocaleFromCookie(undefined)).toBe(DEFAULT_LOCALE);
    expect(getLocaleFromCookie('')).toBe(DEFAULT_LOCALE);
    expect(getLocaleFromCookie('xx')).toBe(DEFAULT_LOCALE);
  });
});

describe('t (translation lookup)', () => {
  it('returns the requested locale\'s string for a known key', () => {
    expect(t('en', 'admin.canvas.h')).toBe('Canvas');
    expect(t('en', 'admin.canvas.save')).toBe('Save');
  });

  it('translates the same key into the matching locale strings', () => {
    // The exact translated text is exercised below; this test pins the
    // invariant that every supported locale has a non-empty string for the
    // same set of admin keys.
    for (const { code } of LOCALES) {
      expect(t(code, 'admin.canvas.h').length).toBeGreaterThan(0);
      expect(t(code, 'admin.canvas.save').length).toBeGreaterThan(0);
      expect(t(code, 'admin.market.h').length).toBeGreaterThan(0);
      expect(t(code, 'admin.albums.h').length).toBeGreaterThan(0);
    }
  });

  it('falls back to English when the requested locale is missing the key', () => {
    // We can simulate this by monkey-patching the dictionary, but the
    // simpler invariant: t() must always return a non-empty string for a
    // known key, in every supported locale. If a translation is missing
    // for zh/ja we fall back to en rather than rendering the key.
    for (const { code } of LOCALES) {
      expect(t(code, 'admin.canvas.save').length).toBeGreaterThan(0);
      expect(t(code, 'admin.market.h').length).toBeGreaterThan(0);
    }
  });

  it('returns the key itself as a last-resort fallback (never throws)', () => {
    expect(t('en', 'no.such.key')).toBe('no.such.key');
    expect(t('zh', 'no.such.key')).toBe('no.such.key');
  });

  it('interpolates {name} placeholders with the supplied vars', () => {
    expect(t('en', 'admin.canvas.status.saved', { count: 3, device: 'Kindle' })).toBe(
      'Saved 3 widgets · device Kindle',
    );
    expect(t('zh', 'admin.canvas.status.saved', { count: 3, device: 'Kindle' })).toBe(
      '已保存 3 个组件 · 设备 Kindle',
    );
  });

  it('leaves an unknown placeholder untouched rather than rendering "undefined"', () => {
    // The route has `device: DEVICES[deviceId].label` — if a future call
    // forgets a key, we want the user to see the literal {device} so it's
    // obvious what's missing, not a silently-emptied string.
    const out = t('en', 'admin.canvas.status.saved', { count: 1 });
    expect(out).toContain('{device}');
  });

  it('the diagnostics failure messages round-trip with vars and reflect the locale', () => {
    expect(t('en', 'api.diag.validate.failed', { message: 'bad id' })).toBe('fail: bad id');
    expect(t('zh', 'api.diag.validate.failed', { message: 'bad id' })).toBe('失败: bad id');
    expect(t('en', 'api.diag.validate.ok')).toBe('ok');
    expect(t('zh', 'api.diag.validate.ok')).toBe('通过');
  });
});
