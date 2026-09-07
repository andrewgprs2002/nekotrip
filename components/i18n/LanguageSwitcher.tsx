'use client';

import type { Locale } from '@/lib/i18n';

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  function choose(next: Locale) {
    if (next === locale) return;
    document.cookie = `nekotrip_locale=${encodeURIComponent(next)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try { window.localStorage.setItem('nekotrip_locale', next); } catch {}
    window.location.reload();
  }

  return (
    <div className="languageSwitcher" role="group" aria-label="Language">
      <button
        type="button"
        className={locale === 'en' ? 'active' : ''}
        aria-pressed={locale === 'en'}
        onClick={() => choose('en')}
      >
        EN
      </button>
      <span aria-hidden="true">|</span>
      <button
        type="button"
        className={locale === 'zh-TW' ? 'active' : ''}
        aria-pressed={locale === 'zh-TW'}
        onClick={() => choose('zh-TW')}
      >
        中文
      </button>
    </div>
  );
}
