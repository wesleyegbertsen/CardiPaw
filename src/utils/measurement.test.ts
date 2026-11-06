import { describe, expect, it } from 'vitest';
import { breathsPerMinute, isMeasurementSeconds, readingSeconds, readingSource } from './measurement';

describe('isMeasurementSeconds', () => {
  it.each([15, 30, 60])('accepts %s', (value) => {
    expect(isMeasurementSeconds(value)).toBe(true);
  });

  it.each([45, 0, 30.5, Number.NaN, '30', null, undefined])('rejects %s', (value) => {
    expect(isMeasurementSeconds(value)).toBe(false);
  });
});

describe('breathsPerMinute', () => {
  it.each([
    [15, 12],
    [30, 6],
    [60, 3],
  ] as const)('scales 3 taps in %s seconds to %s a minute', (seconds, rate) => {
    expect(breathsPerMinute(3, seconds)).toBe(rate);
  });
});

describe('readingSource', () => {
  it('is guided when the reading has no source', () => {
    expect(readingSource({})).toBe('guided');
  });

  it.each(['manual', 'camera'] as const)('is %s for such a reading', (source) => {
    expect(readingSource({ source })).toBe(source);
  });
});

describe('readingSeconds', () => {
  it('returns the length a guided reading was measured for', () => {
    expect(readingSeconds({ durationSeconds: 60 })).toBe(60);
  });

  it('returns the length a camera reading ran for, 30 seconds without one', () => {
    expect(readingSeconds({ source: 'camera', durationSeconds: 60 })).toBe(60);
    expect(readingSeconds({ source: 'camera' })).toBe(30);
  });

  it('treats a guided reading saved before lengths were selectable as 30 seconds', () => {
    expect(readingSeconds({})).toBe(30);
  });

  it('has no length for a manual entry', () => {
    expect(readingSeconds({ source: 'manual', durationSeconds: 30 })).toBeNull();
  });
});
