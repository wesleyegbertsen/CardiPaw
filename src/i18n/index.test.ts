import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockStorage, failStorageWrites } from '../test/blockStorage';

// The module picks the locale when it is first imported, so each test imports a fresh copy.
async function bootstrap({ languages = ['en-US'], language = 'en-US' } = {}) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
  vi.resetModules();
  return import('./index');
}

describe('i18n bootstrap', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
  });

  it('uses the saved language over the browser’s', async () => {
    localStorage.setItem('cardipaw-locale', 'de');
    const { currentLocale } = await bootstrap({ languages: ['fr-FR'] });
    expect(currentLocale()).toBe('de');
    expect(document.documentElement.getAttribute('lang')).toBe('de');
  });

  it('ignores an unsupported saved value', async () => {
    localStorage.setItem('cardipaw-locale', 'xx');
    const { currentLocale } = await bootstrap({ languages: ['nl-BE'] });
    expect(currentLocale()).toBe('nl');
  });

  it('matches a regional browser language on its base language', async () => {
    const { currentLocale } = await bootstrap({ languages: ['es-ES', 'fr-CA'] });
    expect(currentLocale()).toBe('fr');
  });

  it('falls back to navigator.language when languages is empty', async () => {
    const { currentLocale } = await bootstrap({ languages: [], language: 'ja-JP' });
    expect(currentLocale()).toBe('ja');
  });

  it('falls back to English when nothing matches', async () => {
    const { currentLocale } = await bootstrap({ languages: ['es-ES'], language: 'es-ES' });
    expect(currentLocale()).toBe('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('saves and applies a chosen language', async () => {
    const { setLocale, currentLocale, i18n } = await bootstrap();
    setLocale('nl');
    expect(currentLocale()).toBe('nl');
    expect(i18n.global.t('common.back')).toBe('Terug');
    expect(localStorage.getItem('cardipaw-locale')).toBe('nl');
    expect(document.documentElement.getAttribute('lang')).toBe('nl');
  });

  it('starts and switches language when site data is blocked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    blockStorage();
    const { setLocale, currentLocale } = await bootstrap({ languages: ['de-DE'] });
    expect(currentLocale()).toBe('de');
    setLocale('nl');
    expect(currentLocale()).toBe('nl');
    expect(document.documentElement.getAttribute('lang')).toBe('nl');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not save'), expect.any(DOMException));
  });

  it('still switches language when saving the choice fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { setLocale, currentLocale } = await bootstrap();
    failStorageWrites();
    setLocale('fr');
    expect(currentLocale()).toBe('fr');
    expect(document.documentElement.getAttribute('lang')).toBe('fr');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not save'), expect.any(DOMException));
  });
});
