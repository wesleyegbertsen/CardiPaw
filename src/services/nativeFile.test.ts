import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Directory, Encoding, Filesystem, type FileInfo } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { cleanUpExports, shareFile } from './nativeFile';

vi.mock('@capacitor/filesystem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/filesystem')>()),
  Filesystem: {
    writeFile: vi.fn(async () => ({ uri: 'file:///cache/f' })),
    readdir: vi.fn(async () => ({ files: [] })),
    rmdir: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
  },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(async () => ({})) } }));

const opts = {
  name: 'a.json',
  data: '{}',
  encoding: 'utf8',
  subject: 'Backup',
  dialogTitle: 'Save',
} as const;

const HOUR = 60 * 60 * 1000;
/** An entry of cache/exports/ as readdir lists it; `ageMs` ago it was last modified. */
function entry(name: string, ageMs = 0, type: FileInfo['type'] = 'directory'): FileInfo {
  return { name, type, size: 0, mtime: Date.now() - ageMs, uri: `file:///cache/exports/${name}` };
}
function listExports(...files: FileInfo[]) {
  vi.mocked(Filesystem.readdir).mockResolvedValueOnce({ files });
}
/** The plugin's error: the Android bridge copies its `code` onto the rejected error. */
function fsError(code: string) {
  return Object.assign(new Error(`failed (${code})`), { code });
}
// A uuid folder per export: exports/<36-char id>/<name>.
const exportPath = (name: string) =>
  new RegExp(`^exports/[0-9a-f-]{36}/${name.replace('.', '\\.')}$`);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('shareFile', () => {
  it('writes UTF-8 text to its own folder in the cache and shares that file', async () => {
    await expect(shareFile(opts)).resolves.toBe('shared');
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: expect.stringMatching(exportPath('a.json')),
      data: '{}',
      directory: Directory.Cache,
      recursive: true,
      encoding: Encoding.UTF8,
    });
    expect(Share.share).toHaveBeenCalledWith({
      // The subject goes to apps that take one (email); the dialog title heads the sheet.
      title: 'Backup',
      dialogTitle: 'Save',
      files: ['file:///cache/f'],
    });
  });

  it('writes base64 data without an encoding, so the plugin decodes it', async () => {
    await shareFile({ ...opts, name: 'r.pdf', data: 'JVBE', encoding: 'base64' });
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: expect.stringMatching(exportPath('r.pdf')),
      data: 'JVBE',
      directory: Directory.Cache,
      recursive: true,
    });
  });

  it('gives each export its own folder, so a same-named one never overwrites it', async () => {
    await shareFile(opts);
    await shareFile(opts);
    const [first, second] = vi.mocked(Filesystem.writeFile).mock.calls.map(([o]) => o.path);
    expect(first).not.toBe(second);
  });

  it('deletes every earlier export, however recent, before writing the new one', async () => {
    // -HOUR: modified "in the future", as after the clock was turned back.
    listExports(entry('old', 2 * HOUR), entry('just-shared'), entry('clock-turned-back', -HOUR));
    await shareFile(opts);
    expect(vi.mocked(Filesystem.rmdir).mock.calls).toEqual(
      ['old', 'just-shared', 'clock-turned-back'].map((name) => [
        { path: `exports/${name}`, directory: Directory.Cache, recursive: true },
      ]),
    );
    const lastDelete = Math.max(...vi.mocked(Filesystem.rmdir).mock.invocationCallOrder);
    expect(lastDelete).toBeLessThan(vi.mocked(Filesystem.writeFile).mock.invocationCallOrder[0]);
  });

  it('still shares when the earlier exports cannot be listed', async () => {
    vi.mocked(Filesystem.readdir).mockRejectedValueOnce(fsError('OS-PLUG-FILE-0013'));
    await expect(shareFile(opts)).resolves.toBe('shared');
    expect(warn).toHaveBeenCalledWith('Listing exports failed', expect.any(Error));
  });

  it('reports a dismissed share sheet as cancelled', async () => {
    vi.mocked(Share.share).mockRejectedValueOnce(new Error('Share canceled'));
    await expect(shareFile(opts)).resolves.toBe('cancelled');
  });

  it('treats a failure that merely mentions cancel as a real error', async () => {
    vi.mocked(Share.share).mockRejectedValueOnce(new Error('Share canceled: file too large'));
    await expect(shareFile(opts)).rejects.toThrow('Share canceled: file too large');
  });

  it('rethrows any other share failure', async () => {
    vi.mocked(Share.share).mockRejectedValueOnce(new Error('only file urls are supported'));
    await expect(shareFile(opts)).rejects.toThrow('only file urls are supported');
  });
});

describe('cleanUpExports', () => {
  it('lists only the exports folder in the cache, never the rest of it', async () => {
    await cleanUpExports();
    expect(Filesystem.readdir).toHaveBeenCalledWith({
      path: 'exports',
      directory: Directory.Cache,
    });
  });

  it('does nothing, quietly, before the first export', async () => {
    // OS-PLUG-FILE-0008: the plugin's "does not exist" (FilesystemErrors.kt).
    vi.mocked(Filesystem.readdir).mockRejectedValueOnce(fsError('OS-PLUG-FILE-0008'));
    await expect(cleanUpExports()).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps exports younger than the given age', async () => {
    listExports(entry('old', 2 * HOUR), entry('recent', 10 * 60 * 1000));
    await cleanUpExports(HOUR);
    expect(Filesystem.rmdir).toHaveBeenCalledTimes(1);
    expect(Filesystem.rmdir).toHaveBeenCalledWith(expect.objectContaining({ path: 'exports/old' }));
  });

  it('deletes a stray file with deleteFile', async () => {
    listExports(entry('stray.json', 0, 'file'));
    await cleanUpExports();
    expect(Filesystem.deleteFile).toHaveBeenCalledWith({
      path: 'exports/stray.json',
      directory: Directory.Cache,
    });
    expect(Filesystem.rmdir).not.toHaveBeenCalled();
  });

  it('keeps going when one export cannot be deleted', async () => {
    listExports(entry('stuck'), entry('next'));
    vi.mocked(Filesystem.rmdir).mockRejectedValueOnce(fsError('OS-PLUG-FILE-0013'));
    await expect(cleanUpExports()).resolves.toBeUndefined();
    expect(Filesystem.rmdir).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'exports/next' }),
    );
    expect(warn).toHaveBeenCalledWith('Deleting an export failed', expect.any(Error));
  });
});
