import { describe, expect, it, vi } from 'vitest';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { shareFile } from './nativeFile';

vi.mock('@capacitor/filesystem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/filesystem')>()),
  Filesystem: { writeFile: vi.fn(async () => ({ uri: 'file:///cache/f' })) },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(async () => ({})) } }));

const opts = {
  name: 'a.json',
  data: '{}',
  encoding: 'utf8',
  subject: 'Backup',
  dialogTitle: 'Save',
} as const;

describe('shareFile', () => {
  it('writes UTF-8 text to the cache directory and shares that file', async () => {
    await expect(shareFile(opts)).resolves.toBe('shared');
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: 'a.json',
      data: '{}',
      directory: Directory.Cache,
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
      path: 'r.pdf',
      data: 'JVBE',
      directory: Directory.Cache,
    });
  });

  it('reports a dismissed share sheet as cancelled', async () => {
    vi.mocked(Share.share).mockRejectedValueOnce(new Error('Share canceled'));
    await expect(shareFile(opts)).resolves.toBe('cancelled');
  });

  it('rethrows any other share failure', async () => {
    vi.mocked(Share.share).mockRejectedValueOnce(new Error('only file urls are supported'));
    await expect(shareFile(opts)).rejects.toThrow('only file urls are supported');
  });
});
