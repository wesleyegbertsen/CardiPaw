import { createI18n } from 'vue-i18n';
import en from '../i18n/locales/en.json';

/**
 * A fresh English i18n instance for component tests. src/i18n/index.ts reads
 * localStorage and navigator on import, so tests build their own instead.
 */
export function createTestI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en },
  });
}
