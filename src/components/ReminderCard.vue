<script setup lang="ts">
import type { Reminder } from '../types';

const props = defineProps<{ reminder: Reminder }>();
const emit = defineEmits<{ toggle: [id: string, petId: string] }>();

const DAYS: { label: string; value: 0|1|2|3|4|5|6 }[] = [
  { label: 'M', value: 1 },
  { label: 'T', value: 2 },
  { label: 'W', value: 3 },
  { label: 'T', value: 4 },
  { label: 'F', value: 5 },
  { label: 'S', value: 6 },
  { label: 'S', value: 0 },
];

function formatTime(time: string) {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

function onToggle(event: Event) {
  event.stopPropagation();
  emit('toggle', props.reminder.id, props.reminder.petId);
}
</script>

<template>
  <div class="reminder-card" :class="{ disabled: !reminder.enabled }">
    <div class="reminder-main">
      <div class="reminder-time">{{ formatTime(reminder.time) }}</div>
      <div class="reminder-title">{{ reminder.title }}</div>
      <div class="reminder-days">
        <span
          v-for="day in DAYS"
          :key="day.value"
          class="day-chip"
          :class="{ active: reminder.days.includes(day.value) }"
        >{{ day.label }}</span>
      </div>
    </div>
    <button
      class="toggle-btn"
      :aria-label="reminder.enabled ? 'Disable reminder' : 'Enable reminder'"
      :aria-pressed="reminder.enabled"
      @click="onToggle"
    >
      <span class="toggle-track" :class="{ on: reminder.enabled }">
        <span class="toggle-thumb" />
      </span>
    </button>
    <svg class="chevron" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
      <path d="M9.29 6.71a1 1 0 0 0 0 1.41L13.17 12l-3.88 3.88a1 1 0 1 0 1.41 1.41l4.59-4.59a1 1 0 0 0 0-1.41L10.7 6.7a1 1 0 0 0-1.41.01z"/>
    </svg>
  </div>
</template>

<style scoped>
.reminder-card {
  display: flex;
  align-items: center;
  padding: 16px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  gap: 12px;
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.1s, opacity 0.2s;
}

.reminder-card:hover {
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.12));
}

.reminder-card:active {
  transform: scale(0.98);
}

.reminder-card:has(.toggle-btn:active):active {
  transform: none;
}

.reminder-card.disabled {
  opacity: 0.5;
}

.reminder-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reminder-time {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  color: var(--color-text);
  letter-spacing: -0.5px;
}

.reminder-title {
  font-size: 14px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reminder-days {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.day-chip {
  font-size: 11px;
  font-weight: 600;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  background: transparent;
}

.day-chip.active {
  background: var(--color-primary);
  color: #fff;
}

/* Toggle switch */
.toggle-btn {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  flex-shrink: 0;
}

.toggle-track {
  display: block;
  width: 48px;
  height: 26px;
  border-radius: 13px;
  background: var(--color-border);
  position: relative;
  transition: background 0.2s;
}

.toggle-track.on {
  background: var(--color-primary);
}

.toggle-thumb {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  position: absolute;
  top: 3px;
  left: 3px;
  transition: transform 0.2s;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}

.toggle-track.on .toggle-thumb {
  transform: translateX(22px);
}

.chevron {
  flex-shrink: 0;
  color: var(--color-border);
}

.reminder-card:hover .chevron {
  color: var(--color-text-muted);
}
</style>
