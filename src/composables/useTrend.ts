import { computed, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Pet, Reading } from '../types';
import { computeTrend, isTrendAlert, RECENT_DAYS } from '../utils/trend';

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
    let message = '';
    if (alerting && result.kind === 'rising') {
      message = t('trend.rising', {
        name,
        recent: Math.round(result.recent!),
        baseline: Math.round(result.baseline!),
        days: RECENT_DAYS,
      });
    } else if (alerting) {
      message = t('trend.aboveCeiling', {
        name,
        ceiling: result.normalCeiling,
        days: RECENT_DAYS,
      });
    }
    return { result, alerting, message };
  });
}
