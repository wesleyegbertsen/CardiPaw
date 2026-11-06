import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import BackupNotice from './BackupNotice.vue';
import { createTestI18n } from '../test/i18n';

// The engine decides when the notice shows (useAutoBackup.test.ts); here only what it shows and does.
const backups = vi.hoisted(() => ({
  showNotice: undefined as unknown as { value: boolean },
  dismissNotice: vi.fn(),
}));
vi.mock('../composables/useAutoBackup', async () => {
  const { ref } = await import('vue');
  backups.showNotice = ref(false);
  return { useAutoBackup: () => backups };
});
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => router }));

const notice = () => document.body.querySelector('.backup-notice');
const button = (name: string) =>
  [...notice()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!;
const mountNotice = () => mount(BackupNotice, { global: { plugins: [createTestI18n()] } });

describe('BackupNotice', () => {
  beforeEach(() => {
    backups.showNotice.value = true;
    backups.dismissNotice.mockReset();
    router.push.mockReset();
  });

  it('says automatic backups are failing, without interrupting', () => {
    mountNotice();
    expect(notice()?.getAttribute('role')).toBe('status');
    expect(notice()?.textContent).toContain("Automatic backup isn't working.");
  });

  it('opens Settings without dismissing', () => {
    mountNotice();
    button('Open Settings').click();
    expect(router.push).toHaveBeenCalledExactlyOnceWith({ name: 'settings' });
    expect(backups.dismissNotice).not.toHaveBeenCalled();
  });

  it('dismisses with Dismiss', () => {
    mountNotice();
    button('Dismiss').click();
    expect(backups.dismissNotice).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows nothing while backups work', () => {
    backups.showNotice.value = false;
    mountNotice();
    expect(notice()).toBeNull();
  });
});
