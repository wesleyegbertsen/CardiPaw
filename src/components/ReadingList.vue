<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Pet, Reading } from '../types';
import { getRateStatus } from '../utils/rateStatus';

const props = defineProps<{ readings: Reading[]; pet: Pet }>();

const router = useRouter();

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

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function openReading(reading: Reading) {
  router.push({ name: 'reading', params: { id: props.pet.id, readingId: reading.id } });
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
      @click="openReading(reading)"
    >
      <div class="reading-left">
        <div class="reading-date">{{ formatDate(reading.date) }}</div>
        <div class="reading-meta">
          <span v-if="reading.restState === 'resting'" class="meta-tag resting" aria-label="Resting">
            <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
              <path d="M21 9V7c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v2c-1.1 0-2 .9-2 2v5h1.33L3 18h1l.67-2h14.67l.66 2h1l-.33-2H23v-5c0-1.1-.9-2-2-2zm-8 0H5V7h8v2zm6 0h-4V7h4v2z"/>
            </svg>
          </span>
          <span v-if="reading.restState === 'sleeping'" class="meta-tag sleeping" aria-label="Sleeping">
            <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
              <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>
            </svg>
          </span>
          <span v-if="reading.notes" class="meta-tag notes" aria-label="Has notes">
            <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
            </svg>
          </span>
        </div>
      </div>
      <div class="reading-right">
        <span class="reading-rate">{{ reading.rate }} <span class="rate-unit">breaths/min</span></span>
        <span class="rate-badge" :class="getRateStatus(reading.rate, props.pet).cssClass">
          {{ getRateStatus(reading.rate, props.pet).label }}
        </span>
        <svg class="chevron" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M9.29 6.71a1 1 0 0 0 0 1.41L13.17 12l-3.88 3.88a1 1 0 1 0 1.41 1.41l4.59-4.59a1 1 0 0 0 0-1.41L10.7 6.7a1 1 0 0 0-1.41.01z"/>
        </svg>
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
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0 12px;
  padding: 14px 16px;
  min-height: 70px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: background 0.12s, box-shadow 0.15s, transform 0.1s;
}

.reading-item:hover {
  box-shadow: var(--shadow-md);
}

.reading-item:active {
  transform: scale(0.98);
}

.reading-left {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.reading-date {
  font-size: 13px;
  color: var(--color-text-muted);
}

.reading-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.meta-tag.resting {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.meta-tag.sleeping {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.meta-tag.notes {
  background: var(--color-primary-light);
  color: var(--color-primary);
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

.chevron {
  flex-shrink: 0;
  color: var(--color-border);
}

.reading-item:hover .chevron {
  color: var(--color-text-muted);
}

.sentinel {
  height: 1px;
}
</style>
