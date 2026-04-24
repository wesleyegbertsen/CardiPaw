<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import { useAgeCalculator } from '../composables/useAgeCalculator';
import RRRChart from '../components/RRRChart.vue';
import ReadingList from '../components/ReadingList.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const route = useRoute();
const router = useRouter();
const petsStore = usePetsStore();
const readingsStore = useReadingsStore();

const petId = route.params.id as string;
const pet = computed(() => petsStore.getPetById(petId));
const birthdateRef = computed(() => pet.value?.birthdate ?? '');
const ageDisplay = useAgeCalculator(birthdateRef);

const readings = computed(() => readingsStore.getReadingsForPet(petId));
const showDeleteDialog = ref(false);
const activeTab = ref<'chart' | 'history'>('chart');

const chartRange = ref<'week' | 'month' | 'year'>('week');
const chartOffset = ref(0);

watch(chartRange, () => { chartOffset.value = 0; });

function fmt(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en', options).format(date);
}

const chartWindow = computed(() => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (chartRange.value === 'week') {
    end.setDate(now.getDate() + chartOffset.value * 7);
    start.setTime(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  } else if (chartRange.value === 'month') {
    start.setMonth(now.getMonth() + chartOffset.value, 1);
    end.setMonth(now.getMonth() + chartOffset.value + 1, 0);
  } else {
    start.setFullYear(now.getFullYear() + chartOffset.value, 0, 1);
    end.setFullYear(now.getFullYear() + chartOffset.value, 11, 31);
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
});

const chartReadings = computed(() =>
  readings.value.filter((r) => {
    const d = new Date(r.date);
    return d >= chartWindow.value.start && d <= chartWindow.value.end;
  })
);

const chartLabel = computed(() => {
  const { start, end } = chartWindow.value;
  if (chartRange.value === 'week')
    return `${fmt(start, { month: 'short', day: 'numeric' })} – ${fmt(end, { month: 'short', day: 'numeric' })}`;
  if (chartRange.value === 'month')
    return fmt(start, { month: 'long', year: 'numeric' });
  return fmt(start, { year: 'numeric' });
});

const canGoNext = computed(() => chartOffset.value < 0);

onMounted(() => {
  if (!pet.value) {
    router.push({ name: 'home' });
    return;
  }
  readingsStore.loadReadingsForPet(petId);
});

async function deletePet() {
  await petsStore.removePet(petId);
  router.push({ name: 'home' });
}
</script>

<template>
  <div v-if="pet" class="page">
    <header class="page-header">
      <button class="back-btn" @click="router.push({ name: 'home' })" aria-label="Go back">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>
      <div class="header-actions">
        <button class="icon-btn" @click="router.push({ name: 'pet-edit', params: { id: petId } })" aria-label="Edit pet">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
        </button>
        <button class="icon-btn danger" @click="showDeleteDialog = true" aria-label="Delete pet">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
    </header>

    <div class="pet-hero">
      <div class="pet-avatar">
        <img v-if="pet.photo" :src="pet.photo" :alt="pet.name" class="avatar-img" />
        <div v-else class="avatar-placeholder">
          <span>{{ pet.name[0].toUpperCase() }}</span>
        </div>
      </div>
      <h1 class="pet-name">{{ pet.name }}</h1>
      <div class="pet-meta">
        <span class="badge" :class="pet.species">{{ pet.species }}</span>
        <span class="meta-dot">·</span>
        <span class="pet-age">{{ ageDisplay }}</span>
      </div>
    </div>

    <div class="track-cta">
      <button class="track-btn" @click="router.push({ name: 'tracker', params: { id: petId } })">
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        </svg>
        Start tracking
      </button>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: activeTab === 'chart' }" @click="activeTab = 'chart'">Chart</button>
      <button class="tab" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">
        History
        <span v-if="readings.length > 0" class="tab-count">{{ readings.length }}</span>
      </button>
    </div>

    <div class="tab-content">
      <template v-if="activeTab === 'chart'">
        <div class="chart-controls">
          <div class="range-toggle">
            <button :class="{ active: chartRange === 'week' }" @click="chartRange = 'week'">Week</button>
            <button :class="{ active: chartRange === 'month' }" @click="chartRange = 'month'">Month</button>
            <button :class="{ active: chartRange === 'year' }" @click="chartRange = 'year'">Year</button>
          </div>
          <div class="range-nav">
            <button class="nav-btn" @click="chartOffset--" aria-label="Previous period">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
              </svg>
            </button>
            <span class="range-label">{{ chartLabel }}</span>
            <button class="nav-btn" @click="chartOffset++" :disabled="!canGoNext" aria-label="Next period">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
              </svg>
            </button>
          </div>
        </div>
        <RRRChart :readings="chartReadings" :max-ticks="chartRange === 'year' ? 12 : chartRange === 'month' ? 6 : 8" />
      </template>
      <ReadingList v-else :readings="readings" />
    </div>

    <ConfirmDialog
      v-if="showDeleteDialog"
      :message="`Delete ${pet.name}? This will permanently remove all their readings too.`"
      @confirm="deletePet"
      @cancel="showDeleteDialog = false"
    />
  </div>
</template>

<style scoped>
.page {
  min-height: 100%;
  background: var(--color-bg);
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 10;
}

.back-btn {
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  padding: 4px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.icon-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  background: var(--color-bg);
}

.icon-btn.danger {
  color: var(--color-danger);
}

.pet-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px 24px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.pet-avatar {
  margin-bottom: 16px;
}

.avatar-img {
  width: 96px;
  height: 96px;
  border-radius: var(--radius-full);
  object-fit: cover;
  border: 3px solid var(--color-primary-light);
}

.avatar-placeholder {
  width: 96px;
  height: 96px;
  border-radius: var(--radius-full);
  background: var(--color-primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  font-weight: 700;
  color: var(--color-primary);
}

.pet-name {
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 8px;
}

.pet-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--color-text-muted);
}

.badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.badge.cat { background: #fce7f3; color: #9d174d; }
.badge.dog { background: #dbeafe; color: #1e40af; }

.meta-dot { font-size: 18px; }

.track-cta {
  padding: 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.track-btn {
  width: 100%;
  height: 52px;
  background: var(--color-primary);
  color: #fff;
  border-radius: var(--radius-md);
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: opacity 0.15s;
}

.track-btn:active {
  opacity: 0.85;
}

.tabs {
  display: flex;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  padding: 0 16px;
}

.tab {
  flex: 1;
  padding: 14px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.tab-count {
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: var(--radius-full);
}

.tab-content {
  padding: 16px;
  padding-bottom: 32px;
}

.chart-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.range-toggle {
  display: flex;
  background: var(--color-bg);
  border-radius: var(--radius-full);
  padding: 3px;
  gap: 2px;
}

.range-toggle button {
  flex: 1;
  padding: 6px 0;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  transition: background 0.15s, color 0.15s;
}

.range-toggle button.active {
  background: var(--color-surface);
  color: var(--color-primary);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.range-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nav-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  transition: color 0.15s;
}

.nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.nav-btn:not(:disabled):active {
  color: var(--color-primary);
}

.range-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}
</style>
