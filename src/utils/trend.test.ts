import { describe, expect, it } from 'vitest';
import { computeTrend, isTrendAlert } from './trend';
import { makeReading } from '../test/fixtures';
import { stubTimezone } from '../test/timezone';

// "Today" is 20 March 2024. Days are built in the current (possibly stubbed) zone,
// so call the helpers after stubTimezone.
const asOf = () => new Date(2024, 2, 20, 12);
let seq = 0;
const day = (offset: number, rate: number, hour = 12, minute = 0) =>
  makeReading({
    id: `r${seq++}`,
    date: new Date(2024, 2, 20 + offset, hour, minute).toISOString(),
    rate,
  });
/** One reading per day at `rate` for days `from`..`to` (offsets from today, inclusive). */
const days = (from: number, to: number, rate: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => day(from + i, rate));
/** 28 baseline days (today−30 … today−3) at `rate`. */
const baselineAt = (rate: number) => days(-30, -3, rate);
/** Recent day values, oldest first, ending today. */
const recentOf = (...rates: number[]) => rates.map((r, i) => day(i - rates.length + 1, r));

const trend = (readings: ReturnType<typeof day>[], pet?: { normalCeiling?: number }) =>
  computeTrend(readings, pet, asOf());

describe('computeTrend', () => {
  it('needs two recent days and seven baseline days', () => {
    expect(trend([])).toMatchObject({ kind: 'insufficient', recent: null, baseline: null });
    expect(trend([...baselineAt(20), ...recentOf(28)])).toMatchObject({
      kind: 'insufficient',
      recent: null,
      recentDays: 1,
    });
    // 30 is still Normal, so only the rising rule could fire.
    expect(trend([...days(-9, -4, 20), ...recentOf(30, 30)])).toMatchObject({
      kind: 'insufficient',
      baseline: null,
      baselineDays: 6,
    });
    expect(trend([...days(-10, -4, 20), ...recentOf(30, 30)])).toMatchObject({
      kind: 'rising',
      baseline: 20,
      baselineDays: 7,
    });
  });

  it('reports none for a stable pet', () => {
    expect(trend([...baselineAt(20), ...recentOf(20, 22, 20)])).toMatchObject({
      kind: 'none',
      baseline: 20,
      recentDays: 3,
    });
  });

  it('keeps the baseline robust to an outlier day', () => {
    const readings = [...baselineAt(20), day(-12, 40), ...recentOf(20, 20)];
    expect(trend(readings).baseline).toBe(20);
  });

  it('needs two raised recent days, not one high one', () => {
    // Mean 24.7 is +23% and +4.7, but only one day is raised.
    expect(trend([...baselineAt(20), ...recentOf(20, 20, 34)])).toMatchObject({
      kind: 'none',
      raisedDays: 1,
    });
    expect(trend([...baselineAt(20), ...recentOf(20, 24, 34)])).toMatchObject({
      kind: 'rising',
      raisedDays: 2,
    });
  });

  it('does not call it rising when the mean is not above the baseline', () => {
    expect(trend([...baselineAt(20), ...recentOf(24, 24, 12)])).toMatchObject({
      kind: 'none',
      raisedDays: 2,
      recent: 20,
    });
  });

  it('does not call it rising when the rounded numbers are equal', () => {
    // Baseline 20.5 and mean 20.7 would read "about 21, up from a usual 21".
    const halfDays = [-10, -9, -8, -7].flatMap((d) => [day(d, 20, 8), day(d, 22, 9)]);
    expect(trend([...days(-14, -11, 20), ...halfDays, ...recentOf(26, 26, 10)])).toMatchObject({
      kind: 'none',
      raisedDays: 2,
      baseline: 20.5,
    });
    // Baseline 20 and mean 20.3 would read "about 20, up from a usual 20".
    const lowDay = [day(0, 12, 8), day(0, 14, 9)];
    expect(trend([...days(-10, -3, 20), day(-2, 24), day(-1, 24), ...lowDay])).toMatchObject({
      kind: 'none',
      raisedDays: 2,
      recentDays: 3,
    });
  });

  it('counts each day once, using the median of its readings', () => {
    const retakes = [40, 40, 40, 40, 40].map((rate, h) => day(0, rate, 8 + h));
    expect(trend([...baselineAt(20), day(-1, 20), ...retakes])).toMatchObject({
      kind: 'none',
      recentDays: 2,
      raisedDays: 1,
      daysAboveCeiling: 1,
      recent: 30,
    });
    // One miscount among three readings doesn't move the day.
    expect(
      trend([...baselineAt(20), day(-1, 20), day(0, 20, 8), day(0, 60, 9), day(0, 22, 10)]).recent,
    ).toBe(21);
  });

  it('takes the middle two values for an even count', () => {
    // 14 baseline days at 20 and 14 at 24.
    expect(trend([...days(-30, -17, 20), ...days(-16, -3, 24), ...recentOf(28, 28)])).toMatchObject(
      { kind: 'rising', baseline: 22 },
    );
    // A day with readings 20 and 30 counts as 25.
    expect(trend([...baselineAt(20), day(-1, 20), day(0, 20, 8), day(0, 30, 9)]).recent).toBe(22.5);
  });

  it('sorts rates as numbers, not text', () => {
    // As text, 40 would sort between 10 and 9.
    expect(
      trend([...baselineAt(20), day(-1, 10), day(0, 9, 8), day(0, 10, 9), day(0, 40, 10)]).recent,
    ).toBe(10);
    const baseline = [9, 9, 9, 10, 40, 40, 40].map((rate, i) => day(-9 + i, rate));
    expect(trend([...baseline, ...recentOf(10, 10)]).baseline).toBe(10);
  });

  it('needs the rise to clear both the percentage and the breaths floor', () => {
    expect(trend([...baselineAt(12), ...recentOf(14, 14)]).kind).toBe('none'); // +16%, +2
    expect(trend([...baselineAt(12), ...recentOf(16, 16)]).kind).toBe('rising'); // +33%, +4
    expect(trend([...baselineAt(25), ...recentOf(29, 29)]).kind).toBe('none'); // +16%, +4
    expect(trend([...baselineAt(10), ...recentOf(12, 12)]).kind).toBe('none'); // +20%, +2
  });

  it('includes the exact thresholds', () => {
    expect(trend([...baselineAt(20), ...recentOf(24, 24)]).kind).toBe('rising'); // +20%, +4 exactly
    expect(trend([...baselineAt(20), ...recentOf(23, 23)]).kind).toBe('none');
    expect(trend([...baselineAt(25), ...recentOf(30, 30)]).kind).toBe('rising'); // +20% exactly, +5
    expect(trend([...baselineAt(25), ...recentOf(29.5, 29.5)]).kind).toBe('none');
  });

  it('reports a step change with its numbers', () => {
    expect(trend([...baselineAt(20), ...recentOf(28, 28)])).toMatchObject({
      kind: 'rising',
      baseline: 20,
      recent: 28,
    });
  });

  it('catches a slow creep, because the recent days are not part of the baseline', () => {
    // 20 until today−10, then +1 a day up to 29 today.
    const readings = [
      ...days(-30, -10, 20),
      ...Array.from({ length: 9 }, (_, i) => day(-8 + i, 21 + i)),
    ];
    expect(trend(readings)).toMatchObject({ kind: 'rising', baseline: 20, recent: 28 });
  });

  it('alerts above the Normal ceiling on two recent days, with or without a baseline', () => {
    expect(trend([...baselineAt(32), ...recentOf(36, 36)])).toMatchObject({
      kind: 'aboveCeiling',
      raisedDays: 0,
      daysAboveCeiling: 2,
    });
    expect(trend(recentOf(34, 34))).toMatchObject({
      kind: 'aboveCeiling',
      baseline: null,
      normalCeiling: 30,
    });
    expect(trend(recentOf(30, 30)).kind).toBe('insufficient'); // at the ceiling is still Normal
    expect(trend(recentOf(34, 20, 34)).kind).toBe('aboveCeiling');
    expect(trend(recentOf(20, 34)).kind).toBe('insufficient');
  });

  it("uses the pet's own Normal ceiling", () => {
    expect(trend([...baselineAt(32), ...recentOf(36, 36)], { normalCeiling: 40 }).kind).toBe(
      'none',
    );
    expect(trend(recentOf(26, 26), { normalCeiling: 24 })).toMatchObject({
      kind: 'aboveCeiling',
      normalCeiling: 24,
    });
  });

  it('prefers rising when both rules fire', () => {
    expect(trend([...baselineAt(26), ...recentOf(34, 34)]).kind).toBe('rising');
  });

  it('uses today−30 … today−3 as the baseline and today−2 … today as recent', () => {
    expect(trend([day(-31, 20), ...days(-30, -3, 20)]).baselineDays).toBe(28);
    expect(trend([...days(-30, -3, 20), day(-2, 20)])).toMatchObject({
      baselineDays: 28,
      recentDays: 1,
    });
    // Raised days at today−3 are baseline, not recent.
    expect(trend([...days(-30, -4, 20), day(-3, 28), day(-2, 28)])).toMatchObject({
      recentDays: 1,
      kind: 'insufficient',
    });
  });

  it('ignores readings dated after today', () => {
    expect(trend([...baselineAt(20), ...recentOf(20, 20), day(1, 60), day(2, 60)])).toMatchObject({
      kind: 'none',
      recentDays: 2,
    });
  });

  it('skips rates and dates that cannot be real', () => {
    const bad = [0, -4, NaN, Infinity].map((rate) => day(0, rate));
    expect(trend([...baselineAt(20), day(-1, 28), ...bad])).toMatchObject({
      recentDays: 1,
      kind: 'insufficient',
    });
    const badDate = makeReading({ id: 'bad', date: 'not a date', rate: 60 });
    expect(trend([...baselineAt(20), ...recentOf(20, 20), badDate]).kind).toBe('none');
    expect(trend([...baselineAt(20.5), ...recentOf(25.5, 25.5)])).toMatchObject({
      kind: 'rising',
      baseline: 20.5,
    });
  });

  it('groups by local day west of Greenwich', () => {
    stubTimezone('America/New_York');
    // 23:30 on 19 March in New York is 03:30 UTC on the 20th.
    expect(day(-1, 28, 23, 30).date).toBe('2024-03-20T03:30:00.000Z');
    expect(trend([...baselineAt(20), day(-1, 28, 23, 30), day(-1, 28, 8)])).toMatchObject({
      recentDays: 1,
    });
    // The baseline spans the 10 March DST change and still has 28 days.
    expect(trend([day(-31, 20), ...baselineAt(20), ...recentOf(28, 28)])).toMatchObject({
      kind: 'rising',
      baselineDays: 28,
    });
  });

  it('groups by local day east of Greenwich', () => {
    stubTimezone('Pacific/Auckland');
    // 00:30 on 20 March in Auckland is 11:30 UTC on the 19th.
    expect(day(0, 28, 0, 30).date).toBe('2024-03-19T11:30:00.000Z');
    expect(trend([...baselineAt(20), day(-1, 28), day(0, 28, 0, 30)])).toMatchObject({
      kind: 'rising',
      recentDays: 2,
    });
  });
});

describe('isTrendAlert', () => {
  it('is true only for rising and aboveCeiling', () => {
    const results = [
      trend([...baselineAt(20), ...recentOf(28, 28)]),
      trend(recentOf(34, 34)),
      trend([...baselineAt(20), ...recentOf(20, 20)]),
      trend([]),
    ];
    expect(results.map((r) => r.kind)).toEqual(['rising', 'aboveCeiling', 'none', 'insufficient']);
    expect(results.map(isTrendAlert)).toEqual([true, true, false, false]);
  });
});
