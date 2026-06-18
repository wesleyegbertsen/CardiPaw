import { computed, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Reading } from '../types';

export function useLastMeasured(readings: Ref<Reading[]>) {
  const { t } = useI18n();

  return computed(() => {
    if (!readings.value.length) return { label: t('lastMeasured.none'), isStale: false };

    const todayStr = new Date().toISOString().slice(0, 10);
    const lastStr  = readings.value[0].date.slice(0, 10); // sorted descending, [0] is newest

    const msPerDay = 86_400_000;
    const diffDays = Math.round(
      (new Date(todayStr).getTime() - new Date(lastStr).getTime()) / msPerDay
    );

    let label: string;
    if      (diffDays === 0) label = t('lastMeasured.today');
    else if (diffDays === 1) label = t('lastMeasured.yesterday');
    else if (diffDays <= 6)  label = t('lastMeasured.daysAgo', diffDays);
    else {
      const weeks = Math.floor(diffDays / 7);
      label = t('lastMeasured.weeksAgo', weeks);
    }

    return { label, isStale: diffDays > 3 };
  });
}
