import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import DatePicker from './DatePicker.vue';
import { createI18n } from 'vue-i18n';
import en from '../i18n/locales/en.json';
import nl from '../i18n/locales/nl.json';
import { createTestI18n } from '../test/i18n';
import { stubTimezone } from '../test/timezone';

enableAutoUnmount(afterEach);

function mountPicker(props: { modelValue: string; max?: string }, locale: 'en' | 'nl' = 'en') {
  const i18n =
    locale === 'nl'
      ? createI18n({ legacy: false, locale: 'nl', fallbackLocale: 'en', messages: { en, nl } })
      : createTestI18n();
  return mount(DatePicker, {
    props,
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
}

type Picker = ReturnType<typeof mountPicker>;

const panel = () => document.body.querySelector<HTMLElement>('.panel');
const title = () => document.body.querySelector<HTMLButtonElement>('.title-btn')!;
const navButtons = () => document.body.querySelectorAll<HTMLButtonElement>('.nav-btn');
const prev = () => navButtons()[0];
const next = () => navButtons()[1];
const all = (selector: string) => [...document.body.querySelectorAll<HTMLButtonElement>(selector)];
const dayButton = (day: number) =>
  all('.day-btn').find((b) => b.textContent?.trim() === String(day))!;
const option = (text: string) => all('.option-btn').find((b) => b.textContent?.trim() === text)!;

async function openPicker(wrapper: Picker) {
  await wrapper.get('.trigger').trigger('click');
  await flushPromises();
}

async function click(button: HTMLButtonElement) {
  button.click();
  await flushPromises();
}

describe('DatePicker', () => {
  afterEach(() => vi.unstubAllEnvs());

  describe('trigger', () => {
    it('shows the selected date', () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05' });
      expect(wrapper.get('.trigger').text()).toBe('Sep 5, 2024');
      expect(wrapper.find('.trigger-placeholder').exists()).toBe(false);
    });

    it.each(['', '2024-13-40', '2023-02-29', 'yesterday'])(
      'shows the placeholder for %j',
      (modelValue) => {
        const wrapper = mountPicker({ modelValue });
        expect(wrapper.get('.trigger-placeholder').text()).toBe('Select date');
      },
    );

    it('reports whether the panel is open', async () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05' });
      expect(wrapper.get('.trigger').attributes('aria-expanded')).toBe('false');
      await openPicker(wrapper);
      expect(wrapper.get('.trigger').attributes('aria-expanded')).toBe('true');
    });
  });

  describe('focus', () => {
    it('moves focus to the panel when opened', async () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05' });
      await openPicker(wrapper);
      expect(document.activeElement).toBe(panel());
    });

    it('closes on Escape and returns focus to the trigger', async () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05' });
      await openPicker(wrapper);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await flushPromises();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(wrapper.get('.trigger').element);
    });

    it('closes on a backdrop click and returns focus to the trigger', async () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05' });
      await openPicker(wrapper);
      document.body.querySelector<HTMLElement>('.overlay')!.click();
      await flushPromises();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(wrapper.get('.trigger').element);
    });
  });

  describe('day grid', () => {
    const weekdays = () =>
      all('.weekday')
        .map((w) => w.textContent)
        .join('');
    const cells = () => document.body.querySelectorAll('.day-grid > *').length;
    const leadingBlanks = () => {
      const children = [...document.body.querySelector('.day-grid')!.children];
      return children.findIndex((c) => c.classList.contains('day-btn'));
    };

    it('starts the week on Sunday in English', async () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05' });
      await openPicker(wrapper);
      expect(title().textContent?.trim()).toBe('September 2024');
      expect(weekdays()).toBe('SMTWTFS');
      expect(leadingBlanks()).toBe(0);
      expect(cells()).toBe(42);
    });

    it('starts the week on Monday in Dutch', async () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05' }, 'nl');
      await openPicker(wrapper);
      expect(weekdays()).toBe('MDWDVZZ');
      expect(leadingBlanks()).toBe(6);
      expect(cells()).toBe(42);
    });

    it('marks the selected day and emits the clicked day', async () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05' });
      await openPicker(wrapper);
      expect(all('.day-btn.selected').map((b) => b.textContent?.trim())).toEqual(['5']);
      await click(dayButton(12));
      expect(wrapper.emitted('update:modelValue')).toEqual([['2024-09-12']]);
      expect(panel()).toBeNull();
    });

    it('wraps from January to the previous December and back', async () => {
      const wrapper = mountPicker({ modelValue: '2024-01-15' });
      await openPicker(wrapper);
      await click(prev());
      expect(title().textContent?.trim()).toBe('December 2023');
      await click(next());
      expect(title().textContent?.trim()).toBe('January 2024');
    });

    it('emits the clicked local day in a far-ahead timezone', async () => {
      stubTimezone('Pacific/Kiritimati');
      const wrapper = mountPicker({ modelValue: '2024-09-01' });
      await openPicker(wrapper);
      await click(dayButton(5));
      expect(wrapper.emitted('update:modelValue')).toEqual([['2024-09-05']]);
    });
  });

  describe('months and years', () => {
    it('pages years in blocks of 12', async () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05' });
      await openPicker(wrapper);
      await click(title());
      expect(title().textContent?.trim()).toBe('2024');
      await click(title());
      expect(title().textContent?.trim()).toBe('2016 – 2027');
      expect(title().disabled).toBe(true);
      await click(prev());
      expect(title().textContent?.trim()).toBe('2004 – 2015');
      expect(all('.option-btn')).toHaveLength(12);
    });

    it('picks a year, then a month', async () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05' });
      await openPicker(wrapper);
      await click(title());
      await click(title());
      await click(option('2019'));
      expect(title().textContent?.trim()).toBe('2019');
      await click(option('Mar'));
      expect(title().textContent?.trim()).toBe('March 2019');
    });
  });

  describe('max', () => {
    const max = '2024-09-10';

    it('disables later days and the next month', async () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05', max });
      await openPicker(wrapper);
      expect(dayButton(10).disabled).toBe(false);
      expect(dayButton(11).disabled).toBe(true);
      expect(next().disabled).toBe(true);
      await click(prev());
      expect(next().disabled).toBe(false);
    });

    it('disables later months and years', async () => {
      const wrapper = mountPicker({ modelValue: '2024-09-05', max });
      await openPicker(wrapper);
      await click(title());
      expect(option('Sep').disabled).toBe(false);
      expect(option('Oct').disabled).toBe(true);
      expect(next().disabled).toBe(true);

      await click(title());
      expect(option('2024').disabled).toBe(false);
      expect(option('2025').disabled).toBe(true);
      expect(next().disabled).toBe(true);
    });

    it('keeps the selected year’s months up to the max after picking a year', async () => {
      const wrapper = mountPicker({ modelValue: '2023-11-05', max });
      await openPicker(wrapper);
      await click(title());
      await click(title());
      await click(option('2024'));
      expect(title().textContent?.trim()).toBe('2024');
      expect(option('Nov').disabled).toBe(true);
      await click(option('Aug'));
      expect(title().textContent?.trim()).toBe('August 2024');
      expect(next().disabled).toBe(false);
    });
  });
});
