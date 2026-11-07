import type { Pet, Reading } from '../types';
import { localDayKey, shiftDayKey } from './date';
import { petInitial } from './petInitial';
import { getRateStatus } from './rateStatus';
import { computeTrend, RECENT_DAYS } from './trend';

// What the Android home screen widgets show, built here because native code can't read the
// app's IndexedDB or its language (both live in the WebView). HomeWidgetPlugin.java stores it;
// WidgetSnapshot.java parses it. android/app/src/test/resources/widget-snapshot-v1.json is the
// contract between the two: widgetSnapshot.test.ts checks this builder still produces it.

export const WIDGET_SNAPSHOT_VERSION = 1;

export type WidgetStatus = 'normal' | 'warning' | 'danger';
export type WidgetAlert = 'rising' | 'aboveCeiling';

/** A message's two plural forms, each with a literal {n} that Java fills in. */
export interface WidgetPlural {
  one: string;
  other: string;
}

export interface WidgetStrings {
  bpm: string;
  status: Record<WidgetStatus, string>;
  trend: Record<WidgetAlert, string>;
  today: string;
  /** With a literal {time}. */
  todayAt: string;
  yesterday: string;
  daysAgo: WidgetPlural;
  weeksAgo: WidgetPlural;
  noReadings: string;
  noPets: string;
  petMissing: string;
  more: WidgetPlural;
  /** With literal {name}, {rate}, {status} and {age}. */
  a11yReading: string;
  /** With literal {name} and {age}. */
  a11yNoReadings: string;
  /** Appended to a11yReading on an alert day, with a literal {trend} (its own space or none). */
  a11yTrend: string;
}

export interface WidgetPet {
  id: string;
  name: string;
  initial: string;
  latest: { rate: number; status: WidgetStatus; takenAt: number } | null;
  /** Local day key → alert, for today and the next RECENT_DAYS - 1 days; only days with one. */
  alerts: Record<string, WidgetAlert>;
}

export interface WidgetSnapshot {
  v: typeof WIDGET_SNAPSHOT_VERSION;
  locale: string;
  strings: WidgetStrings;
  pets: WidgetPet[];
}

/** vue-i18n's composer t(key, named, plural), the one overload this module needs. */
export type Translate = (key: string, named: Record<string, unknown>, plural: number) => string;

/**
 * A message rendered with each {placeholder} passed as its own text, so it stays in the
 * output for Java to fill. plural 1 / 2 pick vue-i18n's "one" / "other" branch.
 */
function literal(t: Translate, key: string, placeholders: string[], plural = 1): string {
  return t(key, Object.fromEntries(placeholders.map((p) => [p, `{${p}}`])), plural);
}

function plural(t: Translate, key: string): WidgetPlural {
  return { one: literal(t, key, ['n'], 1), other: literal(t, key, ['n'], 2) };
}

export function buildWidgetStrings(t: Translate): WidgetStrings {
  const text = (key: string) => t(key, {}, 1);
  return {
    bpm: text('common.breathsPerMin'),
    status: {
      normal: text('status.normal'),
      warning: text('status.warning'),
      danger: text('status.danger'),
    },
    trend: { rising: text('trend.badge'), aboveCeiling: text('trend.badgeAboveCeiling') },
    today: text('lastMeasured.today'),
    todayAt: literal(t, 'widget.todayAt', ['time']),
    yesterday: text('lastMeasured.yesterday'),
    daysAgo: plural(t, 'lastMeasured.daysAgo'),
    weeksAgo: plural(t, 'lastMeasured.weeksAgo'),
    noReadings: text('lastMeasured.none'),
    noPets: text('home.noPetsTitle'),
    petMissing: text('widget.petMissing'),
    more: plural(t, 'widget.more'),
    a11yReading: literal(t, 'widget.a11yReading', ['name', 'rate', 'status', 'age']),
    a11yNoReadings: literal(t, 'widget.a11yNoReadings', ['name', 'age']),
    a11yTrend: literal(t, 'widget.a11yTrend', ['trend']),
  };
}

const usable = (r: Reading) =>
  Number.isFinite(r.rate) && r.rate > 0 && !Number.isNaN(Date.parse(r.date));

function latestReading(readings: Reading[], today: string): Reading | undefined {
  // Newest first, as the readings store sorts them (ISO strings compare by time).
  const sorted = readings.filter(usable).sort((a, b) => b.date.localeCompare(a.date));
  // As useLastMeasured: a reading dated after today (a clock that was ahead) only counts when
  // every reading is; the widget then says "today".
  return sorted.find((r) => localDayKey(r.date) <= today) ?? sorted[0];
}

function alertsFor(pet: Pet, readings: Reading[], now: Date): Record<string, WidgetAlert> {
  const alerts: Record<string, WidgetAlert> = {};
  const today = localDayKey(now);
  // With no new reading, an alert can end as the recent window moves on: the widget picks the
  // day it is drawn on. Noon: computeTrend works in whole local days.
  for (let i = 0; i < RECENT_DAYS; i++) {
    const day = shiftDayKey(today, i);
    const [y, m, d] = day.split('-').map(Number);
    const result = computeTrend(readings, pet, new Date(y, m - 1, d, 12));
    if (result.kind === 'rising' || result.kind === 'aboveCeiling') alerts[day] = result.kind;
  }
  return alerts;
}

export function buildWidgetSnapshot(input: {
  pets: Pet[];
  readings: Reading[];
  now: Date;
  locale: string;
  t: Translate;
}): WidgetSnapshot {
  const { now } = input;
  const today = localDayKey(now);
  const byPet = new Map<string, Reading[]>();
  for (const r of input.readings) {
    const list = byPet.get(r.petId);
    if (list) list.push(r);
    else byPet.set(r.petId, [r]);
  }
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    locale: input.locale,
    strings: buildWidgetStrings(input.t),
    // No photo, species or birthdate: only what the widgets show.
    pets: input.pets.map((pet) => {
      const readings = byPet.get(pet.id) ?? [];
      const last = latestReading(readings, today);
      return {
        id: pet.id,
        name: pet.name,
        initial: petInitial(pet.name),
        latest: last
          ? {
              rate: Math.round(last.rate),
              // The stored rate, as the app's lists judge it.
              status: getRateStatus(last.rate, pet).cssClass as WidgetStatus,
              takenAt: Date.parse(last.date),
            }
          : null,
        alerts: alertsFor(pet, readings, now),
      };
    }),
  };
}
