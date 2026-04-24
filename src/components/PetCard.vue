<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js';
import type { Pet } from '../types';
import { useAgeCalculator } from '../composables/useAgeCalculator';
import { useReadingsStore } from '../stores/readings';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler);

const props = defineProps<{ pet: Pet }>();
const router = useRouter();
const readingsStore = useReadingsStore();

const birthdateRef = computed(() => props.pet.birthdate);
const ageDisplay = useAgeCalculator(birthdateRef);

onMounted(() => readingsStore.loadReadingsForPet(props.pet.id));

const sparklineData = computed(() => {
  const allReadings = readingsStore.getReadingsForPet(props.pet.id);
  const now = new Date();
  const labels: string[] = [];
  const values: (number | null)[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    labels.push(dayStr);

    const dayReadings = allReadings.filter((r) => r.date.slice(0, 10) === dayStr);
    if (dayReadings.length === 0) {
      values.push(null);
    } else {
      const avg = dayReadings.reduce((sum, r) => sum + r.rate, 0) / dayReadings.length;
      values.push(Math.round(avg));
    }
  }

  return { labels, values };
});

const hasSparklineData = computed(() => sparklineData.value.values.filter((v) => v !== null).length >= 2);

const chartData = computed(() => ({
  labels: sparklineData.value.labels,
  datasets: [
    {
      data: sparklineData.value.values,
      borderColor: '#e05c7a',
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.3,
      fill: true,
      backgroundColor: 'rgba(224, 92, 122, 0.12)',
      spanGaps: false,
    },
  ],
}));

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 0 },
  plugins: {
    legend: { display: false },
    tooltip: { enabled: false },
  },
  scales: {
    x: { display: false },
    y: { display: false, min: 0, max: 40 },
  },
};

function navigate() {
  router.push({ name: 'pet', params: { id: props.pet.id } });
}
</script>

<template>
  <button class="pet-card" @click="navigate" :aria-label="`View ${pet.name}'s profile`">
    <div class="photo-wrap">
      <img v-if="pet.photo" :src="pet.photo" :alt="pet.name" class="photo" />
      <div v-else class="photo-placeholder">
        <span class="placeholder-initial">{{ pet.name[0].toUpperCase() }}</span>
      </div>
    </div>

    <div class="info">
      <h3 class="name">{{ pet.name }}</h3>
      <span class="badge" :class="pet.species">{{ pet.species }}</span>
      <p class="age">{{ ageDisplay }}</p>
    </div>

    <div v-if="hasSparklineData" class="sparkline-wrap">
      <Line :data="chartData" :options="(chartOptions as any)" />
    </div>

    <svg class="chevron" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <path d="M9.29 6.71a1 1 0 0 0 0 1.41L13.17 12l-3.88 3.88a1 1 0 1 0 1.41 1.41l4.59-4.59a1 1 0 0 0 0-1.41L10.7 6.7a1 1 0 0 0-1.41.01z"/>
    </svg>
  </button>
</template>

<style scoped>
.pet-card {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 16px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  text-align: left;
  transition: box-shadow 0.15s, transform 0.1s;
}

.pet-card:active {
  transform: scale(0.98);
}

.photo-wrap {
  flex-shrink: 0;
}

.photo {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  object-fit: cover;
}

.photo-placeholder {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  background: var(--color-primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
}

.placeholder-initial {
  font-size: 24px;
  font-weight: 700;
}

.info {
  flex: 1;
  min-width: 0;
}

.name {
  font-size: 17px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  margin: 4px 0;
}

.badge.cat {
  background: #fce7f3;
  color: #9d174d;
}

.badge.dog {
  background: #dbeafe;
  color: #1e40af;
}

.age {
  font-size: 13px;
  color: var(--color-text-muted);
}

.sparkline-wrap {
  width: 80px;
  height: 44px;
  flex-shrink: 0;
}

.chevron {
  flex-shrink: 0;
  color: var(--color-border);
}
</style>
