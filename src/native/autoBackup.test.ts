import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@capacitor/app';
import { onDataChanged } from '../services/db';
import {
  backupIfDue,
  flushPendingBackup,
  noteDataChanged,
  probeFolder,
} from '../composables/useAutoBackup';
import { deferred } from '../test/deferred';
import { mockNative } from '../test/native';
import { installAutoBackup } from './autoBackup';

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: async () => {} })) },
}));
vi.mock('../services/db', () => ({ onDataChanged: vi.fn(() => () => {}) }));
vi.mock('../composables/useAutoBackup', () => ({
  backupIfDue: vi.fn(async () => {}),
  flushPendingBackup: vi.fn(),
  noteDataChanged: vi.fn(),
  probeFolder: vi.fn(async () => {}),
}));

function listener(event: string): () => void {
  const call = vi.mocked(App.addListener).mock.calls.find(([name]) => name === event);
  return call![1] as () => void;
}

describe('installAutoBackup', () => {
  beforeEach(() => {
    vi.mocked(App.addListener).mockClear();
    vi.mocked(onDataChanged).mockClear();
    vi.mocked(backupIfDue).mockClear();
    vi.mocked(flushPendingBackup).mockClear();
    vi.mocked(probeFolder).mockClear();
  });

  it('checks the folder before a backup that is due at startup', async () => {
    mockNative();
    const probe = deferred<void>();
    vi.mocked(probeFolder).mockReturnValueOnce(probe.promise);
    installAutoBackup();
    expect(probeFolder).toHaveBeenCalledOnce();
    expect(backupIfDue).not.toHaveBeenCalled();
    probe.resolve();
    await vi.waitFor(() => expect(backupIfDue).toHaveBeenCalledOnce());
  });

  it('backs up after data changes, when due on resume, and flushes on pause', () => {
    mockNative();
    installAutoBackup();
    expect(onDataChanged).toHaveBeenCalledWith(noteDataChanged);
    vi.mocked(backupIfDue).mockClear();
    listener('resume')();
    expect(backupIfDue).toHaveBeenCalledOnce();
    listener('pause')();
    expect(flushPendingBackup).toHaveBeenCalledOnce();
  });

  it('does nothing on the website', () => {
    mockNative(false);
    installAutoBackup();
    expect(onDataChanged).not.toHaveBeenCalled();
    expect(probeFolder).not.toHaveBeenCalled();
    expect(backupIfDue).not.toHaveBeenCalled();
    expect(App.addListener).not.toHaveBeenCalled();
  });
});
