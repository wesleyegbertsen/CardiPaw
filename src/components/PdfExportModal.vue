<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Pet, Reading } from '../types';
import { usePdfExport } from '../composables/usePdfExport';

const props = defineProps<{ pet: Pet; readings: Reading[] }>();
const emit = defineEmits<{ close: [] }>();

const { isGenerating, generatePdf } = usePdfExport();

const availableMonths = computed(() => {
  const set = new Set(props.readings.map(r => r.date.slice(0, 7)));
  return [...set].sort().reverse();
});

const selectedMonths = ref<string[]>([...availableMonths.value]);
const newestFirst = ref(true);
const includeNotes = ref(false);

const allSelected = computed(
  () => selectedMonths.value.length === availableMonths.value.length
);

function toggleAll() {
  selectedMonths.value = allSelected.value ? [] : [...availableMonths.value];
}

function toggleMonth(month: string) {
  const idx = selectedMonths.value.indexOf(month);
  if (idx >= 0) {
    selectedMonths.value = selectedMonths.value.filter(m => m !== month);
  } else {
    selectedMonths.value = [...selectedMonths.value, month];
  }
}

function formatMonth(key: string): string {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(
    new Date(key + '-15')
  );
}

function countReadings(monthKey: string): number {
  return props.readings.filter(r => r.date.startsWith(monthKey)).length;
}

async function handleExport() {
  await generatePdf(props.pet, props.readings, selectedMonths.value, newestFirst.value, includeNotes.value);
  setTimeout(() => emit('close'), 200);
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="() => { if (!isGenerating) emit('close'); }">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="pdf-modal-title">
        <div class="dialog-header">
          <h2 class="dialog-title" id="pdf-modal-title">Export PDF</h2>
          <p class="dialog-subtitle">{{ pet.name }}</p>
        </div>

        <div class="list-controls">
          <span class="list-info">
            {{ availableMonths.length }} month{{ availableMonths.length !== 1 ? 's' : '' }} available
          </span>
          <button class="toggle-all-btn" @click="toggleAll" :disabled="isGenerating">
            {{ allSelected ? 'Clear all' : 'Select all' }}
          </button>
        </div>

        <div class="sort-toggle">
          <span class="sort-label">Order</span>
          <div class="sort-options">
            <button
              class="sort-btn"
              :class="{ active: newestFirst }"
              @click="newestFirst = true"
              :disabled="isGenerating"
            >Newest first</button>
            <button
              class="sort-btn"
              :class="{ active: !newestFirst }"
              @click="newestFirst = false"
              :disabled="isGenerating"
            >Oldest first</button>
          </div>
        </div>

        <div class="notes-toggle">
          <label class="notes-toggle-label" :class="{ disabled: isGenerating }">
            <input type="checkbox" v-model="includeNotes" :disabled="isGenerating" />
            <span>Include reading notes</span>
          </label>
        </div>

        <div class="month-list">
          <label
            v-for="month in availableMonths"
            :key="month"
            class="month-row"
            :class="{ disabled: isGenerating }"
          >
            <input
              type="checkbox"
              :checked="selectedMonths.includes(month)"
              @change="toggleMonth(month)"
              :disabled="isGenerating"
            />
            <span class="month-label">{{ formatMonth(month) }}</span>
            <span class="month-badge">{{ countReadings(month) }}</span>
          </label>
        </div>

        <p v-if="selectedMonths.length === 0" class="empty-hint">
          Select at least one month to export.
        </p>

        <div class="dialog-footer">
          <button class="btn-cancel" @click="emit('close')" :disabled="isGenerating">
            Cancel
          </button>
          <button
            class="btn-export"
            @click="handleExport"
            :disabled="isGenerating || selectedMonths.length === 0"
          >
            <span v-if="isGenerating" class="spinner" aria-hidden="true" />
            {{ isGenerating ? 'Generating…' : 'Export PDF' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 500;
  padding: 0;
}

@media (min-width: 480px) {
  .overlay {
    align-items: center;
    padding: 24px;
  }
}

.dialog {
  background: var(--color-surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding: 24px;
  width: 100%;
  max-width: 420px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 80vh;
}

@media (min-width: 480px) {
  .dialog {
    border-radius: var(--radius-lg);
  }
}

.dialog-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dialog-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
}

.dialog-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
}

.list-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.list-info {
  font-size: 12px;
  color: var(--color-text-muted);
}

.toggle-all-btn {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: var(--color-primary-light);
}

.toggle-all-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.sort-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sort-label {
  font-size: 12px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.sort-options {
  display: flex;
  background: var(--color-bg);
  border-radius: var(--radius-full);
  padding: 3px;
  gap: 2px;
}

.sort-btn {
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  transition: background 0.15s, color 0.15s;
}

.sort-btn.active {
  background: var(--color-surface);
  color: var(--color-primary);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.sort-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.notes-toggle {
  display: flex;
}

.notes-toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
}

.notes-toggle-label.disabled {
  opacity: 0.5;
  cursor: default;
}

.notes-toggle-label input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--color-primary);
  flex-shrink: 0;
  cursor: pointer;
}

.notes-toggle-label.disabled input[type='checkbox'] {
  cursor: default;
}

.month-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
}

.month-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  background: var(--color-bg);
  transition: background 0.1s;
}

.month-row:not(.disabled):hover {
  background: var(--color-primary-light);
}

.month-row.disabled {
  cursor: default;
  opacity: 0.6;
}

.month-row input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--color-primary);
  flex-shrink: 0;
  cursor: pointer;
}

.month-row.disabled input[type='checkbox'] {
  cursor: default;
}

.month-label {
  flex: 1;
  font-size: 14px;
  color: var(--color-text);
}

.month-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: 1px 8px;
}

.empty-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  text-align: center;
  margin: 0;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 4px;
  border-top: 1px solid var(--color-border);
}

.btn-cancel {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
}

.btn-cancel:disabled {
  opacity: 0.4;
  cursor: default;
}

.btn-export {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: var(--color-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  transition: opacity 0.15s;
}

.btn-export:disabled {
  opacity: 0.5;
  cursor: default;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
