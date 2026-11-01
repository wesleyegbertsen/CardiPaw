import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REMINDER,
  forgetReminderSetting,
  loadReminderSettings,
  pruneReminderSettings,
  saveReminderSetting,
} from './reminderSettings';
import { MAX_SLOT } from './reminderSchedule';
import { blockStorage, failStorageWrites } from '../test/blockStorage';

const STORAGE_KEY = 'cardipaw-reminders';
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
const daily = { enabled: true, time: '21:30', days: [0, 1, 2, 3, 4, 5, 6] };

beforeEach(() => {
  localStorage.clear();
});

describe('reminderSettings', () => {
  it('saves a setting and loads it back', () => {
    const saved = saveReminderSetting('a', daily);
    expect(saved).toEqual({ ...daily, slot: 1 });
    expect(loadReminderSettings()).toEqual({ a: { ...daily, slot: 1 } });
    expect(stored()).toEqual({ a: { ...daily, slot: 1 } });
  });

  it('has nothing stored by default, and the default is off at 22:00 every day', () => {
    expect(loadReminderSettings()).toEqual({});
    expect(DEFAULT_REMINDER).toEqual({
      enabled: false,
      time: '22:00',
      days: [0, 1, 2, 3, 4, 5, 6],
    });
  });

  it('keeps a pet’s slot when saved again, and reuses the smallest free one', () => {
    saveReminderSetting('a', daily);
    saveReminderSetting('b', daily);
    saveReminderSetting('c', daily);
    expect(saveReminderSetting('b', { ...daily, enabled: false }).slot).toBe(2);
    forgetReminderSetting('a');
    expect(saveReminderSetting('d', daily).slot).toBe(1);
    expect(saveReminderSetting('e', daily).slot).toBe(4);
    // Off keeps the entry, so the pet keeps its slot.
    expect(loadReminderSettings().b).toEqual({ ...daily, enabled: false, slot: 2 });
  });

  const good = { ...daily, slot: 1 };
  it.each([
    ['enabled not a boolean', { ...good, enabled: 'yes' }],
    ['a bad time', { ...good, time: '24:00' }],
    ['a time without a leading zero', { ...good, time: '9:00' }],
    ['a time in an array', { ...good, time: ['22:00'] }],
    ['no days', { ...good, days: [] }],
    ['a duplicate day', { ...good, days: [1, 1] }],
    ['day 7', { ...good, days: [7] }],
    ['a fractional day', { ...good, days: [1.5] }],
    ['slot 0', { ...good, slot: 0 }],
    ['a fractional slot', { ...good, slot: 1.5 }],
    [`slot ${MAX_SLOT + 1}`, { ...good, slot: MAX_SLOT + 1 }],
    ['null', null],
    ['an array', [good]],
  ])('drops a setting with %s, with a warning', (_label, bad) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: bad, b: { ...good, slot: 2 } }));
    expect(loadReminderSettings()).toEqual({ b: { ...good, slot: 2 } });
    expect(warn).toHaveBeenCalledWith('Ignoring an invalid reminder setting', 'a', bad);
  });

  it('accepts the highest slot', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: { ...good, slot: MAX_SLOT } }));
    expect(loadReminderSettings()).toEqual({ a: { ...good, slot: MAX_SLOT } });
  });

  it('keeps the first of two pets on one slot, which would share notification ids', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: good, b: good }));
    expect(loadReminderSettings()).toEqual({ a: good });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('ignores unparsable JSON with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, '{');
    expect(loadReminderSettings()).toEqual({});
    expect(warn).toHaveBeenCalledWith('Ignoring unreadable reminder settings');
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', '42'],
  ])('loads nothing when the stored value is %s', (_label, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadReminderSettings()).toEqual({});
  });

  it('throws when the setting could not be stored, so the dialog can say so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failStorageWrites();
    expect(() => saveReminderSetting('a', daily)).toThrow('Reminder setting was not stored');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not save'),
      expect.any(DOMException),
    );
  });

  it('loads nothing and never throws on forget or prune when site data is blocked', () => {
    blockStorage();
    expect(loadReminderSettings()).toEqual({});
    expect(() => forgetReminderSetting('a')).not.toThrow();
    expect(() => pruneReminderSettings([])).not.toThrow();
  });

  describe('forgetReminderSetting', () => {
    it('removes only the given pet’s setting', () => {
      saveReminderSetting('a', daily);
      saveReminderSetting('b', daily);
      forgetReminderSetting('a');
      expect(stored()).toEqual({ b: { ...daily, slot: 2 } });
    });

    it('does not write when the pet has no setting', () => {
      saveReminderSetting('b', daily);
      const setItem = vi.spyOn(localStorage, 'setItem');
      forgetReminderSetting('a');
      expect(setItem).not.toHaveBeenCalled();
    });

    it('does not throw when storage is full', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      saveReminderSetting('a', daily);
      failStorageWrites();
      expect(() => forgetReminderSetting('a')).not.toThrow();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not save'),
        expect.any(DOMException),
      );
    });
  });

  describe('pruneReminderSettings', () => {
    it('keeps the listed pets’ settings and drops the rest', () => {
      saveReminderSetting('a', daily);
      saveReminderSetting('b', daily);
      pruneReminderSettings(['b', 'c']);
      expect(stored()).toEqual({ b: { ...daily, slot: 2 } });
    });

    it('does not write when every stored pet is kept', () => {
      saveReminderSetting('b', daily);
      const setItem = vi.spyOn(localStorage, 'setItem');
      pruneReminderSettings(['a', 'b']);
      expect(setItem).not.toHaveBeenCalled();
    });

    it('does not throw when storage is full', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      saveReminderSetting('a', daily);
      failStorageWrites();
      expect(() => pruneReminderSettings([])).not.toThrow();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not save'),
        expect.any(DOMException),
      );
    });
  });
});
