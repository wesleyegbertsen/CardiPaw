import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import LocalePicker from './LocalePicker.vue';
import { setLocale } from '../i18n';
import { createTestI18n } from '../test/i18n';

vi.mock('../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../i18n')>()),
  setLocale: vi.fn(),
}));

enableAutoUnmount(afterEach);

function mountPicker() {
  return mount(LocalePicker, { global: { plugins: [createTestI18n()] } });
}

describe('LocalePicker', () => {
  beforeEach(() => vi.mocked(setLocale).mockClear());

  it('opens a list of every language with the current one active', async () => {
    const wrapper = mountPicker();
    expect(wrapper.find('.lang-dropdown').exists()).toBe(false);
    expect(wrapper.get('.lang-trigger').attributes('aria-label')).toBe('Switch language');

    await wrapper.get('.lang-trigger').trigger('click');
    const options = wrapper.findAll('.lang-option');
    expect(options.map((o) => o.attributes('title'))).toEqual([
      'English',
      'Nederlands',
      'Deutsch',
      'Français',
      '日本語',
    ]);
    expect(wrapper.findAll('.lang-option.active').map((o) => o.attributes('title'))).toEqual([
      'English',
    ]);
  });

  it('switches the language and closes', async () => {
    const wrapper = mountPicker();
    await wrapper.get('.lang-trigger').trigger('click');
    await wrapper.get('.lang-option[title="Deutsch"]').trigger('click');
    expect(setLocale).toHaveBeenCalledWith('de');
    expect(wrapper.find('.lang-dropdown').exists()).toBe(false);
  });

  it('closes without switching on a backdrop click', async () => {
    const wrapper = mountPicker();
    await wrapper.get('.lang-trigger').trigger('click');
    await wrapper.get('.lang-backdrop').trigger('click');
    expect(wrapper.find('.lang-dropdown').exists()).toBe(false);
    expect(setLocale).not.toHaveBeenCalled();
  });
});
