import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import UpdateNotice from './UpdateNotice.vue';
import { createTestI18n } from '../test/i18n';
import type { Version } from '../utils/version';

const check = vi.hoisted(() => ({
  available: null as unknown,
  showNotice: null as unknown,
  dismiss: vi.fn(),
}));
vi.mock('../composables/useUpdateCheck', async () => {
  const { ref } = await import('vue');
  check.available = ref<Version | null>(null);
  check.showNotice = ref(false);
  return { useUpdateCheck: () => check };
});
const state = () =>
  check as unknown as { available: { value: Version | null }; showNotice: { value: boolean } };

const notice = () => document.body.querySelector('.update-notice');
const mountNotice = () => mount(UpdateNotice, { global: { plugins: [createTestI18n()] } });

describe('UpdateNotice', () => {
  beforeEach(() => {
    state().available.value = [1, 10, 0];
    state().showNotice.value = true;
    check.dismiss.mockReset();
  });

  it('names the newer release and links to its page, without interrupting', () => {
    mountNotice();
    expect(notice()?.getAttribute('role')).toBe('status');
    expect(notice()?.textContent).toContain('CardiPaw 1.10.0 is available.');
    const link = notice()!.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(
      'https://github.com/wesleyegbertsen/CardiPaw/releases/tag/v1.10.0',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('dismisses with the button and with the link', () => {
    mountNotice();
    notice()!.querySelector<HTMLButtonElement>('.btn-close')!.click();
    const link = notice()!.querySelector('a')!;
    link.addEventListener('click', (e) => e.preventDefault()); // happy-dom would navigate
    link.click();
    expect(check.dismiss).toHaveBeenCalledTimes(2);
  });

  it('shows nothing without a notice to show', () => {
    state().showNotice.value = false;
    mountNotice();
    expect(notice()).toBeNull();
  });
});
