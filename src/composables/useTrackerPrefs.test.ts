// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useTrackerPrefs } from './useTrackerPrefs';
import { blockStorage, failStorageWrites } from '../test/blockStorage';

const STORAGE_KEY = 'cardipaw-tracker-prefs';
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');

describe('useTrackerPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to sound and vibration on', () => {
    const { soundEnabled, vibrationEnabled } = useTrackerPrefs('a');
    expect(soundEnabled.value).toBe(true);
    expect(vibrationEnabled.value).toBe(true);
  });

  it('saves and restores prefs per pet', async () => {
    const a = useTrackerPrefs('a');
    a.soundEnabled.value = false;
    await nextTick();
    const b = useTrackerPrefs('b');
    b.vibrationEnabled.value = false;
    await nextTick();

    expect(stored()).toEqual({
      a: { soundEnabled: false, vibrationEnabled: true },
      b: { soundEnabled: true, vibrationEnabled: false },
    });
    expect(useTrackerPrefs('a').soundEnabled.value).toBe(false);
    expect(useTrackerPrefs('a').vibrationEnabled.value).toBe(true);
    expect(useTrackerPrefs('b').vibrationEnabled.value).toBe(false);
  });

  it.each([
    ['null', 'null'],
    ['unparseable JSON', '{'],
    ['a number', '42'],
  ])('falls back to defaults when the saved value is %s', (_label, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    const { soundEnabled, vibrationEnabled } = useTrackerPrefs('a');
    expect(soundEnabled.value).toBe(true);
    expect(vibrationEnabled.value).toBe(true);
  });

  it('replaces a saved array so later changes are kept', async () => {
    // JSON.stringify drops string keys on an array, which used to lose every change.
    localStorage.setItem(STORAGE_KEY, '[]');
    useTrackerPrefs('a').soundEnabled.value = false;
    await nextTick();

    expect(stored()).toEqual({ a: { soundEnabled: false, vibrationEnabled: true } });
    expect(useTrackerPrefs('a').soundEnabled.value).toBe(false);
  });

  it('keeps a changed pref for this session when it cannot be saved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failStorageWrites();
    const { soundEnabled } = useTrackerPrefs('a');
    soundEnabled.value = false;
    await nextTick();
    expect(soundEnabled.value).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not save'), expect.any(DOMException));
  });

  it('uses defaults and keeps changes when site data is blocked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    blockStorage();
    const { soundEnabled } = useTrackerPrefs('a');
    expect(soundEnabled.value).toBe(true);
    soundEnabled.value = false;
    await nextTick();
    expect(soundEnabled.value).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not save'), expect.any(DOMException));
  });
});
