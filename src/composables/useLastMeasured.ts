import { computed, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Reading } from '../types';
import { localDayKey } from '../utils/date';

export function useLastMeasured(readings: Ref<Reading[]>) {
  const { t } = useI18n();

  return computed(() => {
    if (!readings.value.length) return { label: t('lastMeasured.none'), isStale: false };

    // Compare local calendar days; parsing the "YYYY-MM-DD" keys as UTC midnight
    // keeps the difference an exact multiple of a day, even across DST changes.
    const todayStr = localDayKey(new Date());
    // A reading saved while the device clock was ahead (here, or on the device a backup
    // came from) is dated after today. Judge by the newest one that is not (readings are
    // sorted descending), and say "today" if every reading is in the future.
    const last = readings.value.find((r) => localDayKey(r.date) <= todayStr);
    const lastStr = last ? localDayKey(last.date) : todayStr;

    const msPerDay = 86_400_000;
    const diffDays = Math.round(
      (new Date(todayStr).getTime() - new Date(lastStr).getTime()) / msPerDay,
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
