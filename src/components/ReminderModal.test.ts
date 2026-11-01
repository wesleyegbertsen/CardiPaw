import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { App } from '@capacitor/app';
import ReminderModal from './ReminderModal.vue';
import { createI18n } from 'vue-i18n';
import { createTestI18n } from '../test/i18n';
import en from '../i18n/locales/en.json';
import nl from '../i18n/locales/nl.json';
import { makePet, makeReading } from '../test/fixtures';
import { failStorageWrites } from '../test/blockStorage';
import { closeTopModal } from '../composables/useModal';
import { loadReminderSettings, saveReminderSetting } from '../utils/reminderSettings';
import * as reminders from '../native/reminders';

vi.mock('../native/reminders', () => ({
  applyReminders: vi.fn(async () => {}),
  reminderPermission: vi.fn(async () => 'granted'),
  requestReminderPermission: vi.fn(async () => 'granted'),
  openNotificationSettings: vi.fn(async () => {}),
  syncReminders: vi.fn(async () => {}),
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) },
}));

const R = vi.mocked(reminders);
const pet = makePet({ name: 'Mochi' });

async function open(locale: 'en' | 'nl' = 'en', readings = [makeReading()]) {
  const i18n =
    locale === 'nl'
      ? createI18n({ legacy: false, locale: 'nl', fallbackLocale: 'en', messages: { en, nl } })
      : createTestI18n();
  const wrapper = mount(ReminderModal, {
    props: { pet, readings },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const q = <E extends Element = HTMLElement>(sel: string) => document.body.querySelector<E>(sel);
const qa = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)];
const click = async (sel: string) => {
  q(sel)!.click();
  await flushPromises();
};
const toggleSwitch = () => q<HTMLButtonElement>('[role="switch"]')!;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-10T08:00:00Z'));
});

