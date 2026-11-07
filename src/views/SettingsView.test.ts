import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import SettingsView from './SettingsView.vue';
import * as backup from '../services/backup';
import { mountView, settle } from '../test/mountView';
import { deferred } from '../test/deferred';
import { makeNote, makePet, makeReading } from '../test/fixtures';
import { mockNative } from '../test/native';
import type { CheckOutcome } from '../composables/useUpdateCheck';
import type { BackupConfig, RunOutcome } from '../composables/useAutoBackup';
import type { BackupFailure } from '../native/backupFolder';
import type { Version } from '../utils/version';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';

// Keep parsing and validation real; only the IndexedDB-touching calls are faked.
vi.mock('../services/backup', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/backup')>();
  return { ...real, downloadBackup: vi.fn(), importBackup: vi.fn() };
});

// The update check's own logic is tested in useUpdateCheck.test.ts.
const updates = vi.hoisted(() => ({
  enabled: undefined as unknown as { value: boolean },
  available: undefined as unknown as { value: Version | null },
  lastChecked: undefined as unknown as { value: number | null },
  setEnabled: vi.fn(),
  checkNow: vi.fn<() => Promise<CheckOutcome | null>>(),
}));
vi.mock('../composables/useUpdateCheck', async () => {
  const { ref } = await import('vue');
  updates.enabled = ref(false);
  updates.available = ref(null);
  updates.lastChecked = ref(null);
  return { useUpdateCheck: () => updates };
});

// The opt-in keeps a module-level ref; a mock keeps one test's switch from leaking into the next.
const camera = vi.hoisted(() => ({
  enabled: undefined as unknown as { value: boolean },
  supported: true,
  setEnabled: vi.fn(),
}));
vi.mock('../composables/useCameraOptIn', async () => {
  const { ref } = await import('vue');
  camera.enabled = ref(false);
  return {
    useCameraOptIn: () => ({ enabled: camera.enabled, setEnabled: camera.setEnabled }),
    isCameraSupported: () => camera.supported,
  };
});

// The engine is tested in useAutoBackup.test.ts; here only what Settings shows and calls.
const BACKUPS_OFF: BackupConfig = { enabled: false, frequency: 'daily', keep: 7 };
const BACKUPS_ON: BackupConfig = {
  enabled: true,
  folderUri: 'content://com.android.externalstorage.documents/tree/primary%3ABackups',
  folderName: 'Backups',
  frequency: 'daily',
  keep: 7,
};
const backups = vi.hoisted(() => ({
  config: undefined as unknown as { value: BackupConfig },
  lastSuccess: undefined as unknown as { value: number | null },
  failure: undefined as unknown as { value: BackupFailure | null },
  running: undefined as unknown as { value: boolean },
  turnOn: vi.fn<() => Promise<'on' | 'cancelled' | 'unavailable'>>(),
  changeFolder: vi.fn<() => Promise<'changed' | 'cancelled' | 'unavailable'>>(),
  turnOff: vi.fn<() => Promise<void>>(),
  setFrequency: vi.fn(),
  setKeep: vi.fn(),
  backUpNow: vi.fn<() => Promise<RunOutcome>>(),
  probeFolder: vi.fn<() => Promise<void>>(),
}));
vi.mock('../composables/useAutoBackup', async () => {
  const { ref } = await import('vue');
  backups.config = ref({ enabled: false, frequency: 'daily', keep: 7 });
  backups.lastSuccess = ref(null);
  backups.failure = ref(null);
  backups.running = ref(false);
  return { useAutoBackup: () => backups, probeFolder: backups.probeFolder };
});

const exportButton = (w: VueWrapper) => w.findAll('.action-btn')[0];
const importButton = (w: VueWrapper) => w.findAll('.action-btn')[1];
const privacyButton = (w: VueWrapper) =>
  w.findAll('.action-card').find((card) => card.text().includes('Privacy Policy'))!.get('.action-btn');
const termsButton = (w: VueWrapper) =>
  w.findAll('.action-card').find((card) => card.text().includes('Terms of Use'))!.get('.action-btn');
