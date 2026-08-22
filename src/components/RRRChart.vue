<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import type { Reading } from '../types';
import { useThemeStore } from '../stores/theme';
import { DEFAULT_NORMAL_CEILING } from '../utils/rateStatus';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const props = defineProps<{
  readings: Reading[];
  maxTicks?: number;
  normalCeiling?: number;
  /** The pet's usual range, drawn as a second reference line. Omit to hide it. */
  baseline?: number | null;
}>();
const themeStore = useThemeStore();
const { t, locale } = useI18n();

const effectiveNormalCeiling = computed(() => props.normalCeiling ?? DEFAULT_NORMAL_CEILING);

const baselineValue = computed(() => props.baseline ?? null);
const baselineColor = computed(() => (themeStore.isDark ? '#60a5fa' : '#2563eb'));

const sortedReadings = computed(() =>
  [...props.readings].sort((a, b) => a.date.localeCompare(b.date))
);

const labels = computed(() =>
  sortedReadings.value.map((r) =>
    new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' }).format(new Date(r.date))
  )
);

const rates = computed(() => sortedReadings.value.map((r) => r.rate));

const chartData = computed(() => {
  const datasets = [
    {
      label: 'Breaths/min',
      data: rates.value,
      borderColor: '#e05c7a',
      backgroundColor: 'rgba(224, 92, 122, 0.1)',
      borderWidth: 2.5,
      pointBackgroundColor: '#e05c7a',
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: 0.3,
      fill: true,
    },
    {
      label: `Normal max (${effectiveNormalCeiling.value})`,
      data: labels.value.map(() => effectiveNormalCeiling.value),
      borderColor: 'rgba(22, 163, 74, 0.5)',
      borderWidth: 1.5,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
    },
  ];

  const baseline = baselineValue.value;
  if (baseline !== null) {
    // Shorter dashes than the Normal max line so the two are told apart at a glance.
    datasets.push({
      label: `Usual (${baseline})`,
      data: labels.value.map(() => baseline),
      borderColor: baselineColor.value,
      borderWidth: 1.5,
      borderDash: [2, 3],
      pointRadius: 0,
      fill: false,
    });
  }

  return { labels: labels.value, datasets };
});

const chartOptions = computed(() => {
  const textMuted = themeStore.isDark ? '#9ca3af' : '#6b7280';
  const gridColor = themeStore.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { parsed: { y: number | null } }) => t('chart.tooltip', { n: ctx.parsed.y ?? 0 }),
        },
      },
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: props.maxTicks ?? 8,
          font: { size: 11 },
          color: textMuted,
        },
        grid: { display: false },
      },
      y: {
        title: { display: true, text: t('chart.yAxis'), color: textMuted, font: { size: 11 } },
        min: 0,
        suggestedMax: 80,
        ticks: { font: { size: 11 }, color: textMuted },
        grid: { color: gridColor },
      },
    },
  };
});
</script>

<template>
  <div class="chart-wrap">
    <template v-if="readings.length > 0">
      <div class="legend">
        <span class="legend-item primary">{{ $t('chart.legendRate') }}</span>
        <span class="legend-item normal">{{ $t('chart.legendNormalMax', { n: effectiveNormalCeiling }) }}</span>
        <span v-if="baselineValue !== null" class="legend-item baseline">{{ $t('chart.legendBaseline', { n: baselineValue }) }}</span>
      </div>
      <div class="chart-container">
        <Line :data="chartData" :options="chartOptions" />
      </div>
    </template>
    <div v-else class="empty">{{ $t('chart.empty') }}</div>
  </div>
</template>

<style scoped>
.chart-wrap {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: 16px;
  box-shadow: var(--shadow-sm);
}

.chart-container {
  height: 220px;
  position: relative;
}

.legend {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.legend-item {
  font-size: 11px;
  font-weight: 500;
}

.legend-item.primary {
  color: var(--color-primary);
}

.legend-item.normal {
  color: var(--color-success);
  opacity: 0.7;
}

.legend-item.baseline {
  color: var(--color-info);
  opacity: 0.85;
}

.empty {
  padding: 32px 0;
  text-align: center;
  font-size: 14px;
  color: var(--color-text-muted);
}
</style>
