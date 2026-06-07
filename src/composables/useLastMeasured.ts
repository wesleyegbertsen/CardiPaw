import { computed, type Ref } from 'vue';
import type { Reading } from '../types';

export function useLastMeasured(readings: Ref<Reading[]>) {
  return computed(() => {
    if (!readings.value.length) return { label: 'No readings yet', isStale: false };

    const todayStr = new Date().toISOString().slice(0, 10);
    const lastStr  = readings.value[0].date.slice(0, 10); // sorted descending, [0] is newest

    const msPerDay = 86_400_000;
    const diffDays = Math.round(
      (new Date(todayStr).getTime() - new Date(lastStr).getTime()) / msPerDay
    );

    let label: string;
    if      (diffDays === 0) label = 'Measured today';
    else if (diffDays === 1) label = 'Measured yesterday';
    else if (diffDays <= 6)  label = `Measured ${diffDays} days ago`;
    else {
      const weeks = Math.floor(diffDays / 7);
      label = `Last measured ${weeks} week${weeks === 1 ? '' : 's'} ago`;
    }

    return { label, isStale: diffDays > 3 };
  });
}
