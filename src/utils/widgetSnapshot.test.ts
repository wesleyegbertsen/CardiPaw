// The Android contract fixture (android/app/src/test/resources/widget-snapshot-v1.json) is
// checked at the bottom. After a deliberate change to the snapshot, regenerate it with
//   WRITE_WIDGET_FIXTURE=1 npx vitest run src/utils/widgetSnapshot.test.ts
// or in PowerShell
//   $env:WRITE_WIDGET_FIXTURE=1; npx vitest run src/utils/widgetSnapshot.test.ts; Remove-Item Env:WRITE_WIDGET_FIXTURE
// then update WidgetSnapshot.java (and bump the version if old snapshots can't be read).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../i18n/locales/en.json';
import nl from '../i18n/locales/nl.json';
import de from '../i18n/locales/de.json';
import fr from '../i18n/locales/fr.json';
import ja from '../i18n/locales/ja.json';
import { makePet, makeReading } from '../test/fixtures';
import { stubTimezone } from '../test/timezone';
import { trendReadings } from '../test/trendReadings';
import { buildWidgetSnapshot, buildWidgetStrings, type Translate } from './widgetSnapshot';

// Not ../i18n: it reads `document`, and this file runs in Node.
const messages = { en, nl, de, fr, ja };
const LOCALES = Object.keys(messages) as (keyof typeof messages)[];
function translator(locale: keyof typeof messages) {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages });
  return { t: i18n.global.t as unknown as Translate, i18n };
}
const { t } = translator('en');
const NOW = new Date('2026-11-06T15:00:00Z');
const build = (
  pets = [makePet()],
  readings = [makeReading({ date: '2026-11-06T08:00:00.000Z' })],
) => buildWidgetSnapshot({ pets, readings, now: NOW, locale: 'en', t });

/** What WidgetSnapshot.Plural.format does in Java. */
const javaPlural = (p: { one: string; other: string }, n: number) =>
  (n === 1 ? p.one : p.other).split('{n}').join(String(n));