const cameraCard = (w: VueWrapper) =>
  w.findAll('.action-card').find((card) => card.text().includes('Camera breath counting'));
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
    updates.lastChecked.value = null;
    updates.setEnabled.mockReset();
    updates.checkNow.mockReset().mockResolvedValue({ status: 'up-to-date' });
    camera.enabled.value = false;
    camera.supported = true;
    camera.setEnabled.mockReset();
    backups.config.value = BACKUPS_OFF;
    backups.lastSuccess.value = null;
    backups.failure.value = null;
    backups.turnOn.mockReset().mockResolvedValue('on');
    backups.changeFolder.mockReset().mockResolvedValue('changed');
    backups.turnOff.mockReset().mockResolvedValue();
    backups.setFrequency.mockReset();
    backups.setKeep.mockReset();
    backups.backUpNow.mockReset().mockResolvedValue('saved');
    backups.probeFolder.mockReset().mockResolvedValue();
  });
  afterEach(() => vi.useRealTimers());

  describe('experimental camera counting', () => {
    it('offers the opt-in as a switch that saves the choice and shows it', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      expect(wrapper.findAll('.section-title').map((h) => h.text())).toContain('Experimental');
      const card = cameraCard(wrapper)!;
      const toggle = card.get('[role="switch"]');
      expect(toggle.attributes('aria-checked')).toBe('false');
      expect(toggle.attributes('disabled')).toBeUndefined();
      await toggle.trigger('click');
      expect(camera.setEnabled).toHaveBeenCalledExactlyOnceWith(true);

      camera.enabled.value = true;
      await flushPromises();
      expect(toggle.attributes('aria-checked')).toBe('true');
    });

    it('disables the switch where the browser has no camera API', async () => {
      camera.supported = false;
      const { wrapper } = await mountView(SettingsView, '/settings');
      const card = cameraCard(wrapper)!;
      expect(card.get('[role="switch"]').attributes('disabled')).toBeDefined();
      expect(card.text()).toContain('Not available in this browser.');
      expect(card.text()).not.toContain('Adds a Camera option');
    });

    it('explains the camera in the privacy information', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      await privacyButton(wrapper).trigger('click');
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
        'Camera (experimental).',
      );
    });

    it('says camera counts are suggestions in the terms', async () => {
      const { wrapper } = await mountView(SettingsView, '/settings');
      await termsButton(wrapper).trigger('click');
      const dialog = document.body.querySelector('[role="dialog"]');
      expect(dialog?.querySelector('.dialog-title')?.textContent).toBe('Terms of Use');
      expect(dialog?.textContent).toContain('Camera counts are suggestions.');
    });
  });

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
      expect(await privacyText(wrapper)).toContain(
        'api.github.com about once a day, and whenever you tap "Check now",',
      );
    });

    describe('check now', () => {
      // The switch's description also names Check now, so look for the button itself.
      const buttonTexts = (section: DOMWrapper<Element>) =>
        section.findAll('button').map((b) => b.text());

      // The card needs the app, a release build and the daily check on.
      async function mountChecking(options: Parameters<typeof mountView>[2] = {}) {
        mockNative();
        vi.stubGlobal('__APP_VERSION__', '1.2.0');
        updates.enabled.value = true;
        const { wrapper } = await mountView(SettingsView, '/settings', options);
        const section = updatesSection(wrapper)!;
        return {
          wrapper,
          section,
          button: () =>
            section.findAll('button').find((b) => /^(Check now|Checking…)$/.test(b.text()))!,
          result: () => section.get('[role="status"]').text(),
        };
      }

      it('is not offered while the daily check is off', async () => {
        mockNative();
        vi.stubGlobal('__APP_VERSION__', '1.2.0');
        const { wrapper } = await mountView(SettingsView, '/settings');
        const section = updatesSection(wrapper)!;
        expect(buttonTexts(section)).not.toContain('Check now');
        expect(section.text()).not.toContain('Not checked yet');
        expect(section.find('[role="status"]').exists()).toBe(false);
        expect(updates.checkNow).not.toHaveBeenCalled();
      });

      it('is not offered in a local build, which never checks', async () => {
        mockNative();
        updates.enabled.value = true;
        const { wrapper } = await mountView(SettingsView, '/settings');
        expect(buttonTexts(updatesSection(wrapper)!)).not.toContain('Check now');
      });

      it('shows when updates were last checked successfully', async () => {
        const { section } = await mountChecking();
        expect(section.text()).toContain('Not checked yet');
        updates.lastChecked.value = Date.parse('2026-05-01T12:00:00Z');
        await flushPromises();
        // ICU may put a narrow no-break space before PM.
        expect(section.text()).toMatch(/Last checked: May 1, 2026, 12:00\sPM/);
      });

      it('shows the date in the chosen language, also after a switch', async () => {
        const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, de } });
        updates.lastChecked.value = Date.parse('2026-05-01T12:00:00Z');
        const { section } = await mountChecking({ i18n });
        i18n.global.locale.value = 'de';
        await flushPromises();
        expect(section.text()).toContain('Zuletzt geprüft: 01.05.2026, 12:00');
      });

      it('shows Checking… until GitHub answers, then the answer', async () => {
        const answer = deferred<CheckOutcome | null>();
        updates.checkNow.mockReturnValueOnce(answer.promise);
        const { button, result } = await mountChecking();
        await button().trigger('click');
        expect(button().text()).toBe('Checking…');
        expect(button().attributes('disabled')).toBeDefined();
        expect(result()).toBe('');
        answer.resolve({ status: 'up-to-date' });
        await flushPromises();
        expect(result()).toBe("You're up to date.");
        expect(button().text()).toBe('Check now');
        expect(button().attributes('disabled')).toBeUndefined();
        expect(updates.checkNow).toHaveBeenCalledOnce();
      });

      it('names a newer release, or says the check failed', async () => {
        const { button, result } = await mountChecking();
        updates.checkNow.mockResolvedValueOnce({ status: 'available', version: [1, 3, 0] });
        await button().trigger('click');
        await flushPromises();
        expect(result()).toBe('Version 1.3.0 is available');

        vi.useFakeTimers();
        updates.checkNow.mockResolvedValueOnce({ status: 'failed' });
        await button().trigger('click');
        await flushPromises();
        vi.advanceTimersByTime(100);
        await flushPromises();
        expect(result()).toBe("Couldn't check for updates. Try again later.");
      });

      it('announces the same answer again on a repeat', async () => {
        const { button, result } = await mountChecking();
        await button().trigger('click');
        await flushPromises();
        expect(result()).toBe("You're up to date.");
        vi.useFakeTimers();
        await button().trigger('click');
        await flushPromises();
        // Blanked for a moment so screen readers announce the same text again
        expect(result()).toBe('');
        vi.advanceTimersByTime(100);
        await flushPromises();
        expect(result()).toBe("You're up to date.");
      });

      it('restarts the pause before a repeated answer on another quick tap', async () => {
        const { button, result } = await mountChecking();
        await button().trigger('click');
        await flushPromises();
        vi.useFakeTimers();
        await button().trigger('click');
        await flushPromises();
        vi.advanceTimersByTime(50);
        await button().trigger('click');
        await flushPromises();
        vi.advanceTimersByTime(50);
        await flushPromises();
        expect(result()).toBe('');
        vi.advanceTimersByTime(50);
        await flushPromises();
        expect(result()).toBe("You're up to date.");
      });

      it('offers Check now again after an unexpected error', async () => {
        const error = new Error('broken');
        updates.checkNow.mockRejectedValueOnce(error);
        const { wrapper, button } = await mountChecking();
        // Vue hands an event handler's rejection to the app's error handler.
        const handled: unknown[] = [];
        wrapper.vm.$.appContext.config.errorHandler = (err: unknown) => {
          handled.push(err);
        };
        await button().trigger('click');
        await flushPromises();
        expect(handled).toEqual([error]);
        expect(button().text()).toBe('Check now');
        expect(button().attributes('disabled')).toBeUndefined();
      });

      it('hides the last answer while checking again', async () => {
        const { button, result } = await mountChecking();
        await button().trigger('click');
        await flushPromises();
        expect(result()).toBe("You're up to date.");
        const answer = deferred<CheckOutcome | null>();
        updates.checkNow.mockReturnValueOnce(answer.promise);
        await button().trigger('click');
        expect(button().text()).toBe('Checking…');
        expect(result()).toBe('');
      });

      it('forgets the answer when a check in the background succeeds', async () => {
        const { button, result } = await mountChecking();
        await button().trigger('click');
        await flushPromises();
        expect(result()).toBe("You're up to date.");
        // The daily check, e.g. on resume, may find a newer release than the tap did.
        updates.lastChecked.value = Date.parse('2026-05-02T12:00:00Z');
        await flushPromises();
        expect(result()).toBe('');
      });

      it("keeps the answer of the tap's own successful check", async () => {
        updates.checkNow.mockImplementationOnce(async () => {
          await Promise.resolve();
          updates.lastChecked.value = Date.parse('2026-05-02T12:00:00Z');
          return { status: 'up-to-date' };
        });
        const { button, result } = await mountChecking();
        await button().trigger('click');
        await flushPromises();
        expect(result()).toBe("You're up to date.");
      });

      it('forgets the answer when the daily check is turned off', async () => {
        const { section, button, result } = await mountChecking();
        await button().trigger('click');
        await flushPromises();
        expect(result()).toBe("You're up to date.");
        updates.enabled.value = false;
        await flushPromises();
        expect(section.find('[role="status"]').exists()).toBe(false);
        updates.enabled.value = true;
        await flushPromises();
        expect(result()).toBe('');
      });

      it('forgets an answer that came back while the daily check was off', async () => {
        const answer = deferred<CheckOutcome | null>();
        updates.checkNow.mockReturnValueOnce(answer.promise);
        const { button, result } = await mountChecking();
        await button().trigger('click');
        updates.enabled.value = false;
        await flushPromises();
        answer.resolve({ status: 'up-to-date' });
        await flushPromises();
        updates.enabled.value = true;
        await flushPromises();
        expect(result()).toBe('');
        expect(button().text()).toBe('Check now');
      });

      it('leaves no timer running after leaving the page', async () => {
        const { wrapper, button } = await mountChecking();
        await button().trigger('click');
        await flushPromises();
        vi.useFakeTimers();
        await button().trigger('click'); // a repeat starts the re-announce timer
        await flushPromises();
        wrapper.unmount();
        expect(vi.getTimerCount()).toBe(0);
      });
    });
  });

  describe('automatic backups', () => {
    const backupsSection = (w: VueWrapper) =>
      w
        .findAll('section')
        .find((s) => s.element.querySelector('.section-title')?.textContent === 'Automatic backups');
    const privacyText = async (w: VueWrapper) => {
      await privacyButton(w).trigger('click');
      return document.body.querySelector('[role="dialog"]')!.textContent;
    };
    const button = (section: Pick<DOMWrapper<Element>, 'findAll'>, text: string | RegExp) =>
      section.findAll('button').find((b) => (typeof text === 'string' ? b.text() === text : text.test(b.text())));

    async function mountBackups(config: BackupConfig = BACKUPS_ON) {
      mockNative();
      backups.config.value = config;
      const { wrapper } = await mountView(SettingsView, '/settings');
      const section = backupsSection(wrapper)!;
      return {
        wrapper,
        section,
        toggle: () => section.get('[role="switch"]'),
        alerts: () => section.findAll('[role="alert"]').map((a) => a.text()),
        backUpButton: () => button(section, /^(Back up now|Backing up…)$/)!,
        result: () => section.get('.action-card [role="status"]').text(),
      };
    }

    it('are not offered on the website', async () => {
      backups.config.value = BACKUPS_ON;
      const { wrapper } = await mountView(SettingsView, '/settings');
      expect(backupsSection(wrapper)).toBeUndefined();
      expect(backups.probeFolder).not.toHaveBeenCalled();
      const privacy = await privacyText(wrapper);
      expect(privacy).not.toContain('Automatic backups (Android app).');
      // The new p4 is true on the website too.
      expect(privacy).toContain('No data sharing.');
      expect(privacy).toContain(
        'in the Android app, a backup folder that you sync or let other apps read.',
      );
      // Deleting the app doesn't delete backup files outside it (p7).
      expect(privacy).toContain(
        'permanently remove everything, except automatic backup files in a folder you picked in the Android app.',
      );
    });

    it('are off until turned on, and check the folder when Settings opens', async () => {
      const { section, toggle } = await mountBackups(BACKUPS_OFF);
      expect(section.text()).toContain('Back up automatically');
      expect(toggle().attributes('aria-checked')).toBe('false');
      expect(section.text()).not.toContain('Folder:');
      expect(button(section, 'Back up now')).toBeUndefined();
      expect(backups.probeFolder).toHaveBeenCalledOnce();
    });

    it('turning on opens the picker, with the switch disabled until it closes', async () => {
      const picked = deferred<'on' | 'cancelled' | 'unavailable'>();
      backups.turnOn.mockReturnValueOnce(picked.promise);
      const { toggle } = await mountBackups(BACKUPS_OFF);
      await toggle().trigger('click');
      expect(backups.turnOn).toHaveBeenCalledOnce();
      expect(toggle().attributes('disabled')).toBeDefined();
      picked.resolve('cancelled');
      await flushPromises();
      expect(toggle().attributes('disabled')).toBeUndefined();
      expect(toggle().attributes('aria-checked')).toBe('false');
    });

    it("says so when the picker can't open", async () => {
      backups.turnOn.mockResolvedValueOnce('unavailable');
      const { toggle, alerts } = await mountBackups(BACKUPS_OFF);
      await toggle().trigger('click');
      await flushPromises();
      expect(alerts()).toEqual(["Couldn't open the folder picker."]);
      // The next try clears it.
      await toggle().trigger('click');
      await flushPromises();
      expect(alerts()).toEqual([]);
    });

    it('turning off gives up the folder', async () => {
      const { toggle } = await mountBackups();
      expect(toggle().attributes('aria-checked')).toBe('true');
      await toggle().trigger('click');
      expect(backups.turnOff).toHaveBeenCalledOnce();
      expect(backups.turnOn).not.toHaveBeenCalled();
    });

    it('shows the folder and when the last backup was written', async () => {
      const { section } = await mountBackups();
      expect(section.text()).toContain('Folder: Backups');
      expect(section.text()).toContain('No backup yet');
      // Local noon (month 0-based), so the text holds in any process timezone.
      backups.lastSuccess.value = new Date(2026, 4, 1, 12).getTime();
      await flushPromises();
      // ICU may put a narrow no-break space before PM.
      expect(section.text()).toMatch(/Last backup: May 1, 2026, 12:00\sPM/);
    });

    it('changes the folder, and says so when the picker cannot open', async () => {
      const { section, alerts } = await mountBackups();
      backups.changeFolder.mockResolvedValueOnce('unavailable');
      await button(section, 'Change folder')!.trigger('click');
      await flushPromises();
      expect(backups.changeFolder).toHaveBeenCalledOnce();
      expect(alerts()).toEqual(["Couldn't open the folder picker."]);
    });

    it('offers the schedule and how many to keep as pressed buttons', async () => {
      const { section } = await mountBackups({ ...BACKUPS_ON, frequency: 'weekly', keep: 14 });
      const groups = section.findAll('[role="group"]');
      const labels = groups.map(
        (g) => section.get(`[id="${g.attributes('aria-labelledby')}"]`).text(),
      );
      expect(labels).toEqual(['Start a new file', 'Backups to keep']);
      const pressed = (g: DOMWrapper<Element>) =>
        g.findAll('button').map((b) => [b.text(), b.attributes('aria-pressed')]);
      expect(pressed(groups[0])).toEqual([
        ['Every day', 'false'],
        ['Every week', 'true'],
      ]);
      expect(pressed(groups[1])).toEqual([
        ['3', 'false'],
        ['7', 'false'],
        ['14', 'true'],
        ['30', 'false'],
      ]);
      expect(groups[1].get('.active').text()).toBe('14');

      await button(groups[0], 'Every day')!.trigger('click');
      expect(backups.setFrequency).toHaveBeenCalledExactlyOnceWith('daily');
      await button(groups[1], '30')!.trigger('click');
      expect(backups.setKeep).toHaveBeenCalledExactlyOnceWith(30);
    });

    it('Back up now shows Backing up… until it is done, then the outcome', async () => {
      const run = deferred<RunOutcome>();
      backups.backUpNow.mockReturnValueOnce(run.promise);
      const { backUpButton, result } = await mountBackups();
      await backUpButton().trigger('click');
      expect(backUpButton().text()).toBe('Backing up…');
      expect(backUpButton().attributes('disabled')).toBeDefined();
      run.resolve('saved');
      await flushPromises();
      expect(backUpButton().text()).toBe('Back up now');
      expect(result()).toBe('✓ Backed up');

      vi.useFakeTimers();
      backups.backUpNow.mockResolvedValueOnce('nothing');
      await backUpButton().trigger('click');
      await flushPromises();
      // Blanked for a moment so screen readers announce the change.
      expect(result()).toBe('');
      vi.advanceTimersByTime(100);
      await flushPromises();
      expect(result()).toBe('Nothing to back up yet: add a pet first.');
    });

    it('Back up now says it failed, and the warning says why, once', async () => {
      const { section, backUpButton, result, alerts } = await mountBackups();
      backups.backUpNow.mockImplementationOnce(async () => {
        backups.failure.value = 'full';
        return 'failed';
      });
      await backUpButton().trigger('click');
      await flushPromises();
      expect(result()).toBe('Backup failed');
      expect(section.get('.backup-warning').text()).toBe(
        'The last backup failed: the storage is full.',
      );
      expect(section.text().split('the storage is full').length - 1).toBe(1);
      expect(alerts()).toEqual([]);
      // A run that turned out fine replaces it (after the re-announce pause).
      backups.failure.value = null;
      await backUpButton().trigger('click');
      await vi.waitFor(() => expect(result()).toBe('✓ Backed up'));
    });

    it('choosing the folder again after a failed Back up now leaves no empty message behind', async () => {
      const { section, backUpButton, result } = await mountBackups();
      backups.backUpNow.mockImplementationOnce(async () => {
        backups.failure.value = 'missing';
        return 'failed';
      });
      await backUpButton().trigger('click');
      await flushPromises();
      backups.changeFolder.mockImplementationOnce(async () => {
        backups.failure.value = null;
        return 'changed';
      });
      await button(section.get('.backup-warning'), 'Choose folder again')!.trigger('click');
      await flushPromises();
      expect(section.findAll('.error-msg')).toEqual([]);
      expect(result()).toBe('');
    });

    it('a failure after Back up now replaces its "Backed up"', async () => {
      const { backUpButton, result } = await mountBackups();
      await backUpButton().trigger('click');
      await flushPromises();
      expect(result()).toBe('✓ Backed up');
      backups.failure.value = 'missing';
      await flushPromises();
      expect(result()).toBe('');
    });

    it('focus moves to Change folder once the folder is chosen again', async () => {
      backups.failure.value = 'missing';
      const { section } = await mountBackups();
      backups.changeFolder.mockImplementationOnce(async () => {
        backups.failure.value = null;
        return 'changed';
      });
      const chooseAgain = button(section.get('.backup-warning'), 'Choose folder again')!;
      (chooseAgain.element as HTMLButtonElement).focus();
      await chooseAgain.trigger('click');
      await flushPromises();
      expect(section.find('.backup-warning').exists()).toBe(false);
      expect(document.activeElement).toBe(button(section, 'Change folder')!.element);
    });

    it.each([
      ['revoked', 'CardiPaw can no longer write to the backup folder. Choose the folder again.', true],
      ['missing', "The backup folder can't be found.", true],
      ['full', 'The last backup failed: the storage is full.', false],
      ['failed', 'The last backup failed. CardiPaw tries again', false],
    ] as const)('shows a %s failure, with a way to fix it where there is one', async (kind, text, offersPick) => {
      backups.failure.value = kind;
      const { section } = await mountBackups();
      const warning = section.get('.backup-warning');
      expect(warning.attributes('role')).toBe('status');
      expect(warning.text()).toContain(text);
      const chooseAgain = button(warning, 'Choose folder again');
      expect(chooseAgain !== undefined).toBe(offersPick);
      if (chooseAgain) {
        await chooseAgain.trigger('click');
        expect(backups.changeFolder).toHaveBeenCalledOnce();
      }
    });

    it('explains automatic backups in the privacy information in the app', async () => {
      const { wrapper } = await mountBackups(BACKUPS_OFF);
      expect(await privacyText(wrapper)).toContain(
        'Automatic backups (Android app). If you turn on automatic backups',
      );
    });

    it('leaves no timer running after leaving the page', async () => {
      const { wrapper, backUpButton } = await mountBackups();
      await backUpButton().trigger('click');
      await flushPromises();
      vi.useFakeTimers();
      await backUpButton().trigger('click'); // a repeat starts the re-announce timer
      await flushPromises();
      wrapper.unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
