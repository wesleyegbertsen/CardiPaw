// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useLastMeasured } from './useLastMeasured';
import { withSetup } from '../test/withSetup';
import { makeReading } from '../test/fixtures';
import type { Reading } from '../types';
import { stubTimezone } from '../test/timezone';

function lastMeasured(readings: Reading[]) {
  const [result, app] = withSetup(() => useLastMeasured(ref(readings)));
  const value = result.value;
  app.unmount();
  return value;
}

/** A reading at local time on the given day of March 2024. */
const onMarch = (day: number, hour = 12) =>
  makeReading({ date: new Date(2024, 2, day, hour).toISOString() });

describe('useLastMeasured', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says so when there are no readings', () => {
    expect(lastMeasured([])).toEqual({ label: 'No readings yet', isStale: false });
  });

  it.each([
    [0, 'Measured today'],
    [1, 'Measured yesterday'],
    [2, 'Measured 2 days ago'],
    [6, 'Measured 6 days ago'],
    [7, 'Last measured 1 week ago'],
    [13, 'Last measured 1 week ago'],
    [14, 'Last measured 2 weeks ago'],
  ])('labels a reading %i days old as "%s"', (days, label) => {
    vi.setSystemTime(new Date(2024, 2, 20, 9));
    expect(lastMeasured([onMarch(20 - days, 21)]).label).toBe(label);
  });

  it('says today for a reading dated after today', () => {
    // Saved while the device clock was ahead.
    vi.setSystemTime(new Date(2024, 2, 20, 9));
    expect(lastMeasured([onMarch(21)])).toEqual({ label: 'Measured today', isStale: false });
  });

  it('compares local calendar days, not 24-hour periods', () => {
    vi.setSystemTime(new Date(2024, 2, 20, 0, 5));
    expect(lastMeasured([onMarch(19, 23)]).label).toBe('Measured yesterday');
  });

  it('becomes stale after more than 3 days', () => {
    vi.setSystemTime(new Date(2024, 2, 20, 9));
    expect(lastMeasured([onMarch(17)]).isStale).toBe(false);
    expect(lastMeasured([onMarch(16)]).isStale).toBe(true);
  });

  it('counts days correctly across a DST weekend', () => {
    stubTimezone('Europe/Amsterdam');
    // Clocks went forward on 31 March 2024, so that day had only 23 hours.
    vi.setSystemTime(new Date(2024, 3, 1, 0, 30));
    expect(lastMeasured([onMarch(30, 23)]).label).toBe('Measured 2 days ago');
    expect(lastMeasured([onMarch(31, 0)]).label).toBe('Measured yesterday');
  });
});
