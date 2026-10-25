import { describe, expect, it } from 'vitest';
import { calendarAge } from './age';
import { stubTimezone } from '../test/timezone';

describe('calendarAge', () => {
  it('counts whole years and months', () => {
    expect(calendarAge('2020-03-15', new Date(2022, 4, 20))).toMatchObject({
      years: 2,
      months: 2,
      totalMonths: 26,
    });
  });

  it('does not count a month until its day of the month is reached', () => {
    expect(calendarAge('2020-03-15', new Date(2021, 2, 14))).toMatchObject({
      years: 0,
      months: 11,
    });
    expect(calendarAge('2020-03-15', new Date(2021, 2, 15))).toMatchObject({
      years: 1,
      months: 0,
    });
  });

  it('borrows across the year boundary', () => {
    expect(calendarAge('2020-12-20', new Date(2021, 0, 10))).toMatchObject({
      years: 0,
      months: 0,
      totalMonths: 0,
    });
  });

  it('reads the birthdate as local midnight west of Greenwich', () => {
    stubTimezone('America/Los_Angeles');
    const { born, years, months } = calendarAge('2020-03-01', new Date(2021, 2, 1, 9));
    expect(born.getDate()).toBe(1);
    expect(born.getHours()).toBe(0);
    expect({ years, months }).toEqual({ years: 1, months: 0 });
  });
});
