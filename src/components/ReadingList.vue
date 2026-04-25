<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Reading } from '../types';

const props = defineProps<{ readings: Reading[] }>();
const emit = defineEmits<{ delete: [reading: Reading] }>();

const PAGE = 20;
const visibleCount = ref(PAGE);
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

const visibleReadings = computed(() => props.readings.slice(0, visibleCount.value));
const hasMore = computed(() => visibleCount.value < props.readings.length);

watch(() => props.readings.length, () => { visibleCount.value = PAGE; });

watch(hasMore, (val) => {
  if (!val) observer?.disconnect();
});

onMounted(() => {
  observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) visibleCount.value += PAGE;
  });
  if (sentinel.value) observer.observe(sentinel.value);
});

onUnmounted(() => observer?.disconnect());

function getRateClass(rate: number) {
  if (rate <= 30) return 'normal';
  if (rate <= 35) return 'warning';
  return 'danger';
}

function getRateLabel(rate: number) {
  if (rate <= 30) return 'Normal';
  if (rate <= 35) return 'Elevated';
  return 'High';
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
</script>

<template>
  <div class="reading-list">
    <div v-if="readings.length === 0" class="empty">
      No readings yet. Tap "Start tracking" to record your first measurement.
    </div>

    <div
      v-for="reading in visibleReadings"
      :key="reading.id"
      class="reading-item"
    >
      <div class="reading-date">{{ formatDate(reading.date) }}</div>
      <div class="reading-right">
        <span class="reading-rate">{{ reading.rate }} <span class="rate-unit">breaths/min</span></span>
        <span class="rate-badge" :class="getRateClass(reading.rate)">
          {{ getRateLabel(reading.rate) }}
        </span>
        <button class="delete-btn" @click="emit('delete', reading)" aria-label="Delete reading">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
    </div>

    <div v-if="hasMore" ref="sentinel" class="sentinel" />
  </div>
</template>

<style scoped>
.reading-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty {
  padding: 24px 0;
  text-align: center;
  font-size: 14px;
  color: var(--color-text-muted);
}

.reading-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.reading-date {
  font-size: 13px;
  color: var(--color-text-muted);
}

.reading-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.reading-rate {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
}

.rate-unit {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-muted);
}

.rate-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: var(--radius-full);
}

.rate-badge.normal {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.rate-badge.warning {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.rate-badge.danger {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  transition: color 0.15s;
}

.delete-btn:hover {
  color: var(--color-danger);
}

.sentinel {
  height: 1px;
}
</style>
