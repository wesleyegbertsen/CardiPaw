import { computed, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { calendarAge } from '../utils/age';

export function useAgeCalculator(birthdate: Ref<string>) {
  const { t } = useI18n();

  return computed(() => {
    if (!birthdate.value) return '';

    const now = new Date();
    const { years, months, totalMonths, born } = calendarAge(birthdate.value, now);

    if (totalMonths < 2) {
      const msPerWeek = 7 * 24 * 3600 * 1000;
      const weeks = Math.floor((now.getTime() - born.getTime()) / msPerWeek);
      return t('age.weeks', weeks <= 1 ? 1 : weeks);
    }

    if (years === 0) {
      return t('age.months', months);
    }

    const yearStr = t('age.years', years);
    if (months === 0) return yearStr;
    const monthStr = t('age.months', months);
    return t('age.yearMonth', { year: yearStr, month: monthStr });
  });
}
