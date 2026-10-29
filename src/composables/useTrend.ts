import { computed, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Pet, Reading } from '../types';
import {
  BASELINE_DAYS,
  computeTrend,
  isTrendAlert,
  MIN_BASELINE_DAYS,
  MIN_DAYS_ABOVE_CEILING,
  MIN_RAISED_DAYS,
  RECENT_DAYS,
  RISE_MIN_BREATHS,
  RISE_PERCENT,
} from '../utils/trend';

/**
 * The pet's trend alert, if any. Like useLastMeasured, "today" is read when the
 * readings or pet change, not on a timer.
 */
export function useTrend(
  readings: Ref<Reading[]>,
  pet: Ref<Pick<Pet, 'name' | 'normalCeiling'> | undefined>,
) {
  const { t } = useI18n();

  return computed(() => {
    const result = computeTrend(readings.value, pet.value);
    const alerting = !!pet.value && isTrendAlert(result);
    const name = pet.value?.name ?? '';
    let title = '';
    let badge = '';
    let message = '';
    if (alerting && result.kind === 'rising') {
      title = t('trend.title');
      badge = t('trend.badge');
      message = t('trend.rising', {
        name,
        recent: Math.round(result.recent),
        baseline: Math.round(result.baseline),
        days: RECENT_DAYS,
      });
    } else if (alerting) {
      title = t('trend.titleAboveCeiling');
      badge = t('trend.badgeAboveCeiling');
      message = t('trend.aboveCeiling', {
        name,
        ceiling: result.normalCeiling,
        days: RECENT_DAYS,
        minAbove: MIN_DAYS_ABOVE_CEILING,
      });
    }
    // For "How is this worked out?", so views don't need the tuning constants.
    const infoParams = {
      name,
      days: RECENT_DAYS,
      baselineDays: BASELINE_DAYS,
      minDays: MIN_BASELINE_DAYS,
      percent: RISE_PERCENT,
      breaths: RISE_MIN_BREATHS,
      minRaised: MIN_RAISED_DAYS,
      minAbove: MIN_DAYS_ABOVE_CEILING,
      ceiling: result.normalCeiling,
    };
    return { result, alerting, title, badge, message, infoParams };
  });
}
