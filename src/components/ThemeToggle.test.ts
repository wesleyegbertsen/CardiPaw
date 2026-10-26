import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ThemeToggle from './ThemeToggle.vue';
import { useThemeStore } from '../stores/theme';
import { createTestI18n } from '../test/i18n';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('flips its label and accessible name', async () => {
    const wrapper = mount(ThemeToggle, { global: { plugins: [createTestI18n()] } });
    const button = wrapper.get('.theme-toggle');
    expect(button.text()).toBe('Light');
    expect(button.attributes('aria-label')).toBe('Switch to dark mode');
    expect(button.classes()).toContain('is-light');
    expect(button.classes()).not.toContain('has-toggled');

    await button.trigger('click');
    expect(useThemeStore().isDark).toBe(true);
    expect(button.text()).toBe('Dark');
    expect(button.attributes('aria-label')).toBe('Switch to light mode');
    expect(button.classes()).not.toContain('is-light');
    expect(button.classes()).toContain('has-toggled');
  });
});
