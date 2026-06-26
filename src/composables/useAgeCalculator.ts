import { computed, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';

export function useAgeCalculator(birthdate: Ref<string>) {
  const { t } = useI18n();

  return computed(() => {
    if (!birthdate.value) return '';

    const born = new Date(birthdate.value + 'T00:00:00');
    const now = new Date();

    let years = now.getFullYear() - born.getFullYear();
    let months = now.getMonth() - born.getMonth();

    if (months < 0) {
      years--;
      months += 12;
    }

    if (now.getDate() < born.getDate()) {
      months--;
      if (months < 0) {
        years--;
        months += 12;
      }
    }

    const totalMonths = years * 12 + months;

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
