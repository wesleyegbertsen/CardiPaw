import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, type EffectScope } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
  LocalNotifications,
  type PendingLocalNotificationSchema,
} from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { routes } from '../router';
import { Blank } from '../test/mountView';
import { i18n, setLocale } from '../i18n';
import * as db from '../services/db';
import { makePet, makeReading } from '../test/fixtures';
import { mockNative } from '../test/native';
import { deferred } from '../test/deferred';
import { saveReminderSetting } from '../utils/reminderSettings';
import { reminderId } from '../utils/reminderSchedule';
import { NotificationSettings } from './notificationSettings';
import {
  applyReminders,
  installReminders,
  openNotificationSettings,
  reminderPermission,
  requestReminderPermission,
  syncReminders,
} from './reminders';

vi.mock('./notificationSettings', () => ({
  NotificationSettings: { open: vi.fn(async () => {}) },
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    getPending: vi.fn(async () => ({ notifications: [] })),
    checkPermissions: vi.fn(async () => ({ display: 'granted' })),
    requestPermissions: vi.fn(),
    cancel: vi.fn(async () => {}),
    removeDeliveredNotificationsById: vi.fn(async () => {}),
    createChannel: vi.fn(async () => {}),
    schedule: vi.fn(async () => ({ notifications: [] })),
    addListener: vi.fn(async () => ({ remove: async () => {} })),
  },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: async () => {} })) },
}));

const router = createRouter({
  history: createMemoryHistory(),
  routes: routes.map((r) => ({ ...r, component: Blank })),
});
const LN = vi.mocked(LocalNotifications);

/** A reminder the plugin still has: scheduled, or shown and not yet tapped or dismissed. */
function pending(id: number, petId: string, at?: string): PendingLocalNotificationSchema {
  return { id, title: '', body: '', extra: { petId, at } };
}

// installReminders watches the locale; each test's watcher stops with its scope.
let scope: EffectScope;
const install = () => scope.run(() => installReminders(router, i18n));

beforeEach(async () => {
  scope = effectScope();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-10T08:00:00Z'));
  await db.importAllData({
    version: 1,
    exportedAt: '',
    pets: [makePet({ name: 'Mochi' })],
    readings: [],
    notes: [],
  });
  saveReminderSetting('pet-1', { enabled: true, time: '22:00', days: [0, 1, 2, 3, 4, 5, 6] });
});

// A sync a test started and didn't await (installReminders starts one) would otherwise call
// the next test's mocks. Its own errors were the test's to check: drain them quietly.
afterEach(async () => {
  scope.stop();
  mockNative();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await syncReminders();
});

