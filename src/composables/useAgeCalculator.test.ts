// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useAgeCalculator } from './useAgeCalculator';
import { withSetup } from '../test/withSetup';

describe('useAgeCalculator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats weeks, months and years, and nothing without a birthdate', () => {
    vi.setSystemTime(new Date(2024, 5, 15, 12));
    const birthdate = ref('');
    const [age, app] = withSetup(() => useAgeCalculator(birthdate));

    expect(age.value).toBe('');
    birthdate.value = '2024-05-25';
    expect(age.value).toBe('3 weeks');
    birthdate.value = '2023-11-15';
    expect(age.value).toBe('7 months');
    birthdate.value = '2021-06-15';
    expect(age.value).toBe('3 years');
    birthdate.value = '2021-03-01';
    expect(age.value).toBe('3 years, 3 months');
    app.unmount();
  });
});
