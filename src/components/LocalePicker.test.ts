import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LocalePicker from './LocalePicker.vue';
import { setLocale } from '../i18n';
import { closeTopModal } from '../composables/useModal';
import { createTestI18n } from '../test/i18n';

vi.mock('../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../i18n')>()),
  setLocale: vi.fn(),
}));

function mountPicker() {
  // Attached so focus moves can be checked
  return mount(LocalePicker, { attachTo: document.body, global: { plugins: [createTestI18n()] } });
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

  it('is a disclosure that moves focus to the current language', async () => {
    const wrapper = mountPicker();
    const trigger = wrapper.get('.lang-trigger');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.attributes('aria-controls')).toBeUndefined();

    await trigger.trigger('click');
    await flushPromises();
    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(trigger.attributes('aria-controls')).toBe(
      wrapper.get('.lang-dropdown').attributes('id'),
    );
    const english = wrapper.get('.lang-option[title="English"]');
    expect(document.activeElement).toBe(english.element);
    expect(wrapper.findAll('[aria-current]').map((o) => o.attributes('title'))).toEqual([
      'English',
    ]);
  });

  it('names each language in its own language', async () => {
    const wrapper = mountPicker();
    await wrapper.get('.lang-trigger').trigger('click');
    const german = wrapper.get('.lang-option[title="Deutsch"]');
    expect(german.get('.sr-only').attributes('lang')).toBe('de');
    expect(german.text()).toBe('Deutsch');
    expect(german.get('[aria-hidden="true"]').find('svg').exists()).toBe(true);
  });

  it.each([
    [
      'Escape',
      (w: ReturnType<typeof mountPicker>) =>
        w.get('.lang-option[title="Deutsch"]').trigger('keydown', { key: 'Escape' }),
    ],
    [
      'a pick',
      (w: ReturnType<typeof mountPicker>) =>
        w.get('.lang-option[title="Deutsch"]').trigger('click'),
    ],
    [
      'a backdrop click',
      (w: ReturnType<typeof mountPicker>) => w.get('.lang-backdrop').trigger('click'),
    ],
  ])('closes on %s and returns focus to the trigger', async (_, close) => {
    const wrapper = mountPicker();
    await wrapper.get('.lang-trigger').trigger('click');
    await flushPromises();
    await close(wrapper);
    expect(wrapper.find('.lang-dropdown').exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get('.lang-trigger').element);
  });

  it('closes on the Android back button, which it leaves alone once closed', async () => {
    const wrapper = mountPicker();
    await wrapper.get('.lang-trigger').trigger('click');
    await flushPromises();
    expect(closeTopModal()).toBe(true);
    await flushPromises();
    expect(wrapper.find('.lang-dropdown').exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get('.lang-trigger').element);
    expect(closeTopModal()).toBe(false);
  });

  it('closes when focus moves out of the picker, not when it moves inside or nowhere', async () => {
    const outside = document.body.appendChild(document.createElement('button'));
    try {
      const wrapper = mountPicker();
      await wrapper.get('.lang-trigger').trigger('click');
      await flushPromises();
      const english = wrapper.get('.lang-option[title="English"]');
      await english.trigger('focusout', { relatedTarget: wrapper.get('.lang-trigger').element });
      await english.trigger('focusout', { relatedTarget: null });
      expect(wrapper.find('.lang-dropdown').exists()).toBe(true);
      await english.trigger('focusout', { relatedTarget: outside });
      expect(wrapper.find('.lang-dropdown').exists()).toBe(false);
    } finally {
      outside.remove();
    }
  });

  it('keeps Escape from reaching an enclosing dialog only while open', async () => {
    const parentKeydown = vi.fn();
    document.addEventListener('keydown', parentKeydown);
    try {
      const wrapper = mountPicker();
      await wrapper.get('.lang-trigger').trigger('click');
      await flushPromises();
      await wrapper.get('.lang-option[title="Deutsch"]').trigger('keydown', { key: 'Escape' });
      expect(wrapper.find('.lang-dropdown').exists()).toBe(false);
      expect(parentKeydown).not.toHaveBeenCalled();

      await wrapper.get('.lang-trigger').trigger('keydown', { key: 'Escape' });
      expect(parentKeydown).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', parentKeydown);
    }
  });
});
