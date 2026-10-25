import { describe, expect, it, vi } from 'vitest';
import { aggregateByDay, formatPdfAge, htmlToPlainText } from './pdfText';
import { createTestI18n } from '../test/i18n';
import { makeReading } from '../test/fixtures';

const { t } = createTestI18n().global;

describe('formatPdfAge', () => {
  it('reads the birthdate as a local day, not UTC midnight', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    expect(formatPdfAge('2020-03-01', t, new Date(2021, 2, 1, 9))).toBe('1 year');
  });

  it('counts a month only once its day is reached', () => {
    expect(formatPdfAge('2020-03-15', t, new Date(2021, 2, 1))).toBe('11 months');
    expect(formatPdfAge('2020-03-15', t, new Date(2021, 2, 15))).toBe('1 year');
    expect(formatPdfAge('2020-03-15', t, new Date(2022, 4, 20))).toBe('2y 2mo');
  });

  it('turns a year older the day after Feb 28 for a Feb 29 birthday', () => {
    expect(formatPdfAge('2020-02-29', t, new Date(2021, 1, 28))).toBe('11 months');
    expect(formatPdfAge('2020-02-29', t, new Date(2021, 2, 1))).toBe('1 year');
  });
});

describe('htmlToPlainText', () => {
  it('keeps legacy plain-text notes verbatim', () => {
    expect(htmlToPlainText('temp <39 and >38')).toBe('temp <39 and >38');
    expect(htmlToPlainText('  a & b\n')).toBe('a & b');
  });

  it('decodes entities once, so an escaped entity stays literal', () => {
    expect(htmlToPlainText('<p>&amp;lt;b&amp;gt;</p>')).toBe('&lt;b&gt;');
    expect(htmlToPlainText('<p>&lt;39 &amp; &quot;ok&quot;&nbsp;now</p>')).toBe('<39 & "ok" now');
  });

  it('turns editor lists into dashed lines', () => {
    expect(htmlToPlainText('<p>Meds:</p><ul><li><p>one</p></li><li><p>two</p></li></ul>')).toBe(
      'Meds:\n- one\n- two',
    );
  });

  it('drops trailing empty paragraphs and collapses blank lines', () => {
    expect(htmlToPlainText('<p>a</p><p></p><p></p><p></p><p>b</p><p></p><p> </p>')).toBe('a\n\nb');
    expect(htmlToPlainText('<p>a<br>b</p>')).toBe('a\nb');
  });
});

describe('aggregateByDay', () => {
  it('averages each day and rounds half up', () => {
    const readings = [
      makeReading({ id: 'a', date: '2024-03-10T08:00:00.000Z', rate: 22 }),
      makeReading({ id: 'b', date: '2024-03-10T20:00:00.000Z', rate: 23 }),
      makeReading({ id: 'c', date: '2024-03-02T12:00:00.000Z', rate: 30 }),
    ];
    expect(aggregateByDay(readings, '2024-03')).toEqual([
      { date: '2024-03-02T12:00:00', rate: 30 },
      { date: '2024-03-10T12:00:00', rate: 23 },
    ]);
  });

  it('groups by local day and leaves out other months', () => {
    vi.stubEnv('TZ', 'Asia/Tokyo');
    const readings = [
      // 23:30 UTC on Feb 29 is already March 1 in Tokyo.
      makeReading({ id: 'a', date: '2024-02-29T23:30:00.000Z', rate: 20 }),
      makeReading({ id: 'b', date: '2024-03-01T05:00:00.000Z', rate: 30 }),
      // 15:30 UTC on March 31 is April 1 in Tokyo.
      makeReading({ id: 'c', date: '2024-03-31T15:30:00.000Z', rate: 40 }),
    ];
    expect(aggregateByDay(readings, '2024-03')).toEqual([
      { date: '2024-03-01T12:00:00', rate: 25 },
    ]);
  });
});