describe('ReminderModal', () => {
  it('starts off, without asking for the permission', async () => {
    await open();
    expect(q('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    expect(q('input[type="time"]')).toBeNull();
    expect(R.requestReminderPermission).not.toHaveBeenCalled();
  });

  it('turns on after Android grants the permission, and saves daily at 22:00', async () => {
    R.reminderPermission.mockResolvedValue('prompt');
    await open();
    await click('[role="switch"]');
    expect(R.requestReminderPermission).toHaveBeenCalledOnce();
    expect(q<HTMLInputElement>('input[type="time"]')!.value).toBe('22:00');
    expect(q('.next')!.textContent).toBe('Next reminder: Wednesday, June 10 at 10:00 PM');
    await click('.btn-save');
    expect(loadReminderSettings()['pet-1']).toEqual({
      enabled: true,
      time: '22:00',
      days: [0, 1, 2, 3, 4, 5, 6],
      slot: 1,
    });
    expect(R.applyReminders).toHaveBeenCalledWith('pet-1');
  });

  it('stays off and offers the settings when the permission is refused', async () => {
    R.reminderPermission.mockResolvedValue('prompt');
    R.requestReminderPermission.mockResolvedValue('denied');
    await open();
    await click('[role="switch"]');
    expect(q('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    expect(q('.denied [role="alert"]')!.textContent).toContain('turned off');
    await click('.settings-btn');
    expect(R.openNotificationSettings).toHaveBeenCalledOnce();
  });

  it('does not ask again once Android won’t, and re-checks on return from the settings', async () => {
    R.reminderPermission.mockResolvedValue('denied');
    await open();
    expect(toggleSwitch().getAttribute('aria-disabled')).toBe('true');
    await click('[role="switch"]');
    expect(toggleSwitch().getAttribute('aria-checked')).toBe('false');
    R.reminderPermission.mockResolvedValue('granted');
    const onResume = vi.mocked(App.addListener).mock.calls[0][1] as () => void;
    onResume();
    await flushPromises();
    expect(toggleSwitch().hasAttribute('aria-disabled')).toBe(false);
    expect(q('.denied')).toBeNull();
    expect(R.requestReminderPermission).not.toHaveBeenCalled();
  });

  it('explains after one refusal and lets the switch ask once more', async () => {
    R.reminderPermission.mockResolvedValue('rationale');
    await open();
    expect(q('.denied [role="alert"]')!.textContent).toContain('turned off');
    expect(q('.settings-btn')).not.toBeNull();
    expect(toggleSwitch().hasAttribute('aria-disabled')).toBe(false);
    await click('[role="switch"]');
    expect(R.requestReminderPermission).toHaveBeenCalledOnce();
    expect(toggleSwitch().getAttribute('aria-checked')).toBe('true');
    expect(q('.denied')).toBeNull();
  });

  it('keeps the switch focused and described when Android stops asking', async () => {
    R.reminderPermission.mockResolvedValue('rationale');
    R.requestReminderPermission.mockResolvedValue('denied');
    await open();
    toggleSwitch().focus();
    await click('[role="switch"]');
    expect(toggleSwitch().disabled).toBe(false);
    expect(toggleSwitch().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(toggleSwitch());
    const described = document.getElementById(toggleSwitch().getAttribute('aria-describedby')!);
    expect(described!.textContent).toContain('turned off');
    await click('[role="switch"]');
    expect(R.requestReminderPermission).toHaveBeenCalledOnce();
  });

  it('asks on save when reminders are on without the permission, and stays open when refused', async () => {
    saveReminderSetting('pet-1', { enabled: true, time: '07:30', days: [1] });
    R.reminderPermission.mockResolvedValue('prompt');
    R.requestReminderPermission.mockResolvedValue('denied');
    const wrapper = await open();
    expect(toggleSwitch().getAttribute('aria-checked')).toBe('true');
    q<HTMLInputElement>('input[type="time"]')!.value = '08:00';
    q('input[type="time"]')!.dispatchEvent(new Event('input'));
    await click('.btn-save');
    expect(R.requestReminderPermission).toHaveBeenCalledOnce();
    expect(q('.denied [role="alert"]')).not.toBeNull();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(R.applyReminders).not.toHaveBeenCalled();
    expect(loadReminderSettings()['pet-1'].time).toBe('07:30');
    expect(q<HTMLButtonElement>('.btn-save')!.disabled).toBe(false);
    // Android won't ask again: saving doesn't either.
    await click('.btn-save');
    expect(R.requestReminderPermission).toHaveBeenCalledOnce();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('saves after Android grants the permission on save', async () => {
    saveReminderSetting('pet-1', { enabled: true, time: '07:30', days: [1] });
    R.reminderPermission.mockResolvedValue('rationale');
    R.requestReminderPermission.mockResolvedValue('granted');
    const wrapper = await open();
    await click('.btn-save');
    expect(R.applyReminders).toHaveBeenCalledWith('pet-1');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('turns reminders off without asking for the permission', async () => {
    saveReminderSetting('pet-1', { enabled: true, time: '07:30', days: [1] });
    R.reminderPermission.mockResolvedValue('denied');
    const wrapper = await open();
    await click('[role="switch"]');
    await click('.btn-save');
    expect(R.requestReminderPermission).not.toHaveBeenCalled();
    expect(loadReminderSettings()['pet-1'].enabled).toBe(false);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('orders the days from the locale’s week start and needs at least one', async () => {
    saveReminderSetting('pet-1', { enabled: true, time: '07:30', days: [0, 1, 2, 3, 4, 5, 6] });
    await open('nl');
    const days = qa('.day-btn');
    expect(days.map((d) => d.getAttribute('aria-label'))[0]).toBe('maandag');
    for (const d of days) d.click();
    await flushPromises();
    expect(q('.hint')!.textContent).toBe('Kies minstens één dag.');
    expect(q<HTMLButtonElement>('.btn-save')!.disabled).toBe(true);
  });

  it('saves off with valid days even after they were all cleared', async () => {
    saveReminderSetting('pet-1', { enabled: true, time: '22:00', days: [3] });
    await open();
    await click('.day-btn[aria-pressed="true"]');
    await click('[role="switch"]');
    await click('.btn-save');
    expect(loadReminderSettings()['pet-1']).toMatchObject({
      enabled: false,
      days: [0, 1, 2, 3, 4, 5, 6],
    });
  });

  it('stays open with an error when saving fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open();
    await click('[role="switch"]');
    failStorageWrites();
    await click('.btn-save');
    expect(q('.error-msg')!.textContent).toBe('This could not be saved. Please try again.');
    expect(R.applyReminders).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Saving reminders failed', expect.any(Error));
  });

  it('stays open and says the settings were saved when scheduling fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    R.applyReminders.mockRejectedValueOnce(new Error('boom'));
    const wrapper = await open();
    await click('[role="switch"]');
    await click('.btn-save');
    expect(q('.error-msg')!.getAttribute('role')).toBe('alert');
    expect(q('.error-msg')!.textContent).toBe(
      "Your settings were saved, but the reminders couldn't be scheduled. Please try again.",
    );
    expect(loadReminderSettings()['pet-1'].enabled).toBe(true);
    expect(error).toHaveBeenCalledWith('Scheduling reminders failed', expect.any(Error));
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(q<HTMLButtonElement>('.btn-save')!.disabled).toBe(false);
  });

  it('logs a failed permission check and still lets reminders be turned on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    R.reminderPermission.mockRejectedValueOnce(new Error('boom'));
    await open();
    expect(error).toHaveBeenCalledWith(
      'Checking the notification permission failed',
      expect.any(Error),
    );
    await click('[role="switch"]');
    expect(q('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
  });

  it('logs a failed permission request and stays off', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    R.reminderPermission.mockResolvedValue('prompt');
    R.requestReminderPermission.mockRejectedValueOnce(new Error('boom'));
    await open();
    await click('[role="switch"]');
    expect(error).toHaveBeenCalledWith(
      'Asking for the notification permission failed',
      expect.any(Error),
    );
    expect(q('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('logs when the notification settings cannot be opened', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    R.reminderPermission.mockResolvedValue('denied');
    R.openNotificationSettings.mockRejectedValueOnce(new Error('boom'));
    await open();
    await click('.settings-btn');
    expect(error).toHaveBeenCalledWith(
      'Opening the notification settings failed',
      expect.any(Error),
    );
  });

  it('closes on the back button', async () => {
    const wrapper = await open();
    expect(closeTopModal()).toBe(true);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
