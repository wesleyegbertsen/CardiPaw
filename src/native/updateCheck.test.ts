import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@capacitor/app';
import { checkIfDue } from '../composables/useUpdateCheck';
import { mockNative } from '../test/native';
import { installUpdateCheck } from './updateCheck';

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: async () => {} })) },
}));
vi.mock('../composables/useUpdateCheck', () => ({ checkIfDue: vi.fn(async () => {}) }));

describe('installUpdateCheck', () => {
  beforeEach(() => {
    vi.mocked(App.addListener).mockClear();
    vi.mocked(checkIfDue).mockClear();
  });

  it('checks at startup and when the app comes back to the foreground', () => {
    mockNative();
    installUpdateCheck();
    expect(checkIfDue).toHaveBeenCalledOnce();
    expect(App.addListener).toHaveBeenCalledWith('resume', expect.any(Function));
    const onResume = vi.mocked(App.addListener).mock.calls[0][1] as () => void;
    onResume();
    expect(checkIfDue).toHaveBeenCalledTimes(2);
  });

  it('does nothing on the website', () => {
    mockNative(false);
    installUpdateCheck();
    expect(checkIfDue).not.toHaveBeenCalled();
    expect(App.addListener).not.toHaveBeenCalled();
  });
});
