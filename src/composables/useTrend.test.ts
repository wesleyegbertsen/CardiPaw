import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { useTrend } from './useTrend';
import { withSetup } from '../test/withSetup';
import { makePet } from '../test/fixtures';
import { trendReadings } from '../test/trendReadings';
import type { Pet, Reading } from '../types';

const today = new Date(2024, 2, 20, 9);

// `pet` has no default: passing undefined must mean "no pet".
function setup(readings: Reading[], pet: Pet | undefined) {
  const readingsRef = ref(readings);
  const [trend, app] = withSetup(() => useTrend(readingsRef, ref(pet)));
  return { trend, readingsRef, app };
}

describe('useTrend', () => {
  beforeEach(() => vi.setSystemTime(today));
  afterEach(() => vi.useRealTimers());

  it('describes a rise with rounded numbers', () => {
    const { trend, app } = setup(trendReadings(today, 20, [27, 28]), makePet());
    expect(trend.value.alerting).toBe(true);
    expect(trend.value.message).toBe(
      "Ace's resting breathing rate has been about 28 breaths/min over the last 3 days, up from a usual 20.",
    );
    app.unmount();
  });

  it('rounds a half-breath baseline in the message', () => {
    // Baseline median 20.5 (5 days at 20, 5 at 21).
    const baseline = [20, 20, 20, 20, 20, 21, 21, 21, 21, 21];
    const { trend, app } = setup(trendReadings(today, baseline, [28, 28]), makePet());
    expect(trend.value.result).toMatchObject({ kind: 'rising', baseline: 20.5 });
    expect(trend.value.message).toMatch(/about 28 breaths\/min .*, up from a usual 21\.$/);
    app.unmount();
  });

  it("describes days above the pet's Normal ceiling", () => {
    const { trend, app } = setup(
      trendReadings(today, null, [30, 30]),
      makePet({ normalCeiling: 28 }),
    );
    expect(trend.value.message).toBe(
      "Ace's resting breathing rate has been above 28 breaths/min on more than one of the last 3 days.",
    );
    app.unmount();
  });

  it('stays quiet without an alert, data or pet', () => {
    for (const [readings, pet] of [
      [trendReadings(today, 20, [20, 22]), makePet()],
      [trendReadings(today, 20, [28]), makePet()],
      [trendReadings(today, 20, [28, 28]), undefined],
    ] as const) {
      const { trend, app } = setup([...readings], pet);
      expect(trend.value).toMatchObject({ alerting: false, message: '' });
      app.unmount();
    }
  });

  it('updates when the readings change', async () => {
    const { trend, readingsRef, app } = setup(trendReadings(today, 20, [28]), makePet());
    expect(trend.value.alerting).toBe(false);
    readingsRef.value = trendReadings(today, 20, [28, 28]);
    await nextTick();
    expect(trend.value.alerting).toBe(true);
    readingsRef.value = trendReadings(today, 20, [20, 20]);
    expect(trend.value.alerting).toBe(false);
    app.unmount();
  });
});
