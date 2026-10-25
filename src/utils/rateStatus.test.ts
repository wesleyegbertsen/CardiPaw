import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ELEVATED_CEILING,
  DEFAULT_NORMAL_CEILING,
  getRateStatus,
  isValidRate,
} from './rateStatus';

const label = (rate: number, pet?: Parameters<typeof getRateStatus>[1]) =>
  getRateStatus(rate, pet).label;

describe('getRateStatus', () => {
  it('uses 30 and 35 breaths/min as the default ceilings', () => {
    expect(DEFAULT_NORMAL_CEILING).toBe(30);
    expect(DEFAULT_ELEVATED_CEILING).toBe(35);
  });

  it.each([
    [0, 'Normal'],
    [30, 'Normal'],
    [31, 'Elevated'],
    [35, 'Elevated'],
    [36, 'High'],
    [120, 'High'],
  ])('classifies %i breaths/min as %s with the default ceilings', (rate, expected) => {
    expect(label(rate)).toBe(expected);
  });

  it('treats each ceiling as inclusive for fractional rates', () => {
    expect(label(30.5)).toBe('Elevated');
    expect(label(35.5)).toBe('High');
  });

  it('returns matching cssClass and colour for each level', () => {
    expect(getRateStatus(20)).toEqual({ label: 'Normal', cssClass: 'normal', color: '#16a34a' });
    expect(getRateStatus(33)).toEqual({
      label: 'Elevated',
      cssClass: 'warning',
      color: '#d97706',
    });
    expect(getRateStatus(40)).toEqual({ label: 'High', cssClass: 'danger', color: '#dc2626' });
  });

  it('falls back to the defaults when the pet has no custom ceilings', () => {
    expect(label(30, {})).toBe('Normal');
    expect(label(31, {})).toBe('Elevated');
    expect(label(36, {})).toBe('High');
  });

  it('uses custom ceilings at their exact boundaries', () => {
    const pet = { normalCeiling: 25, elevatedCeiling: 40 };
    expect(label(25, pet)).toBe('Normal');
    expect(label(26, pet)).toBe('Elevated');
    expect(label(40, pet)).toBe('Elevated');
    expect(label(41, pet)).toBe('High');
  });

  it('mixes one custom ceiling with the other default', () => {
    expect(label(28, { normalCeiling: 27 })).toBe('Elevated');
    expect(label(36, { normalCeiling: 27 })).toBe('High');
    expect(label(30, { elevatedCeiling: 45 })).toBe('Normal');
    expect(label(45, { elevatedCeiling: 45 })).toBe('Elevated');
    expect(label(46, { elevatedCeiling: 45 })).toBe('High');
  });

  it('respects a ceiling of 0 instead of treating it as missing', () => {
    // `??` keeps 0; a `||` fallback would silently replace it with the default.
    expect(label(0, { normalCeiling: 0 })).toBe('Normal');
    expect(label(1, { normalCeiling: 0 })).toBe('Elevated');
    expect(label(1, { normalCeiling: 0, elevatedCeiling: 0 })).toBe('High');
  });
});

describe('isValidRate', () => {
  it.each([1, 30, 200])('accepts %s', (value) => {
    expect(isValidRate(value)).toBe(true);
  });

  it.each([0, -5, 201, 12.5, '', '30', NaN, Infinity, undefined])('rejects %j', (value) => {
    expect(isValidRate(value)).toBe(false);
  });
});
