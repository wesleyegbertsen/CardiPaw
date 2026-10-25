// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, type VueWrapper } from '@vue/test-utils';
import SettingsView from './SettingsView.vue';
import * as backup from '../services/backup';
import { mountView, settle } from '../test/mountView';
import { makeNote, makePet, makeReading } from '../test/fixtures';

// Keep parsing and validation real; only the IndexedDB-touching calls are faked.
vi.mock('../services/backup', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/backup')>();
  return { ...real, downloadBackup: vi.fn(), importBackup: vi.fn() };
});

enableAutoUnmount(afterEach);

const exportButton = (w: VueWrapper) => w.findAll('.action-btn')[0];
const importButton = (w: VueWrapper) => w.findAll('.action-btn')[1];
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
    vi.mocked(backup.downloadBackup).mockReset().mockResolvedValue();
    vi.mocked(backup.importBackup).mockReset().mockResolvedValue();
  });
  afterEach(() => vi.useRealTimers());

  it('says the data and the export include notes', async () => {
    const { wrapper } = await mountView(SettingsView, '/settings');
    expect(wrapper.text()).toContain('Your pet profiles, readings and notes are stored locally');
    expect(wrapper.text()).toContain('Download all pets, readings and notes as JSON');
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

  it('opens and closes the privacy information', async () => {
    const { wrapper } = await mountView(SettingsView, '/settings');
    await wrapper.findAll('.action-btn')[2].trigger('click');
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.querySelector('.dialog-title')?.textContent).toBe('Privacy Policy');

    clickInBody('.btn-ok');
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
