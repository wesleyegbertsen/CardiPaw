import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { forgetTrackerPrefs, pruneTrackerPrefs, useTrackerPrefs } from './useTrackerPrefs';
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
      a: { soundEnabled: false, vibrationEnabled: true, measurementSeconds: 30 },
      b: { soundEnabled: true, vibrationEnabled: false, measurementSeconds: 30 },
    });
    expect(useTrackerPrefs('a').soundEnabled.value).toBe(false);
    expect(useTrackerPrefs('a').vibrationEnabled.value).toBe(true);
    expect(useTrackerPrefs('b').vibrationEnabled.value).toBe(false);
  });

  it('defaults to a 30-second measurement', () => {
    expect(useTrackerPrefs('a').measurementSeconds.value).toBe(30);
  });

  it('saves and restores the measurement length per pet', async () => {
    useTrackerPrefs('a').measurementSeconds.value = 60;
    await nextTick();
    expect(stored()).toEqual({
      a: { soundEnabled: true, vibrationEnabled: true, measurementSeconds: 60 },
    });
    expect(useTrackerPrefs('a').measurementSeconds.value).toBe(60);
    expect(useTrackerPrefs('b').measurementSeconds.value).toBe(30);
  });

  it('keeps the measurement length when another pref changes', async () => {
    useTrackerPrefs('a').measurementSeconds.value = 15;
    await nextTick();
    useTrackerPrefs('a').soundEnabled.value = false;
    await nextTick();
    expect(stored().a).toEqual({ soundEnabled: false, vibrationEnabled: true, measurementSeconds: 15 });
  });

  it.each([
    ['missing (saved before it existed)', undefined],
    ['a length the tracker does not offer', 45],
    ['a string', '60'],
    ['null', null],
  ])('uses 30 seconds when the saved length is %s', (_label, measurementSeconds) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ a: { soundEnabled: false, vibrationEnabled: true, measurementSeconds } }),
    );
    const prefs = useTrackerPrefs('a');
    expect(prefs.measurementSeconds.value).toBe(30);
    expect(prefs.soundEnabled.value).toBe(false);
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

    expect(stored()).toEqual({
      a: { soundEnabled: false, vibrationEnabled: true, measurementSeconds: 30 },
    });
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

  describe('forgetTrackerPrefs', () => {
    const prefsA = { soundEnabled: false, vibrationEnabled: true };
    const prefsB = { soundEnabled: true, vibrationEnabled: false };

    it('removes only the given pet’s prefs', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: prefsA, b: prefsB }));
      forgetTrackerPrefs('a');
      expect(stored()).toEqual({ b: prefsB });
    });

    it('does not write when the pet has no saved prefs', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ b: prefsB }));
      const setItem = vi.spyOn(localStorage, 'setItem');
      forgetTrackerPrefs('a');
      expect(setItem).not.toHaveBeenCalled();
      expect(stored()).toEqual({ b: prefsB });
    });

    it('does not throw when storage is blocked or full', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: prefsA }));
      failStorageWrites();
      expect(() => forgetTrackerPrefs('a')).not.toThrow();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not save'),
        expect.any(DOMException),
      );
      blockStorage();
      expect(() => forgetTrackerPrefs('a')).not.toThrow();
    });
  });

  describe('pruneTrackerPrefs', () => {
    const prefsA = { soundEnabled: false, vibrationEnabled: true };
    const prefsB = { soundEnabled: true, vibrationEnabled: false };

    it('keeps the listed pets’ prefs and drops the rest', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: prefsA, b: prefsB }));
      pruneTrackerPrefs(['b', 'c']);
      expect(stored()).toEqual({ b: prefsB });
    });

    it('does not write when every saved pet is kept', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ b: prefsB }));
      const setItem = vi.spyOn(localStorage, 'setItem');
      pruneTrackerPrefs(['a', 'b']);
      expect(setItem).not.toHaveBeenCalled();
      expect(stored()).toEqual({ b: prefsB });
    });

    it('does not throw when storage is blocked or full', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: prefsA }));
      failStorageWrites();
      expect(() => pruneTrackerPrefs([])).not.toThrow();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not save'),
        expect.any(DOMException),
      );
      blockStorage();
      expect(() => pruneTrackerPrefs([])).not.toThrow();
    });
  });
});
