import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import nl from './locales/nl.json';
import de from './locales/de.json';
import fr from './locales/fr.json';

export const SUPPORTED_LOCALES = ['en', 'nl', 'de', 'fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// Native language names, shown in the language picker
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  nl: 'Nederlands',
  de: 'Deutsch',
  fr: 'Français',
};

const STORAGE_KEY = 'cardipaw-locale';

function isSupported(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// Saved choice wins; otherwise fall back to the browser languages, then English.
function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && isSupported(saved)) return saved;

  const candidates = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const lang of candidates) {
    const base = lang.toLowerCase().split('-')[0];
    if (isSupported(base)) return base;
  }
  return 'en';
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { en, nl, de, fr },
});

document.documentElement.setAttribute('lang', i18n.global.locale.value);

export function setLocale(locale: Locale): void {
  i18n.global.locale.value = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.setAttribute('lang', locale);
}

// For non-component code (e.g. PDF generation) that needs the active locale.
export function currentLocale(): Locale {
  return i18n.global.locale.value as Locale;
}