describe('buildWidgetSnapshot', () => {
  it('picks the newest reading that is not dated after today', () => {
    const snapshot = build(
      [makePet()],
      [
        makeReading({ id: 'a', date: '2026-11-04T08:00:00.000Z', rate: 20 }),
        makeReading({ id: 'b', date: '2026-11-06T07:00:00.000Z', rate: 22 }),
        makeReading({ id: 'c', date: '2026-11-09T07:00:00.000Z', rate: 40 }),
      ],
    );
    expect(snapshot.pets[0].latest).toEqual({
      rate: 22,
      status: 'normal',
      takenAt: Date.parse('2026-11-06T07:00:00.000Z'),
    });
  });

  it('takes the newest reading when every one is dated after today', () => {
    const snapshot = build(
      [makePet()],
      [
        makeReading({ id: 'a', date: '2026-11-08T08:00:00.000Z', rate: 21 }),
        makeReading({ id: 'b', date: '2026-11-09T08:00:00.000Z', rate: 23 }),
      ],
    );
    expect(snapshot.pets[0].latest?.rate).toBe(23);
  });

  it('skips readings with an unusable rate or date', () => {
    const snapshot = build(
      [makePet()],
      [
        makeReading({ id: 'ok', date: '2026-11-01T08:00:00.000Z', rate: 25 }),
        makeReading({ id: 'nan', date: '2026-11-05T08:00:00.000Z', rate: Number.NaN }),
        makeReading({ id: 'zero', date: '2026-11-05T09:00:00.000Z', rate: 0 }),
        makeReading({ id: 'date', date: 'not a date', rate: 30 }),
      ],
    );
    expect(snapshot.pets[0].latest?.rate).toBe(25);
  });

  it("judges the status by the pet's own ceilings, from the stored rate", () => {
    const readings = [makeReading({ date: '2026-11-06T08:00:00.000Z', rate: 30.4 })];
    expect(build([makePet()], readings).pets[0].latest).toMatchObject({
      rate: 30,
      status: 'warning',
    });
    expect(
      build([makePet({ normalCeiling: 24, elevatedCeiling: 28 })], readings).pets[0].latest?.status,
    ).toBe('danger');
  });

  it('has no latest reading for a pet without readings, and ignores readings of unknown pets', () => {
    const snapshot = build(
      [makePet({ id: 'b', name: 'Bo' }), makePet({ id: 'a', name: 'Ace' })],
      [makeReading({ petId: 'gone', date: '2026-11-06T08:00:00.000Z' })],
    );
    expect(snapshot.pets.map((p) => [p.id, p.latest])).toEqual([
      ['b', null],
      ['a', null],
    ]);
  });

  it('leaves out the photo, species and birthdate', () => {
    const json = JSON.stringify(
      build([makePet({ photo: 'data:image/png;base64,AAAA', birthdate: '2019-05-04' })]),
    );
    expect(json).not.toMatch(/data:image|2019-05-04|"dog"|species|photo|birthdate/);
  });

  it('carries a trend alert for each day it still applies, and none after', () => {
    const today = new Date(2026, 10, 6, 15);
    // Baseline 20, then 3 raised days ending today: rising today and the next day (2 raised
    // days left in the window), not on the day after (1).
    const snapshot = buildWidgetSnapshot({
      pets: [makePet()],
      readings: trendReadings(today, 20, [28, 28, 28]),
      now: today,
      locale: 'en',
      t,
    });
    expect(snapshot.pets[0].alerts).toEqual({ '2026-11-06': 'rising', '2026-11-07': 'rising' });
  });

  it('carries no alert for a steady pet with a full baseline', () => {
    // computeTrend says "steady" here, not "insufficient": only rising and aboveCeiling count.
    const today = new Date(2026, 10, 6, 15);
    const snapshot = buildWidgetSnapshot({
      pets: [makePet()],
      readings: trendReadings(today, 20, [20, 20, 20]),
      now: today,
      locale: 'en',
      t,
    });
    expect(snapshot.pets[0].alerts).toEqual({});
  });

  it('picks the newest reading whatever order they come in', () => {
    const readings = [
      makeReading({ id: 'b', date: '2026-11-05T08:00:00.000Z', rate: 22 }),
      makeReading({ id: 'c', date: '2026-11-06T07:00:00.000Z', rate: 26 }),
      makeReading({ id: 'a', date: '2026-11-04T08:00:00.000Z', rate: 20 }),
    ];
    expect(build([makePet()], readings).pets[0].latest?.rate).toBe(26);
  });

  it('rounds the rate to the nearest whole breath', () => {
    const readings = [makeReading({ date: '2026-11-06T08:00:00.000Z', rate: 30.6 })];
    expect(build([makePet()], readings).pets[0].latest?.rate).toBe(31);
  });

  it("takes the initial from the name's first letter, past any leading space", () => {
    expect(build([makePet({ name: ' milo' })]).pets[0].initial).toBe('M');
  });

  it('counts camera readings as the latest reading but not for alerts', () => {
    const today = new Date(2026, 10, 6, 15);
    const readings = trendReadings(today, 20, [28, 28, 28]).map((r) => ({
      ...r,
      source: 'camera' as const,
    }));
    const snapshot = buildWidgetSnapshot({
      pets: [makePet()],
      readings,
      now: today,
      locale: 'en',
      t,
    });
    expect(snapshot.pets[0].alerts).toEqual({});
    expect(snapshot.pets[0].latest?.rate).toBe(28);
  });

  // NOW is Auckland 7 Nov 04:00 and LA 6 Nov 07:00.
  describe.each([
    ['Pacific/Auckland', '2026-11-07', '2026-11-08'],
    ['America/Los_Angeles', '2026-11-06', '2026-11-07'],
  ])('in %s', (tz, today, tomorrow) => {
    it('keys the alerts by the local day', () => {
      stubTimezone(tz);
      const snapshot = buildWidgetSnapshot({
        pets: [makePet()],
        readings: trendReadings(NOW, 20, [28, 28, 28]),
        now: NOW,
        locale: 'en',
        t,
      });
      expect(snapshot.pets[0].alerts).toEqual({ [today]: 'rising', [tomorrow]: 'rising' });
    });

    it('takes a reading from later on the local day as the latest', () => {
      stubTimezone(tz);
      // 05:00Z on 7 Nov: Auckland 7 Nov 18:00, LA 6 Nov 21:00: today locally, tomorrow in UTC.
      const later = makeReading({ id: 'later', rate: 33, date: '2026-11-07T05:00:00.000Z' });
      const earlier = makeReading({ id: 'earlier', rate: 22, date: '2026-11-06T10:00:00.000Z' });
      const snapshot = buildWidgetSnapshot({
        pets: [makePet()],
        readings: [earlier, later],
        now: NOW,
        locale: 'en',
        t,
      });
      expect(snapshot.pets[0].latest?.rate).toBe(33);
    });
  });
});

