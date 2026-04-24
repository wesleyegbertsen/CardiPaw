import { computed, type Ref } from 'vue';

export function useAgeCalculator(birthdate: Ref<string>) {
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
      return weeks <= 1 ? '1 week' : `${weeks} weeks`;
    }

    if (years === 0) {
      return months === 1 ? '1 month' : `${months} months`;
    }

    const yearStr = years === 1 ? '1 year' : `${years} years`;
    if (months === 0) return yearStr;
    const monthStr = months === 1 ? '1 month' : `${months} months`;
    return `${yearStr}, ${monthStr}`;
  });
}
