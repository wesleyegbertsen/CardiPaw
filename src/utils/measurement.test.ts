import { describe, expect, it } from 'vitest';
import { isMeasurementSeconds, rateFromTaps, readingSeconds } from './measurement';

describe('isMeasurementSeconds', () => {
  it.each([15, 30, 60])('accepts %s', (value) => {
    expect(isMeasurementSeconds(value)).toBe(true);
  });

  it.each([45, '30', -1, 0, null, undefined, NaN])('rejects %s', (value) => {
    expect(isMeasurementSeconds(value)).toBe(false);
  });
});

describe('readingSeconds', () => {
  it('uses the length saved on the reading', () => {
    expect(readingSeconds({ durationSeconds: 60 })).toBe(60);
  });

  it('treats a reading without a length as a 30-second measurement', () => {
    expect(readingSeconds({})).toBe(30);
  });
});

describe('rateFromTaps', () => {
  it.each([
    [15, 28],
    [30, 14],
    [60, 7],
  ] as const)('scales 7 taps over %s seconds to %s breaths per minute', (seconds, rate) => {
    expect(rateFromTaps(7, seconds)).toBe(rate);
  });
});
