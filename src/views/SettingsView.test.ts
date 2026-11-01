import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import SettingsView from './SettingsView.vue';
import * as backup from '../services/backup';
import { mountView, settle } from '../test/mountView';
import { deferred } from '../test/deferred';
import { makeNote, makePet, makeReading } from '../test/fixtures';
import { mockNative } from '../test/native';
import type { Version } from '../utils/version';

// Keep parsing and validation real; only the IndexedDB-touching calls are faked.
vi.mock('../services/backup', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/backup')>();
  return { ...real, downloadBackup: vi.fn(), importBackup: vi.fn() };
});

// The update check's own logic is tested in useUpdateCheck.test.ts.
const updates = vi.hoisted(() => ({
  enabled: undefined as unknown as { value: boolean },
  available: undefined as unknown as { value: Version | null },
  setEnabled: vi.fn(),
}));
vi.mock('../composables/useUpdateCheck', async () => {
  const { ref } = await import('vue');
  updates.enabled = ref(false);
  updates.available = ref(null);
  return { useUpdateCheck: () => updates };
});

const exportButton = (w: VueWrapper) => w.findAll('.action-btn')[0];
const importButton = (w: VueWrapper) => w.findAll('.action-btn')[1];
const privacyButton = (w: VueWrapper) =>
  w.findAll('.action-card').find((card) => card.text().includes('Privacy Policy'))!.get('.action-btn');
const status = (w: VueWrapper) => w.get('[role="status"]').text();
const alerts = (w: VueWrapper) => w.findAll('[role="alert"]').map((a) => a.text());
const dialogMessage = () => document.body.querySelector('[role="alertdialog"] .message');
const clickInBody = (selector: string) =>
  document.body.querySelector<HTMLButtonElement>(selector)!.click();