describe('buildWidgetStrings', () => {
  it.each(LOCALES)('%s: leaves {n} for Java, which then gives what the app shows', (locale) => {
    const { t: tl } = translator(locale);
    const s = buildWidgetStrings(tl);
    for (let n = 1; n <= 60; n++) {
      expect(javaPlural(s.weeksAgo, n)).toBe(tl('lastMeasured.weeksAgo', {}, n));
      expect(javaPlural(s.more, n)).toBe(tl('widget.more', {}, n));
    }
    for (let n = 2; n <= 6; n++) {
      expect(javaPlural(s.daysAgo, n)).toBe(tl('lastMeasured.daysAgo', {}, n));
    }
  });

  it.each(LOCALES)('%s: keeps every other placeholder for Java', (locale) => {
    const s = buildWidgetStrings(translator(locale).t);
    expect(s.todayAt).toContain('{time}');
    expect(s.rate).toContain('{rate}');
    for (const p of ['{name}', '{rate}', '{status}', '{age}']) expect(s.a11yReading).toContain(p);
    for (const p of ['{name}', '{age}']) expect(s.a11yNoReadings).toContain(p);
    expect(s.a11yTrend).toContain('{trend}');
  });

  it("gives the widgets a short rate, which leaves the pet's name room", () => {
    // The unit after the number, or not, as each language writes it (Java fills {rate}).
    const rate = (locale: keyof typeof messages) => buildWidgetStrings(translator(locale).t).rate;
    expect(rate('en')).toBe('{rate}/min');
    expect(rate('ja')).toBe('{rate}回/分');
  });

  it("ends TalkBack's trend sentence in each language's own way", () => {
    // Java appends it to the reading's description as is.
    const trend = (locale: keyof typeof messages) =>
      buildWidgetStrings(translator(locale).t).a11yTrend;
    expect(trend('en')).toBe(' {trend}.');
    expect(trend('ja')).toBe('{trend}。');
  });
});

describe('the Android contract fixture', () => {
  const FIXTURE = fileURLToPath(
    new URL('../../android/app/src/test/resources/widget-snapshot-v1.json', import.meta.url),
  );

  it('is what the builder makes (WidgetSnapshotTest.java parses the same file)', () => {
    const snapshot = buildWidgetSnapshot({
      pets: [
        makePet({ id: 'pet-1', name: 'Milo' }),
        makePet({ id: 'pet-2', name: 'Luna', normalCeiling: 25 }),
        makePet({ id: 'pet-3', name: 'Ziggy' }),
        makePet({ id: 'pet-4', name: 'Bella' }),
        makePet({ id: 'pet-5', name: 'Coco' }),
      ],
      readings: [
        makeReading({ id: 'r1', petId: 'pet-1', date: '2026-11-06T08:12:00.000Z', rate: 24 }),
        makeReading({ id: 'r2', petId: 'pet-2', date: '2026-11-01T08:00:00.000Z', rate: 31 }),
        // Rising, so the fixture holds an alerts entry.
        ...trendReadings(NOW, 20, [28, 28, 28], 'pet-4'),
        // Steady with a full baseline: no alerts, though computeTrend has a result.
        ...trendReadings(NOW, 20, [20, 20, 20], 'pet-5'),
      ],
      now: NOW,
      locale: 'en',
      t,
    });
    expect(snapshot.pets[3].alerts).not.toEqual({});
    expect(snapshot.pets[4].alerts).toEqual({});
    if (process.env.WRITE_WIDGET_FIXTURE) {
      writeFileSync(FIXTURE, `${JSON.stringify(snapshot, null, 2)}\n`);
    }
    // Compared parsed: a Windows checkout may have CRLF line endings.
    expect(snapshot).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  });
});
