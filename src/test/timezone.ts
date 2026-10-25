import { expect, vi } from 'vitest';

/**
 * Switches the process timezone for the current test (undone by `unstubEnvs`).
 * Fails loudly if the zone did not take effect, so a timezone test can never
 * pass by silently running in UTC.
 */
export function stubTimezone(tz: string) {
  vi.stubEnv('TZ', tz);
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(tz);
}
