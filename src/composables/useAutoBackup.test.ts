import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createPinia, setActivePinia } from 'pinia';
import { mockNative } from '../test/native';
import { deferred } from '../test/deferred';
import { makePet, makeReading } from '../test/fixtures';
import { parseBackup } from '../services/backup';

vi.mock('../native/backupFolder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../native/backupFolder')>()),
  BackupFolder: {
    pickFolder: vi.fn(),
    releaseFolder: vi.fn(async () => {}),
    checkFolder: vi.fn(async () => ({ name: 'Backups' })),
    writeFile: vi.fn(async () => {}),
    listFiles: vi.fn(async () => ({ names: [] as string[] })),
    deleteFile: vi.fn(async () => {}),
  },
}));
// The pets store, which importBackup reloads, imports it.
vi.mock('../native/reminders', () => ({ syncReminders: vi.fn(async () => {}) }));

const URI = 'content://com.android.externalstorage.documents/tree/primary%3ABackups';
const OTHER_URI = 'content://com.android.externalstorage.documents/tree/primary%3AOther';
// Local noon (month 0-based), a Friday: the file names hold in any process timezone.
const NOW = new Date(2026, 10, 6, 12);
const TODAY = 'cardipaw-backup-2026-11-06.json';

// The config and state are read once, when the module is first imported: a fresh import is a restart.
async function load() {
  vi.resetModules();
  const db = await import('../services/db');
  const { BackupFolder } = await import('../native/backupFolder');
  const module = await import('./useAutoBackup');
  db.onDataChanged(module.noteDataChanged);
  return { db, plugin: vi.mocked(BackupFolder), ...module, backup: module.useAutoBackup() };
}

function turnedOn(overrides: Record<string, unknown> = {}) {
  localStorage.setItem(
    'cardipaw-auto-backup',
    JSON.stringify({
      enabled: true,
      folderUri: URI,
      folderName: 'Backups',
      frequency: 'daily',
      keep: 7,
      ...overrides,
    }),
  );
}
const storeState = (state: Record<string, unknown>) =>
  localStorage.setItem('cardipaw-auto-backup-state', JSON.stringify(state));
const savedState = () => JSON.parse(localStorage.getItem('cardipaw-auto-backup-state') ?? '{}');
const savedConfig = () => JSON.parse(localStorage.getItem('cardipaw-auto-backup') ?? '{}');
/**
 * The app is killed: its pending timers never fire. clearAllTimers also resets the fake clock
 * to the real time, so the clock is set back.
 */
function killApp() {
  vi.clearAllTimers();
  vi.setSystemTime(NOW);
}
// fake-indexeddb settles requests on real setImmediate turns, which the fake timers leave alone.
async function settleIndexedDb() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}
const rejectWith = (code: string) => Object.assign(new Error(`failed for ${URI}`), { code });