describe('reminders', () => {
  it('does nothing on the website', async () => {
    mockNative(false);
    install();
    await syncReminders();
    await applyReminders('pet-1');
    for (const fn of Object.values(LN)) expect(fn).not.toHaveBeenCalled();
    expect(App.addListener).not.toHaveBeenCalled();
  });

  it('schedules inexact, wake-up reminders on the reminders channel on install', async () => {
    mockNative();
    install();
    await syncReminders();
    const { notifications } = LN.schedule.mock.calls[0][0];
    expect(notifications).toHaveLength(14);
    expect(notifications[0]).toMatchObject({
      id: reminderId(1, '2026-06-10'),
      title: "Time to measure Mochi's breathing rate",
      body: 'Count the breaths while your pet is resting or asleep.',
      schedule: { allowWhileIdle: true },
      channelId: 'reminders',
      isExactNotification: false,
      extra: { petId: 'pet-1', at: '2026-06-10T22:00:00.000Z' },
    });
    expect(notifications[0].schedule!.at!.toISOString()).toBe('2026-06-10T22:00:00.000Z');
    for (const n of notifications) {
      expect(n).toMatchObject({ isExactNotification: false, schedule: { allowWhileIdle: true } });
    }
    expect(LN.createChannel).toHaveBeenCalledWith({
      id: 'reminders',
      name: 'Measuring reminders',
      description: "Reminders to measure your pets' resting breathing rate",
      importance: 3,
      visibility: 0,
    });
    expect(LN.requestPermissions).not.toHaveBeenCalled();
  });

  it('schedules nothing without the permission', async () => {
    mockNative();
    LN.checkPermissions.mockResolvedValue({ display: 'prompt-with-rationale' });
    // A stale reminder still goes.
    const stale = pending(reminderId(1, '2026-06-10'), 'pet-1', '2026-06-10T21:00:00.000Z');
    LN.getPending.mockResolvedValue({ notifications: [stale] });
    install();
    await syncReminders();
    expect(LN.schedule).not.toHaveBeenCalled();
    expect(LN.cancel).toHaveBeenCalledWith({ notifications: [{ id: stale.id }] });
  });

  it('still schedules on Android 7, which has no channels', async () => {
    mockNative();
    LN.createChannel.mockRejectedValue(
      Object.assign(new Error('not available'), { code: 'UNAVAILABLE' }),
    );
    install();
    await syncReminders();
    expect(LN.schedule).toHaveBeenCalled();
  });

  it("cancels and dismisses today's reminder once today has a reading", async () => {
    mockNative();
    install();
    const today = {
      id: reminderId(1, '2026-06-10'),
      title: '',
      body: '',
      extra: { petId: 'pet-1' },
    };
    LN.getPending.mockResolvedValue({ notifications: [today as PendingLocalNotificationSchema] });
    await db.saveReading(makeReading({ date: '2026-06-10T07:00:00Z' }));
    await syncReminders('pet-1');
    expect(LN.cancel).toHaveBeenCalledWith({ notifications: [{ id: today.id }] });
    expect(LN.removeDeliveredNotificationsById).toHaveBeenCalledWith({ ids: [today.id] });
  });

  it("keeps a due reminder that hasn't shown yet, and drops one at a changed time", async () => {
    mockNative();
    install();
    vi.setSystemTime(new Date('2026-06-10T22:03:00Z'));
    const id = reminderId(1, '2026-06-10');
    const due = {
      id,
      title: '',
      body: '',
      extra: { petId: 'pet-1', at: '2026-06-10T22:00:00.000Z' },
    };
    LN.getPending.mockResolvedValue({ notifications: [due] });
    await syncReminders('pet-1');
    expect(LN.cancel).not.toHaveBeenCalled();
    expect(LN.schedule.mock.calls[0][0].notifications.map((n) => n.id)).not.toContain(id);
    saveReminderSetting('pet-1', { enabled: true, time: '21:00', days: [0, 1, 2, 3, 4, 5, 6] });
    await syncReminders('pet-1');
    expect(LN.cancel).toHaveBeenCalledWith({ notifications: [{ id }] });
    expect(LN.removeDeliveredNotificationsById).not.toHaveBeenCalled();
  });

  it("brings today's reminder back when today's only reading is deleted before its time", async () => {
    mockNative();
    install();
    const reading = makeReading({ date: '2026-06-10T07:00:00Z' });
    await db.saveReading(reading);
    await syncReminders('pet-1');
    const today = reminderId(1, '2026-06-10');
    expect(LN.schedule.mock.calls.at(-1)![0].notifications.map((n) => n.id)).not.toContain(today);
    await db.deleteReading(reading.id);
    await syncReminders('pet-1');
    expect(LN.schedule.mock.calls.at(-1)![0].notifications[0].id).toBe(today);
  });

  it('cancels and dismisses the reminders of a pet that is gone', async () => {
    mockNative();
    install();
    const orphan = pending(reminderId(2, '2026-06-10'), 'pet-gone', '2026-06-10T22:00:00.000Z');
    LN.getPending.mockResolvedValue({ notifications: [orphan] });
    await syncReminders();
    expect(LN.cancel).toHaveBeenCalledWith({ notifications: [{ id: orphan.id }] });
    expect(LN.removeDeliveredNotificationsById).toHaveBeenCalledWith({ ids: [orphan.id] });
    expect(LN.schedule.mock.calls[0][0].notifications.every((n) => n.extra.petId === 'pet-1')).toBe(
      true,
    );
  });

  it('cancels and dismisses every reminder once they are turned off', async () => {
    mockNative();
    install();
    saveReminderSetting('pet-1', { enabled: false, time: '22:00', days: [0, 1, 2, 3, 4, 5, 6] });
    const today = pending(reminderId(1, '2026-06-10'), 'pet-1', '2026-06-10T22:00:00.000Z');
    LN.getPending.mockResolvedValue({ notifications: [today] });
    await syncReminders('pet-1');
    expect(LN.cancel).toHaveBeenCalledWith({ notifications: [{ id: today.id }] });
    expect(LN.removeDeliveredNotificationsById).toHaveBeenCalledWith({ ids: [today.id] });
    expect(LN.schedule).not.toHaveBeenCalled();
  });

  it("cancels yesterday's unmeasured reminder but leaves it in the shade", async () => {
    mockNative();
    install();
    const yesterday = pending(reminderId(1, '2026-06-09'), 'pet-1', '2026-06-09T22:00:00.000Z');
    LN.getPending.mockResolvedValue({ notifications: [yesterday] });
    await syncReminders('pet-1');
    expect(LN.cancel).toHaveBeenCalledWith({ notifications: [{ id: yesterday.id }] });
    expect(LN.removeDeliveredNotificationsById).not.toHaveBeenCalled();
  });

  it('logs and resolves when scheduling fails', async () => {
    mockNative();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    install();
    const disabled = Object.assign(new Error('Notifications not enabled'), {
      code: 'NOTIFICATIONS_DISABLED',
    });
    LN.schedule.mockRejectedValue(disabled);
    await expect(syncReminders()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Could not update reminders', disabled);
  });

  it('logs and schedules nothing when the channel fails for another reason', async () => {
    mockNative();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    install();
    const failure = Object.assign(new Error('boom'), { code: 'EXCEPTION' });
    LN.createChannel.mockRejectedValue(failure);
    await expect(syncReminders()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Could not update reminders', failure);
    expect(LN.schedule).not.toHaveBeenCalled();
  });

  it('rejects from applyReminders, for the dialog to report', async () => {
    mockNative();
    // The install's own sync logs the same failure.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    install();
    LN.schedule.mockRejectedValue(new Error('boom'));
    await expect(applyReminders('pet-1')).rejects.toThrow('boom');
  });

  it('reschedules in the new language', async () => {
    mockNative();
    install();
    await syncReminders();
    LN.schedule.mockClear();
    try {
      setLocale('nl');
      await nextTick();
      await vi.waitFor(() => expect(LN.schedule).toHaveBeenCalled());
      expect(LN.schedule.mock.calls[0][0].notifications[0].title).toBe(
        'Tijd om de ademhaling van Mochi te meten',
      );
      expect(LN.createChannel).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'reminders', name: 'Meetherinneringen' }),
      );
    } finally {
      // Later tests expect English; let the syncs this starts finish here.
      setLocale('en');
      await nextTick();
      await syncReminders();
    }
  });

  it("opens the pet's tracker when a reminder is tapped", async () => {
    mockNative();
    const push = vi.spyOn(router, 'push').mockResolvedValue(undefined);
    install();
    await syncReminders();
    const [, onTap] = LN.addListener.mock.calls.find(
      ([event]) => event === 'localNotificationActionPerformed',
    )!;
    const tap = (extra: unknown) =>
      (onTap as (action: unknown) => void)({ actionId: 'tap', notification: { id: 1, extra } });
    tap({ petId: 'pet-1' });
    expect(push).toHaveBeenCalledExactlyOnceWith({ name: 'tracker', params: { id: 'pet-1' } });
    tap(undefined);
    tap({});
    tap({ petId: 42 });
    expect(push).toHaveBeenCalledOnce();
  });

  it('tops up the reminders when the app comes back to the foreground', async () => {
    mockNative();
    install();
    await syncReminders();
    // The mock's calls are typed by the first overload ('backButton').
    const [, onResume] = vi
      .mocked(App.addListener)
      .mock.calls.find(([event]) => (event as string) === 'resume')!;
    LN.schedule.mockClear();
    (onResume as () => void)();
    await syncReminders();
    // Once for the resume, once for the sync above, both queued.
    expect(LN.schedule).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['prompt', 'prompt'],
    // Refused once: Android still shows its dialog one more time.
    ['prompt-with-rationale', 'prompt'],
  ] as const)('reports the permission %s as %s', async (display, expected) => {
    LN.checkPermissions.mockResolvedValue({ display });
    LN.requestPermissions.mockResolvedValue({ display });
    await expect(reminderPermission()).resolves.toBe(expected);
    await expect(requestReminderPermission()).resolves.toBe(expected);
  });

  it("opens CardiPaw's notification settings", async () => {
    await openNotificationSettings();
    expect(NotificationSettings.open).toHaveBeenCalledOnce();
  });

  it('runs one sync at a time: a delete after a top-up cancels what it scheduled', async () => {
    mockNative();
    install();
    await syncReminders();
    LN.schedule.mockClear();
    const held = deferred<{ notifications: PendingLocalNotificationSchema[] }>();
    LN.getPending.mockReturnValueOnce(held.promise);
    const before = LN.getPending.mock.calls.length;
    const topUp = syncReminders();
    // The top-up has read the pets (getAllPets comes first) and now waits on getPending.
    await vi.waitFor(() => expect(LN.getPending).toHaveBeenCalledTimes(before + 1));
    await db.deletePetCascade('pet-1');
    const scheduled = Array.from({ length: 14 }, (_, i) => ({
      id: reminderId(1, '2026-06-10') + i,
      title: '',
      body: '',
      extra: { petId: 'pet-1' },
    }));
    LN.getPending.mockResolvedValueOnce({ notifications: scheduled });
    const del = syncReminders('pet-1');
    held.resolve({ notifications: [] });
    await Promise.all([topUp, del]);
    expect(LN.cancel).toHaveBeenCalledTimes(1);
    expect(LN.schedule).toHaveBeenCalledOnce();
    expect(LN.cancel.mock.invocationCallOrder[0]).toBeGreaterThan(
      LN.schedule.mock.invocationCallOrder[0],
    );
  });
});
