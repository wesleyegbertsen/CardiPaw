<script setup lang="ts">
import { computed } from 'vue';
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

const props = defineProps<{ readings: Reading[]; maxTicks?: number; normalCeiling?: number }>();
const themeStore = useThemeStore();

const effectiveNormalCeiling = computed(() => props.normalCeiling ?? DEFAULT_NORMAL_CEILING);

const sortedReadings = computed(() =>
  [...props.readings].sort((a, b) => a.date.localeCompare(b.date))
);

const labels = computed(() =>
  sortedReadings.value.map((r) =>
    new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(r.date))
  )
);

const rates = computed(() => sortedReadings.value.map((r) => r.rate));

const chartData = computed(() => ({
  labels: labels.value,
  datasets: [
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
  ],
}));

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
          label: (ctx: { parsed: { y: number | null } }) => `${ctx.parsed.y ?? ''} breaths/min`,
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
        title: { display: true, text: 'Breaths / min', color: textMuted, font: { size: 11 } },
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
        <span class="legend-item primary">— Rate</span>
        <span class="legend-item normal">- - Normal max ({{ effectiveNormalCeiling }} breaths/min)</span>
      </div>
      <div class="chart-container">
        <Line :data="chartData" :options="chartOptions" />
      </div>
    </template>
    <div v-else class="empty">No readings yet — start tracking to see a chart.</div>
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

.empty {
  padding: 32px 0;
  text-align: center;
  font-size: 14px;
  color: var(--color-text-muted);
}
</style>
