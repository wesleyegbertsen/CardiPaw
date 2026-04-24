<script setup lang="ts">
import { computed } from 'vue';
import type { Reading, Species } from '../types';

const props = defineProps<{ readings: Reading[]; species: Species }>();

const normalMax = computed(() => (props.species === 'cat' ? 40 : 30));

function getRateClass(rate: number) {
  if (rate <= normalMax.value) return 'normal';
  if (rate <= 50) return 'warning';
  return 'danger';
}

function getRateLabel(rate: number) {
  if (rate <= normalMax.value) return 'Normal';
  if (rate <= 50) return 'Elevated';
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
      v-for="reading in readings"
      :key="reading.id"
      class="reading-item"
    >
      <div class="reading-date">{{ formatDate(reading.date) }}</div>
      <div class="reading-right">
        <span class="reading-rate">{{ reading.rate }} <span class="bpm-label">bpm</span></span>
        <span class="rate-badge" :class="getRateClass(reading.rate)">
          {{ getRateLabel(reading.rate) }}
        </span>
      </div>
    </div>
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

.bpm-label {
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
</style>