describe('useAutoBackup', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    mockNative();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it('is off by default: changes and resumes call no plugin method', async () => {
    const { db, plugin, backupIfDue, probeFolder } = await load();
    await db.savePet(makePet());
    await vi.advanceTimersByTimeAsync(10_000);
    await probeFolder();
    await backupIfDue();
    for (const fn of Object.values(plugin)) expect(fn).not.toHaveBeenCalled();
  });

  it('writes once, 3 s after the last of several changes, the same file Export saves', async () => {
    turnedOn();
    const { db, plugin } = await load();
    await db.savePet(makePet());
    await vi.advanceTimersByTimeAsync(2000);
    await db.saveReading(makeReading());
    await vi.advanceTimersByTimeAsync(2999);
    expect(plugin.writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(plugin.writeFile).toHaveBeenCalledOnce());
    const { uri, name, text } = plugin.writeFile.mock.calls[0][0];
    expect(uri).toBe(URI);
    expect(name).toBe(TODAY);
    expect(parseBackup(text).data.readings).toEqual([makeReading()]);
    await vi.waitFor(() =>
      expect(savedState()).toEqual({
        lastSuccess: expect.any(Number),
        lastFile: name,
        dirty: false,
      }),
    );
  });

  it('a change during a write causes exactly one more write, with the new data', async () => {
    turnedOn();
    const { db, plugin, backup } = await load();
    await db.savePet(makePet());
    const first = deferred<void>();
    plugin.writeFile.mockImplementationOnce(() => first.promise);
    const run = backup.backUpNow();
    expect(backup.running.value).toBe(true);
    await vi.waitFor(() => expect(plugin.writeFile).toHaveBeenCalledOnce());
    await db.saveReading(makeReading());
    await db.saveReading(makeReading({ id: 'reading-2' }));
    const joined = backup.backUpNow();
    expect(savedState().dirty).toBe(true);
    // Time for a second run to read the data and write, if one were started alongside.
    await settleIndexedDb();
    expect(plugin.writeFile).toHaveBeenCalledOnce();
    first.resolve();
    expect(await run).toBe('saved');
    expect(await joined).toBe('saved');
    expect(backup.running.value).toBe(false);
    expect(plugin.writeFile).toHaveBeenCalledTimes(2);
    expect(parseBackup(plugin.writeFile.mock.calls[1][0].text).data.readings).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000); // the debounce was covered by the rerun
    expect(plugin.writeFile).toHaveBeenCalledTimes(2);
    expect(savedState().dirty).toBe(false);
  });

  it('a change that lands during a write is still written after a restart', async () => {
    turnedOn();
    const first = await load();
    await first.db.savePet(makePet());
    const write = deferred<void>();
    first.plugin.writeFile.mockImplementationOnce(() => write.promise);
    const run = first.backup.backUpNow();
    await vi.waitFor(() => expect(first.plugin.writeFile).toHaveBeenCalledOnce());
    await first.db.saveReading(makeReading());
    write.resolve();
    expect(await run).toBe('saved');
    // The file just written is today's, but it misses the reading.
    expect(savedState()).toMatchObject({ lastFile: TODAY, dirty: true });
    killApp(); // inside the debounce window

    const next = await load();
    await next.backupIfDue();
    // The mocks outlive vi.resetModules: the first call is the write before the restart.
    expect(next.plugin.writeFile).toHaveBeenCalledTimes(2);
    expect(parseBackup(next.plugin.writeFile.mock.calls[1][0].text).data.readings).toHaveLength(1);
  });

  it('a change saved just before a restart is written at the next start', async () => {
    turnedOn();
    const first = await load();
    await first.db.savePet(makePet());
    expect(first.plugin.writeFile).not.toHaveBeenCalled();
    killApp(); // inside the debounce window

    const next = await load();
    await next.backupIfDue();
    expect(next.plugin.writeFile).toHaveBeenCalledOnce();
  });

  it('with no pets writes nothing and prunes nothing', async () => {
    turnedOn();
    const { plugin, backup } = await load();
    expect(await backup.backUpNow()).toBe('nothing');
    expect(plugin.writeFile).not.toHaveBeenCalled();
    expect(plugin.listFiles).not.toHaveBeenCalled();
    expect(plugin.deleteFile).not.toHaveBeenCalled();
  });

  it('a failed write prunes nothing and shows until dismissed; a new kind shows again', async () => {
    turnedOn();
    const { db, plugin, backup } = await load();
    await db.savePet(makePet());
    plugin.writeFile.mockRejectedValueOnce(rejectWith('FOLDER_MISSING'));
    expect(await backup.backUpNow()).toBe('failed');
    expect(plugin.listFiles).not.toHaveBeenCalled();
    expect(backup.failure.value).toBe('missing');
    expect(backup.showNotice.value).toBe(true);
    backup.dismissNotice();
    expect(backup.showNotice.value).toBe(false);
    plugin.writeFile.mockRejectedValueOnce(rejectWith('FOLDER_MISSING'));
    await backup.backUpNow();
    expect(backup.showNotice.value).toBe(false);
    plugin.writeFile.mockRejectedValueOnce(rejectWith('PERMISSION_REVOKED'));
    await backup.backUpNow();
    expect(backup.showNotice.value).toBe(true);
    expect(await backup.backUpNow()).toBe('saved');
    expect(backup.failure.value).toBeNull();
    expect(backup.lastSuccess.value).toEqual(expect.any(Number));
  });

  it('prunes to keep after a success', async () => {
    turnedOn();
    const { db, plugin, backup } = await load();
    await db.savePet(makePet());
    const days = Array.from(
      { length: 9 },
      (_, i) => `cardipaw-backup-2026-10-${String(20 + i).padStart(2, '0')}.json`,
    );
    plugin.listFiles.mockResolvedValueOnce({ names: [...days, TODAY, 'mine.json'] });
    await backup.backUpNow();
    expect(plugin.deleteFile.mock.calls.map(([o]) => o.name)).toEqual(days.slice(0, 3).reverse());
  });

  it('a failed prune still counts as a backup', async () => {
    turnedOn();
    const { db, plugin, backup } = await load();
    await db.savePet(makePet());
    plugin.listFiles.mockRejectedValueOnce(rejectWith('FAILED'));
    expect(await backup.backUpNow()).toBe('saved');
    expect(backup.failure.value).toBeNull();
    expect(warn).toHaveBeenCalledWith('Pruning old backups failed', 'FAILED');
  });

  it('a full storage is reported as full', async () => {
    turnedOn();
    const { db, plugin, backup } = await load();
    await db.savePet(makePet());
    plugin.writeFile.mockRejectedValueOnce(rejectWith('STORAGE_FULL'));
    expect(await backup.backUpNow()).toBe('failed');
    expect(backup.failure.value).toBe('full');
  });

  it('a failure to read the data is reported as failed, and nothing is written', async () => {
    turnedOn();
    const { db, plugin, backup } = await load();
    await db.savePet(makePet());
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(() => {
      throw new DOMException('Injected read failure', 'UnknownError');
    });
    expect(await backup.backUpNow()).toBe('failed');
    expect(backup.failure.value).toBe('failed');
    expect(plugin.writeFile).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'Automatic backup: reading the data failed',
      expect.anything(),
    );
  });

  it('never logs the folder URI', async () => {
    turnedOn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, plugin, backup } = await load();
    await db.savePet(makePet());
    plugin.writeFile.mockRejectedValueOnce(rejectWith('WRITE_FAILED'));
    await backup.backUpNow();
    plugin.listFiles.mockRejectedValueOnce(rejectWith('FAILED'));
    await backup.backUpNow();
    plugin.pickFolder.mockRejectedValueOnce(rejectWith('UNAVAILABLE'));
    await backup.changeFolder();
    plugin.releaseFolder.mockRejectedValueOnce(rejectWith('FAILED'));
    await backup.turnOff();
    expect(warn).toHaveBeenCalledTimes(4);
    for (const args of [...warn.mock.calls, ...error.mock.calls])
      for (const arg of args) expect(String(arg)).not.toContain('content://');
  });

  it('keeps the folder and settings out of the exported data', async () => {
    turnedOn();
    const { db, backup } = await load();
    await db.savePet(makePet());
    await backup.backUpNow();
    const { exportBackup } = await import('../services/backup');
    const text = JSON.stringify(await exportBackup());
    expect(text).not.toContain('content://');
    expect(text).not.toContain('cardipaw-auto-backup');
  });

  it('an import is a change: it is written 3 s later with the imported pets', async () => {
    turnedOn();
    setActivePinia(createPinia());
    const { plugin } = await load();
    const { importBackup } = await import('../services/backup');
    const pet = makePet({ id: 'imported', name: 'Imported' });
    await importBackup({ version: 1, exportedAt: '', pets: [pet], readings: [], notes: [] });
    await vi.advanceTimersByTimeAsync(2999);
    expect(plugin.writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(plugin.writeFile).toHaveBeenCalledOnce());
    expect(parseBackup(plugin.writeFile.mock.calls[0][0].text).data.pets).toEqual([pet]);
  });

  describe('loading the saved config and state', () => {
    it('reads a damaged value as the defaults: off, daily, keep 7', async () => {
      for (const damaged of ['not json', '[1]', 'null', '{"enabled":true,"folderUri":""}']) {
        localStorage.setItem('cardipaw-auto-backup', damaged);
        localStorage.setItem('cardipaw-auto-backup-state', damaged);
        const { backup, plugin } = await load();
        expect(backup.config.value, damaged).toEqual({
          enabled: false,
          frequency: 'daily',
          keep: 7,
        });
        expect(backup.lastSuccess.value).toBeNull();
        expect(backup.failure.value).toBeNull();
        expect(await backup.backUpNow()).toBe('off');
        expect(plugin.writeFile).not.toHaveBeenCalled();
      }
    });

    it('keeps the valid fields of a partial value and drops the rest', async () => {
      localStorage.setItem(
        'cardipaw-auto-backup',
        JSON.stringify({ enabled: true, folderName: 5, frequency: 'hourly', keep: 5 }),
      );
      storeState({
        lastSuccess: 'yesterday',
        lastFile: 7,
        failure: 'boom',
        dismissed: 'full',
        dirty: 'yes',
      });
      const { backup } = await load();
      // Enabled without a folder is off.
      expect(backup.config.value).toEqual({ enabled: false, frequency: 'daily', keep: 7 });
      expect(backup.lastSuccess.value).toBeNull();
      expect(backup.failure.value).toBeNull();

      turnedOn({ frequency: 'weekly', keep: 14 });
      storeState({ lastSuccess: 1, failure: 'revoked', dismissed: 'missing', dirty: true });
      const reloaded = await load();
      expect(reloaded.backup.config.value).toEqual({
        enabled: true,
        folderUri: URI,
        folderName: 'Backups',
        frequency: 'weekly',
        keep: 14,
      });
      expect(reloaded.backup.lastSuccess.value).toBe(1);
      expect(reloaded.backup.failure.value).toBe('revoked');
      expect(reloaded.backup.showNotice.value).toBe(true);
    });
  });

  describe('turnOn', () => {
    it('stays off, with no failure, when the picker is closed without a folder', async () => {
      const { plugin, backup } = await load();
      plugin.pickFolder.mockRejectedValueOnce(rejectWith('CANCELLED'));
      expect(await backup.turnOn()).toBe('cancelled');
      expect(backup.config.value.enabled).toBe(false);
      expect(backup.failure.value).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it("reports 'unavailable' when the picker can't open", async () => {
      const { plugin, backup } = await load();
      plugin.pickFolder.mockRejectedValueOnce(rejectWith('UNAVAILABLE'));
      expect(await backup.turnOn()).toBe('unavailable');
      expect(backup.config.value.enabled).toBe(false);
      expect(warn).toHaveBeenCalledWith('The folder picker failed', 'UNAVAILABLE');
    });

    it("saves the folder and writes today's file at once", async () => {
      const { db, plugin, backup } = await load();
      await db.savePet(makePet());
      plugin.pickFolder.mockResolvedValueOnce({ uri: URI, name: 'Backups' });
      expect(await backup.turnOn()).toBe('on');
      expect(savedConfig()).toEqual({
        enabled: true,
        folderUri: URI,
        folderName: 'Backups',
        frequency: 'daily',
        keep: 7,
      });
      await vi.waitFor(() =>
        expect(plugin.writeFile).toHaveBeenCalledWith({
          uri: URI,
          name: TODAY,
          text: expect.any(String),
        }),
      );
    });

    it('releases a folder an earlier turnOff could not release', async () => {
      turnedOn({ enabled: false });
      const { plugin, backup } = await load();
      plugin.pickFolder.mockResolvedValueOnce({ uri: OTHER_URI, name: 'Other' });
      expect(await backup.turnOn()).toBe('on');
      expect(plugin.releaseFolder).toHaveBeenCalledWith({ uri: URI });
      expect(savedConfig()).toMatchObject({ enabled: true, folderUri: OTHER_URI });
    });

    it('picking the folder an earlier turnOff could not release keeps its grant', async () => {
      turnedOn({ enabled: false });
      const { plugin, backup } = await load();
      plugin.pickFolder.mockResolvedValueOnce({ uri: URI, name: 'Backups' });
      expect(await backup.turnOn()).toBe('on');
      expect(plugin.releaseFolder).not.toHaveBeenCalled();
    });
  });

  describe('changeFolder', () => {
    it('picking the same folder keeps its grant', async () => {
      turnedOn();
      const { plugin, backup } = await load();
      plugin.pickFolder.mockResolvedValueOnce({ uri: URI, name: 'Backups' });
      expect(await backup.changeFolder()).toBe('changed');
      expect(plugin.releaseFolder).not.toHaveBeenCalled();
    });

    it('picking another folder releases the old one and backs up to the new one', async () => {
      turnedOn();
      storeState({ failure: 'revoked' });
      const { db, plugin, backup } = await load();
      await db.savePet(makePet());
      plugin.pickFolder.mockResolvedValueOnce({ uri: OTHER_URI, name: 'Other' });
      expect(await backup.changeFolder()).toBe('changed');
      expect(plugin.releaseFolder).toHaveBeenCalledWith({ uri: URI });
      expect(backup.config.value).toMatchObject({ folderUri: OTHER_URI, folderName: 'Other' });
      expect(backup.failure.value).toBeNull();
      await vi.waitFor(() =>
        expect(plugin.writeFile).toHaveBeenCalledWith(expect.objectContaining({ uri: OTHER_URI })),
      );
    });

    it('a closed picker keeps the old folder', async () => {
      turnedOn();
      const { plugin, backup } = await load();
      plugin.pickFolder.mockRejectedValueOnce(rejectWith('CANCELLED'));
      expect(await backup.changeFolder()).toBe('cancelled');
      expect(backup.config.value).toMatchObject({ enabled: true, folderUri: URI });
      expect(plugin.releaseFolder).not.toHaveBeenCalled();
    });
  });

  describe('turnOff', () => {
    it('releases the grant, clears the state and keeps the schedule', async () => {
      turnedOn({ frequency: 'weekly', keep: 3 });
      storeState({ lastSuccess: 1, lastFile: TODAY, failure: 'full' });
      const { plugin, backup } = await load();
      await backup.turnOff();
      expect(plugin.releaseFolder).toHaveBeenCalledWith({ uri: URI });
      expect(savedConfig()).toEqual({ enabled: false, frequency: 'weekly', keep: 3 });
      expect(savedState()).toEqual({});
      expect(backup.showNotice.value).toBe(false);
    });

    it('keeps the folder saved when releasing it fails, so turning on again releases it', async () => {
      turnedOn();
      const { plugin, backup } = await load();
      plugin.releaseFolder.mockRejectedValueOnce(rejectWith('FAILED'));
      await backup.turnOff();
      expect(plugin.releaseFolder).toHaveBeenCalledWith({ uri: URI });
      expect(savedConfig()).toEqual({
        enabled: false,
        folderUri: URI,
        frequency: 'daily',
        keep: 7,
      });
      expect(backup.config.value.enabled).toBe(false);
      plugin.pickFolder.mockResolvedValueOnce({ uri: OTHER_URI, name: 'Other' });
      await backup.turnOn();
      expect(plugin.releaseFolder).toHaveBeenCalledTimes(2);
      expect(plugin.releaseFolder).toHaveBeenLastCalledWith({ uri: URI });
    });

    it('a folder picked while the release is still running stays on', async () => {
      turnedOn();
      const { plugin, backup } = await load();
      const released = deferred<void>();
      plugin.releaseFolder.mockImplementationOnce(() => released.promise);
      const off = backup.turnOff();
      plugin.pickFolder.mockResolvedValueOnce({ uri: OTHER_URI, name: 'Other' });
      await backup.turnOn();
      released.resolve();
      await off;
      expect(savedConfig()).toMatchObject({ enabled: true, folderUri: OTHER_URI });
    });

    it('a change still waiting for its debounce is never written', async () => {
      turnedOn();
      const { db, plugin, backup } = await load();
      await db.savePet(makePet());
      await backup.turnOff();
      await vi.advanceTimersByTimeAsync(10_000);
      await db.saveReading(makeReading());
      await vi.advanceTimersByTimeAsync(10_000);
      expect(plugin.writeFile).not.toHaveBeenCalled();
    });

    it('a run that finishes after it records nothing', async () => {
      turnedOn();
      const { db, plugin, backup } = await load();
      await db.savePet(makePet());
      const write = deferred<void>();
      plugin.writeFile.mockImplementationOnce(() => write.promise);
      const run = backup.backUpNow();
      await vi.waitFor(() => expect(plugin.writeFile).toHaveBeenCalledOnce());
      await backup.turnOff();
      write.resolve();
      expect(await run).toBe('off');
      expect(savedState()).toEqual({});
      expect(plugin.listFiles).not.toHaveBeenCalled();
    });

    it('a run that fails after it records nothing', async () => {
      turnedOn();
      const { db, plugin, backup } = await load();
      await db.savePet(makePet());
      const write = deferred<void>();
      plugin.writeFile.mockImplementationOnce(() => write.promise);
      const run = backup.backUpNow();
      await vi.waitFor(() => expect(plugin.writeFile).toHaveBeenCalledOnce());
      await backup.turnOff();
      write.reject(rejectWith('WRITE_FAILED'));
      expect(await run).toBe('off');
      expect(savedState()).toEqual({});
    });
  });

  describe('flushPendingBackup', () => {
    it('writes a change still waiting for its debounce at once, and only once', async () => {
      turnedOn();
      const { db, plugin, flushPendingBackup } = await load();
      await db.savePet(makePet());
      flushPendingBackup();
      await vi.waitFor(() => expect(plugin.writeFile).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(10_000);
      expect(plugin.writeFile).toHaveBeenCalledOnce();
    });

    it('writes nothing when no change is waiting', async () => {
      turnedOn();
      const { plugin, flushPendingBackup } = await load();
      flushPendingBackup();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(plugin.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('backupIfDue (start and resume)', () => {
    it('writes nothing on the same day when nothing changed', async () => {
      turnedOn();
      const { db } = await load();
      await db.savePet(makePet());
      killApp(); // that change is older than the last backup below
      storeState({ lastSuccess: NOW.getTime(), lastFile: TODAY });
      const { plugin, backupIfDue } = await load();
      await backupIfDue();
      expect(plugin.writeFile).not.toHaveBeenCalled();
    });

    it("writes the next day's file on the next day", async () => {
      turnedOn();
      const { db } = await load();
      await db.savePet(makePet());
      killApp();
      storeState({ lastSuccess: NOW.getTime(), lastFile: TODAY });
      vi.setSystemTime(new Date(2026, 10, 7, 0, 5));
      const { plugin, backupIfDue } = await load();
      await backupIfDue();
      expect(plugin.writeFile).toHaveBeenCalledOnce();
      expect(plugin.writeFile.mock.calls[0][0].name).toBe('cardipaw-backup-2026-11-07.json');
    });

    it("weekly: names the file for the week's Monday and starts a new one on the next Monday", async () => {
      turnedOn({ frequency: 'weekly' });
      const { db } = await load();
      await db.savePet(makePet());
      killApp();
      storeState({ lastSuccess: NOW.getTime(), lastFile: 'cardipaw-backup-2026-11-02.json' });
      const friday = await load();
      await friday.backupIfDue();
      expect(friday.plugin.writeFile).not.toHaveBeenCalled();

      vi.setSystemTime(new Date(2026, 10, 9, 8)); // Monday
      const monday = await load();
      await monday.backupIfDue();
      expect(monday.plugin.writeFile.mock.calls[0][0].name).toBe('cardipaw-backup-2026-11-09.json');
    });

    it('retries after a failure', async () => {
      turnedOn();
      const { db } = await load();
      await db.savePet(makePet());
      killApp();
      storeState({ lastSuccess: NOW.getTime(), lastFile: TODAY, failure: 'failed' });
      const { plugin, backupIfDue, backup } = await load();
      await backupIfDue();
      expect(plugin.writeFile).toHaveBeenCalledOnce();
      expect(backup.failure.value).toBeNull();
    });
  });

  describe('probeFolder', () => {
    it.each([
      ['PERMISSION_REVOKED', 'revoked'],
      ['FOLDER_MISSING', 'missing'],
    ])('records %s as %s', async (code, kind) => {
      turnedOn();
      const { plugin, probeFolder, backup } = await load();
      plugin.checkFolder.mockRejectedValueOnce(rejectWith(code));
      await probeFolder();
      expect(plugin.checkFolder).toHaveBeenCalledWith({ uri: URI });
      expect(backup.failure.value).toBe(kind);
      expect(backup.showNotice.value).toBe(true);
    });

    it('ignores other errors: only a write can tell those', async () => {
      turnedOn();
      const { plugin, probeFolder, backup } = await load();
      plugin.checkFolder.mockRejectedValueOnce(rejectWith('WRITE_FAILED'));
      await probeFolder();
      expect(backup.failure.value).toBeNull();
    });

    it('backs up at once when the missing folder is back', async () => {
      turnedOn();
      const { db } = await load();
      await db.savePet(makePet());
      killApp();
      storeState({ lastSuccess: NOW.getTime(), lastFile: TODAY, failure: 'missing' });
      const { plugin, probeFolder, backup } = await load();
      await probeFolder();
      expect(plugin.writeFile).toHaveBeenCalledOnce();
      expect(backup.failure.value).toBeNull();
    });

    it('does not write when the folder is fine and nothing failed', async () => {
      turnedOn();
      const { plugin, probeFolder } = await load();
      await probeFolder();
      expect(plugin.checkFolder).toHaveBeenCalledOnce();
      expect(plugin.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('settings', () => {
    it('a new schedule is saved and backs up at once under its name', async () => {
      turnedOn();
      const { db, plugin, backup } = await load();
      await db.savePet(makePet());
      backup.setFrequency('weekly');
      expect(savedConfig().frequency).toBe('weekly');
      await vi.waitFor(() =>
        expect(plugin.writeFile).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'cardipaw-backup-2026-11-02.json' }),
        ),
      );
    });

    it('choosing the schedule or count already set writes nothing', async () => {
      // Saving the config would drop the unknown field: the stored text shows whether it was saved.
      turnedOn({ unknown: 1 });
      const stored = localStorage.getItem('cardipaw-auto-backup');
      const { db, plugin, backup } = await load();
      await db.savePet(makePet());
      await backup.backUpNow();
      plugin.writeFile.mockClear();
      backup.setFrequency('daily');
      backup.setKeep(7);
      await vi.advanceTimersByTimeAsync(10_000);
      await settleIndexedDb();
      expect(plugin.writeFile).not.toHaveBeenCalled();
      expect(localStorage.getItem('cardipaw-auto-backup')).toBe(stored);
    });

    it('a new schedule while off is saved without a backup', async () => {
      const { plugin, backup } = await load();
      backup.setFrequency('weekly');
      backup.setKeep(30);
      expect(savedConfig()).toEqual({ enabled: false, frequency: 'weekly', keep: 30 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(plugin.writeFile).not.toHaveBeenCalled();
    });

    it('dismissing with no failure changes nothing', async () => {
      turnedOn();
      const { backup } = await load();
      backup.dismissNotice();
      expect(localStorage.getItem('cardipaw-auto-backup-state')).toBeNull();
    });
  });

  it('does nothing on the website, even with a config saved by the app', async () => {
    mockNative(false);
    turnedOn();
    storeState({ failure: 'missing' });
    const { db, plugin, backup, backupIfDue, probeFolder, flushPendingBackup } = await load();
    await db.savePet(makePet());
    flushPendingBackup();
    await vi.advanceTimersByTimeAsync(10_000);
    await probeFolder();
    await backupIfDue();
    expect(await backup.backUpNow()).toBe('off');
    expect(backup.showNotice.value).toBe(false);
    for (const fn of Object.values(plugin)) expect(fn).not.toHaveBeenCalled();
  });
});
