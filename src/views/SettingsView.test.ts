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
    updates.lastChecked.value = null;
    updates.setEnabled.mockReset();
    updates.checkNow.mockReset().mockResolvedValue({ status: 'up-to-date' });
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

      it('drops an answer that comes back after the daily check was turned off', async () => {
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
});
