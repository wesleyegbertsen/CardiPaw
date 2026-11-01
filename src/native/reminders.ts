import { App } from '@capacitor/app';
import {
  LocalNotifications,
  type LocalNotificationSchema,
  type PendingLocalNotificationSchema,
  type PermissionStatus,
} from '@capacitor/local-notifications';
import { watch } from 'vue';
import type { Router } from 'vue-router';
import type { i18n as appI18n } from '../i18n';
import * as db from '../services/db';
import { localDayKey } from '../utils/date';
import { isNative } from '../utils/platform';
import {
  planReminders,
  reminderDayKey,
  reminderId,
  type PlannedReminder,
} from '../utils/reminderSchedule';
import { loadReminderSettings } from '../utils/reminderSettings';
import { NotificationSettings } from './notificationSettings';

export const CHANNEL_ID = 'reminders';
type AppI18n = typeof appI18n;

// Set by installReminders. Only a type import of ../i18n above: loading it needs a DOM, and
// this module must also load without one (the Node test project).
let i18n: AppI18n | null = null;
// One sync at a time: two overlapping ones could each read the other's half-done state and
// leave a reminder scheduled for a pet that was just deleted.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

function petIdOf(n: PendingLocalNotificationSchema): string | undefined {
  const petId: unknown = n.extra?.petId;
  return typeof petId === 'string' ? petId : undefined;
}

async function sync(onlyPetId?: string): Promise<void> {
  if (!i18n) throw new Error('installReminders() must run before reminders are synced');
  const { t } = i18n.global;
  const now = new Date();
  const today = localDayKey(now);
  const settings = loadReminderSettings();
  // From db, not the stores: they import this module, and at startup they are still empty.
  const pets = await db.getAllPets();
  // Also holds delivered reminders still in the shade: the plugin keeps their record until
  // they are tapped or dismissed.
  const ours = (await LocalNotifications.getPending()).notifications.filter((n) => {
    const petId = petIdOf(n);
    return petId !== undefined && (!onlyPetId || petId === onlyPetId);
  });
  const granted = (await LocalNotifications.checkPermissions()).display === 'granted';
  // extra.petId is what counts: a lost setting or a deleted pet can't leave reminders behind.
  const petIds = new Set<string>([
    ...ours.map((n) => petIdOf(n)!),
    ...(onlyPetId ? [onlyPetId] : pets.map((p) => p.id)),
  ]);
  const cancel = new Set<number>();
  const dismiss = new Set<number>();
  const toSchedule: LocalNotificationSchema[] = [];
  for (const petId of petIds) {
    const pet = pets.find((p) => p.id === petId);
    const setting = pet ? settings[petId] : undefined;
    const active = setting?.enabled === true;
    const measured = new Set(
      active ? (await db.getReadingsForPet(petId)).map((r) => localDayKey(r.date)) : [],
    );
    const plan = setting && active ? planReminders(setting, measured, now) : [];
    const planned = new Map(plan.map((p) => [p.id, p.at.toISOString()]));
    for (const n of ours) {
      if (petIdOf(n) !== petId) continue;
      // Same day and time: keep it, even when due (an inexact alarm may still be on its way).
      const at = planned.get(n.id);
      if (at !== undefined && at === n.extra?.at) continue;
      cancel.add(n.id);
      // A shown reminder goes once it no longer applies; one for a changed time or a past
      // unmeasured day stays in the shade.
      if (!active || measured.has(reminderDayKey(n.id))) dismiss.add(n.id);
    }
    if (setting && active && measured.has(today)) dismiss.add(reminderId(setting.slot, today));
    if (granted && pet) {
      // A past `at` would fire at once.
      const ahead = plan.filter((p) => p.at.getTime() > now.getTime());
      toSchedule.push(...ahead.map((p) => notification(t, pet.name, petId, p)));
    }
  }
  if (cancel.size)
    await LocalNotifications.cancel({ notifications: [...cancel].map((id) => ({ id })) });
  if (dismiss.size)
    await LocalNotifications.removeDeliveredNotificationsById({ ids: [...dismiss] });
  if (toSchedule.length) {
    try {
      // Again on every sync: this renames the channel after a language change.
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: t('reminders.channelName'),
        description: t('reminders.channelDescription'),
        // IMPORTANCE_DEFAULT: makes a sound, but doesn't pop up over what's on screen.
        importance: 3,
        // VISIBILITY_PRIVATE: a secured lock screen hides the text (the pet's name); the
        // README's privacy section relies on this.
        visibility: 0,
      });
    } catch (e) {
      // Android 7 has no channels: the plugin rejects with UNAVAILABLE.
      if ((e as { code?: string }).code !== 'UNAVAILABLE') throw e;
    }
    // Only when granted (checked above): schedule() itself would show the Android 13+ prompt.
    await LocalNotifications.schedule({ notifications: toSchedule });
  }
}

function notification(
  t: AppI18n['global']['t'],
  name: string,
  petId: string,
  { id, at }: PlannedReminder,
): LocalNotificationSchema {
  return {
    id,
    title: t('reminders.notificationTitle', { name }),
    body: t('reminders.notificationBody', { name }),
    // RTC_WAKEUP while idle: a plain alarm would wait for Doze to end.
    schedule: { at, allowWhileIdle: true },
    channelId: CHANNEL_ID,
    autoCancel: true,
    // The default (true) sends the user to "Alarms & reminders" on Android 12+.
    isExactNotification: false,
    // getPending returns `at` as Java Date text; sync compares this one instead.
    extra: { petId, at: at.toISOString() },
  };
}

/** Brings the scheduled reminders in line with the settings and readings. Never rejects; does nothing on the website. */
export function syncReminders(petId?: string): Promise<void> {
  if (!isNative()) return Promise.resolve();
  return enqueue(() => sync(petId)).catch((e) => console.error('Could not update reminders', e));
}

/** Like syncReminders for one pet, but rejects, for the reminder dialog to report. */
export function applyReminders(petId: string): Promise<void> {
  if (!isNative()) return Promise.resolve();
  return enqueue(() => sync(petId));
}

/** rationale: asked and refused once; Android still shows its dialog once more. denied: it won't. */
export type ReminderPermission = 'granted' | 'prompt' | 'rationale' | 'denied';

function toPermission({ display }: PermissionStatus): ReminderPermission {
  return display === 'prompt-with-rationale' ? 'rationale' : display;
}

export async function reminderPermission(): Promise<ReminderPermission> {
  return toPermission(await LocalNotifications.checkPermissions());
}

/** The Android 13+ dialog; resolves at once with the current state when Android won't ask. */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  return toPermission(await LocalNotifications.requestPermissions());
}

export function openNotificationSettings(): Promise<void> {
  return NotificationSettings.open();
}

export function installReminders(router: Router, appI18nInstance: AppI18n): void {
  if (!isNative()) return;
  i18n = appI18nInstance;
  void LocalNotifications.addListener('localNotificationActionPerformed', ({ notification: n }) => {
    const petId: unknown = n.extra?.petId;
    if (typeof petId === 'string') void router.push({ name: 'tracker', params: { id: petId } });
  });
  void App.addListener('resume', () => void syncReminders());
  watch(appI18nInstance.global.locale, () => void syncReminders());
  void syncReminders();
}