async function pickFile(wrapper: VueWrapper, text: string) {
  const input = wrapper.get('input[type="file"]');
  const file = new File([text], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  await input.trigger('change');
  await settle();
  return input.element as HTMLInputElement;
}

const backupText = (extra: object = {}) =>
  JSON.stringify({
    version: 1,
    exportedAt: '',
    pets: [makePet()],
    readings: [makeReading(), makeReading({ id: 'r2' })],
    notes: [makeNote()],
    ...extra,
  });

describe('SettingsView', () => {
  beforeEach(() => {
    vi.mocked(backup.downloadBackup).mockReset().mockResolvedValue('saved');
    vi.mocked(backup.importBackup).mockReset().mockResolvedValue();
    updates.enabled.value = false;
    updates.available.value = null;
    updates.setEnabled.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('says the data and the export include notes', async () => {
    const { wrapper } = await mountView(SettingsView, '/settings');
    expect(wrapper.text()).toContain('Your pet profiles, readings and notes are stored locally');
    expect(wrapper.text()).toContain('All pets, readings and notes as a JSON file');
  });

  describe('import', () => {
    it('asks to confirm with the counts, then imports', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      const input = await pickFile(wrapper, backupText());
      expect(dialogMessage()?.textContent).toContain('Import 1 pet(s), 2 reading(s) and 1 note(s)?');
      expect(input.value).toBe('');

      clickInBody('.btn-confirm');
      await settle();
      expect(backup.importBackup).toHaveBeenCalledWith(
        expect.objectContaining({ pets: [makePet()] }),
      );
      expect(importButton(wrapper).text()).toContain('Imported');
    });

    it('announces Imported in a status region', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      expect(status(wrapper)).toBe('');
      await pickFile(wrapper, backupText());
      clickInBody('.btn-confirm');
      await settle();
      expect(status(wrapper)).toBe('✓ Imported');
    });

    it('restarts the Imported confirmation on a repeat import', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      vi.useFakeTimers(); // importBackup is mocked, so nothing here needs IndexedDB
      const importOnce = async () => {
        const input = wrapper.get('input[type="file"]');
        const file = new File([backupText()], 'backup.json', { type: 'application/json' });
        Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
        await input.trigger('change');
        await flushPromises();
        clickInBody('.btn-confirm');
        await flushPromises();
      };
      await importOnce();
      vi.advanceTimersByTime(2000);
      await importOnce();
      // Blanked for a moment so screen readers announce the same text again
      expect(status(wrapper)).toBe('');
      expect(importButton(wrapper).text()).toContain('Imported');
      vi.advanceTimersByTime(100);
      await flushPromises();
      expect(status(wrapper)).toBe('✓ Imported');
      vi.advanceTimersByTime(1400);
      await flushPromises();
      expect(importButton(wrapper).text()).toContain('Imported');
      expect(status(wrapper)).toBe('✓ Imported');
      vi.advanceTimersByTime(1500);
      await flushPromises();
      expect(importButton(wrapper).text()).not.toContain('Imported');
      expect(status(wrapper)).toBe('');
    });

    it('mentions damaged records that will be skipped', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      await pickFile(wrapper, backupText({ readings: [makeReading(), { id: 'broken' }] }));
      expect(dialogMessage()?.textContent).toContain(
        '1 damaged record in the file will be skipped.',
      );
    });

    it('imports nothing when cancelled', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      await pickFile(wrapper, backupText());
      clickInBody('.btn-cancel');
      await settle();
      expect(dialogMessage()).toBeNull();
      expect(backup.importBackup).not.toHaveBeenCalled();
    });

    it('tells an invalid backup apart from an unreadable file', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { wrapper } = await mountView(SettingsView, '/settings');
      await pickFile(wrapper, JSON.stringify({ version: 2 }));
      expect(alerts(wrapper)).toEqual([
        'Invalid file format. Please select a CardiPaw export file.',
      ]);

      await pickFile(wrapper, '{not json');
      expect(alerts(wrapper)).toEqual([
        'Could not read the file. Make sure it is a valid JSON export.',
      ]);
      expect(dialogMessage()).toBeNull();
    });

    it('reports a failed import', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(backup.importBackup).mockRejectedValue(new Error('quota'));
      const { wrapper } = await mountView(SettingsView, '/settings');
      await pickFile(wrapper, backupText());
      clickInBody('.btn-confirm');
      await settle();
      expect(alerts(wrapper)).toEqual(['Import failed. Your existing data has not been changed.']);
      expect(importButton(wrapper).text()).not.toContain('Imported');
    });

    it('disables Import while an import runs', async () => {
      let finish!: () => void;
      vi.mocked(backup.importBackup).mockImplementation(
        () => new Promise<void>((r) => (finish = r)),
      );
      const { wrapper } = await mountView(SettingsView, '/settings');
      await pickFile(wrapper, backupText());
      clickInBody('.btn-confirm');
      await flushPromises();
      expect(importButton(wrapper).attributes('disabled')).toBeDefined();

      finish();
      await flushPromises();
      expect(importButton(wrapper).attributes('disabled')).toBeUndefined();
    });
  });

  describe('export', () => {
    it('shows Exported for 3 seconds', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      // No IndexedDB on this path, so all timers can be faked.
      vi.useFakeTimers();
      await exportButton(wrapper).trigger('click');
      await flushPromises();
      expect(backup.downloadBackup).toHaveBeenCalledTimes(1);
      expect(exportButton(wrapper).text()).toContain('Exported');

      vi.advanceTimersByTime(2999);
      await flushPromises();
      expect(exportButton(wrapper).text()).toContain('Exported');
      vi.advanceTimersByTime(1);
      await flushPromises();
      expect(exportButton(wrapper).text()).not.toContain('Exported');
    });

    it('restarts the Exported confirmation on a repeat export', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      vi.useFakeTimers();
      await exportButton(wrapper).trigger('click');
      await flushPromises();
      vi.advanceTimersByTime(2000);
      await exportButton(wrapper).trigger('click');
      await flushPromises();
      // Blanked for a moment so screen readers announce the same text again
      expect(status(wrapper)).toBe('');
      expect(exportButton(wrapper).text()).toContain('Exported');
      vi.advanceTimersByTime(100);
      await flushPromises();
      expect(status(wrapper)).toBe('✓ Exported');
      vi.advanceTimersByTime(1400);
      await flushPromises();
      expect(exportButton(wrapper).text()).toContain('Exported');
      expect(status(wrapper)).toBe('✓ Exported');
      vi.advanceTimersByTime(1500);
      await flushPromises();
      expect(exportButton(wrapper).text()).not.toContain('Exported');
      expect(status(wrapper)).toBe('');
    });

    it('leaves no timer running after leaving the page', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      vi.useFakeTimers();
      await exportButton(wrapper).trigger('click');
      await flushPromises();
      vi.advanceTimersByTime(1000);
      await exportButton(wrapper).trigger('click'); // a repeat also starts the re-announce timer
      await flushPromises();
      wrapper.unmount();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('announces Exported in a status region', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      expect(status(wrapper)).toBe('');
      await exportButton(wrapper).trigger('click');
      await settle();
      expect(status(wrapper)).toBe('✓ Exported');
    });

    it('ignores a second tap while the first export is in progress', async () => {
      const pending = deferred<'saved'>();
      vi.mocked(backup.downloadBackup).mockReturnValueOnce(pending.promise);
      const { wrapper } = await mountView(SettingsView, '/settings');
      await exportButton(wrapper).trigger('click');
      expect(exportButton(wrapper).attributes('disabled')).toBeDefined();
      await exportButton(wrapper).trigger('click');
      expect(backup.downloadBackup).toHaveBeenCalledTimes(1);

      pending.resolve('saved');
      await settle();
      expect(exportButton(wrapper).attributes('disabled')).toBeUndefined();
      expect(status(wrapper)).toBe('✓ Exported');
    });

    it('names the backup for the share sheet and the email subject', async () => {
      // Only the clock: faking timers would stall fake-indexeddb.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2024-03-20T10:00:00.000Z'));
      const { wrapper } = await mountView(SettingsView, '/settings');
      await exportButton(wrapper).trigger('click');
      await settle();
      expect(backup.downloadBackup).toHaveBeenCalledWith({
        subject: 'CardiPaw backup Mar 20, 2024',
        dialogTitle: 'Save or share your CardiPaw backup',
      });
    });

    it('claims nothing when the app share sheet is closed without saving', async () => {
      vi.mocked(backup.downloadBackup).mockResolvedValueOnce('cancelled');
      const { wrapper } = await mountView(SettingsView, '/settings');
      await exportButton(wrapper).trigger('click');
      await settle();
      expect(backup.downloadBackup).toHaveBeenCalledTimes(1);
      expect(status(wrapper)).toBe('');
      expect(alerts(wrapper)).toEqual([]);
      expect(exportButton(wrapper).text()).not.toContain('Exported');
    });

    it('reports a failed export instead of claiming success', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(backup.downloadBackup).mockRejectedValueOnce(new Error('blocked'));
      const { wrapper } = await mountView(SettingsView, '/settings');
      await exportButton(wrapper).trigger('click');
      await settle();
      expect(alerts(wrapper)).toEqual(['Export failed. Please try again.']);
      expect(exportButton(wrapper).text()).not.toContain('Exported');
      expect(error).toHaveBeenCalledWith('Backup export failed', expect.any(Error));

      await exportButton(wrapper).trigger('click');
      await settle();
      expect(alerts(wrapper)).toEqual([]);
      expect(exportButton(wrapper).text()).toContain('Exported');
    });
  });

  it('keeps the hidden file input out of the tab order', async () => {
    const { wrapper } = await mountView(SettingsView, '/settings');
    const input = wrapper.get('input[type="file"]');
    expect(input.attributes('tabindex')).toBe('-1');
    expect(input.attributes('aria-hidden')).toBe('true');
  });

  it('opens and closes the privacy information', async () => {
    const { wrapper } = await mountView(SettingsView, '/settings');
    await privacyButton(wrapper).trigger('click');
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.querySelector('.dialog-title')?.textContent).toBe('Privacy Policy');
    // Reminders exist only in the app.
    expect(dialog?.textContent).not.toContain('Reminders stay on your phone.');

    clickInBody('.btn-ok');
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('explains reminders in the privacy information in the app', async () => {
    mockNative();
    const { wrapper } = await mountView(SettingsView, '/settings');
    await privacyButton(wrapper).trigger('click');
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'Reminders stay on your phone.',
    );
  });

  describe('version', () => {
    it('links a release to its release notes', async () => {
      vi.stubGlobal('__APP_VERSION__', '1.2.0');
      const { wrapper } = await mountView(SettingsView, '/settings');
      expect(wrapper.get('.version-text a').attributes('href')).toBe(
        'https://github.com/wesleyegbertsen/CardiPaw/releases/tag/v1.2.0',
      );
    });

    it('shows a local build without a link', async () => {
      vi.stubGlobal('__APP_VERSION__', '0.0.0');
      const { wrapper } = await mountView(SettingsView, '/settings');
      expect(wrapper.find('.version-text a').exists()).toBe(false);
      expect(wrapper.get('.version-text span').text()).toBe('0.0.0');
    });
  });

  describe('updates', () => {
    const updatesSection = (w: VueWrapper) =>
      w
        .findAll('section')
        .find((s) => s.element.querySelector('.section-title')?.textContent === 'Updates');
    const privacyText = async (w: VueWrapper) => {
      await privacyButton(w).trigger('click');
      return document.body.querySelector('[role="dialog"]')!.textContent;
    };

    it('are not offered on the website', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      expect(updatesSection(wrapper)).toBeUndefined();
      expect(await privacyText(wrapper)).not.toContain('Update check');
    });

    it('show the installed version and open the latest release in the app', async () => {
      mockNative();
      vi.stubGlobal('__APP_VERSION__', '1.2.0');
      const { wrapper } = await mountView(SettingsView, '/settings');
      const section = updatesSection(wrapper)!;
      expect(section.text()).toContain('Installed: version 1.2.0');
      const link = section.get('a.action-btn');
      expect(link.text()).toBe('Open on GitHub');
      expect(link.attributes('href')).toBe('https://github.com/wesleyegbertsen/CardiPaw/releases/latest');
      expect(link.attributes('target')).toBe('_blank');
    });

    it('name a newer release the check found', async () => {
      mockNative();
      updates.available.value = [1, 3, 0];
      const { wrapper } = await mountView(SettingsView, '/settings');
      expect(updatesSection(wrapper)!.text()).toContain('Version 1.3.0 is available');
    });

    it('turn the daily check on with a switch that is off by default', async () => {
      mockNative();
      const { wrapper } = await mountView(SettingsView, '/settings');
      const toggle = updatesSection(wrapper)!.get('[role="switch"]');
      expect(toggle.attributes('aria-checked')).toBe('false');
      expect(document.getElementById(toggle.attributes('aria-labelledby')!)?.textContent).toBe(
        'Check automatically',
      );
      await toggle.trigger('click');
      expect(updates.setEnabled).toHaveBeenCalledWith(true);
    });

    it('show the switch on while the daily check is on', async () => {
      mockNative();
      updates.enabled.value = true;
      const { wrapper } = await mountView(SettingsView, '/settings');
      const toggle = updatesSection(wrapper)!.get('[role="switch"]');
      expect(toggle.attributes('aria-checked')).toBe('true');
      await toggle.trigger('click');
      expect(updates.setEnabled).toHaveBeenCalledWith(false);
    });

    it('describe what the daily check sends to the switch', async () => {
      mockNative();
      const { wrapper } = await mountView(SettingsView, '/settings');
      const toggle = updatesSection(wrapper)!.get('[role="switch"]');
      const describedby = toggle.attributes('aria-describedby');
      expect(describedby).toBeTruthy();
      expect(document.getElementById(describedby!)?.textContent).toContain(
        'GitHub sees your IP address',
      );
    });

    it('are explained in the privacy information in the app', async () => {
      mockNative();
      const { wrapper } = await mountView(SettingsView, '/settings');
      expect(await privacyText(wrapper)).toContain('api.github.com about once a day');
    });
  });
});
