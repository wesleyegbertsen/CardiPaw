<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useReadingsStore } from '../stores/readings';
import { usePetsStore } from '../stores/pets';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import type { Reading } from '../types';

const route = useRoute();
const router = useRouter();
const readingsStore = useReadingsStore();
const petsStore = usePetsStore();

const petId = route.params.id as string;
const readingId = route.params.readingId as string;

const pet = computed(() => petsStore.getPetById(petId));
const reading = computed(() =>
  readingsStore.getReadingsForPet(petId).find(r => r.id === readingId) ?? null
);

const editing = ref(false);
const editRate = ref(0);
const editRestState = ref<'resting' | 'sleeping' | undefined>(undefined);
const editNotes = ref('');
const saving = ref(false);
const showDeleteDialog = ref(false);

onMounted(async () => {
  await petsStore.loadPets();
  await readingsStore.loadReadingsForPet(petId);
});

function startEdit() {
  if (!reading.value) return;
  editRate.value = reading.value.rate;
  editRestState.value = reading.value.restState;
  editNotes.value = reading.value.notes ?? '';
  editing.value = true;
}

function goBack() {
  if (editing.value) {
    editing.value = false;
    return;
  }
  router.push({ name: 'pet', params: { id: petId }, query: { tab: 'history' } });
}

async function saveEdit() {
  if (!reading.value || saving.value) return;
  saving.value = true;
  try {
    const updated: Reading = {
      ...reading.value,
      rate: editRate.value,
      restState: editRestState.value,
      notes: editNotes.value.trim() || undefined,
    };
    await readingsStore.updateReading(updated);
    editing.value = false;
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!reading.value) return;
  await readingsStore.removeReading(reading.value.id, petId);
  router.push({ name: 'pet', params: { id: petId }, query: { tab: 'history' } });
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

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
</script>

<template>
  <div class="reading-view">
    <header class="reading-header">
      <button class="back-btn" @click="goBack" aria-label="Go back">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>

      <div class="header-center">
        <span class="header-title">{{ editing ? 'Edit reading' : pet?.name }}</span>
        <span v-if="editing" class="header-subtitle">{{ pet?.name }}</span>
      </div>

      <div class="header-actions">
        <button
          v-if="!editing"
          class="icon-btn"
          @click="startEdit"
          aria-label="Edit reading"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
        </button>
        <button
          v-if="!editing"
          class="icon-btn danger"
          @click="showDeleteDialog = true"
          aria-label="Delete reading"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
    </header>

    <div v-if="reading" class="reading-body">
      <div class="reading-card">
        <p class="reading-date">{{ formatDate(reading.date) }}</p>

        <div class="rate-row">
          <div v-if="!editing" class="rate-display">
            <span class="rate-number">{{ reading.rate }}</span>
            <span class="rate-unit">breaths/min</span>
          </div>
          <div v-else class="rate-edit-wrap">
            <label class="field-label">Rate (breaths/min)</label>
            <input
              class="rate-input"
              type="number"
              v-model.number="editRate"
              min="1"
              max="200"
            />
          </div>
          <span class="rate-badge" :class="getRateClass(editing ? editRate : reading.rate)">
            {{ getRateLabel(editing ? editRate : reading.rate) }}
          </span>
        </div>
      </div>

      <div class="detail-card">
        <p class="section-label">Pet was</p>
        <div v-if="!editing" class="rest-state-view">
          <span v-if="reading.restState" class="rest-chip" :class="reading.restState">
            {{ reading.restState === 'resting' ? 'Resting' : 'Sleeping' }}
          </span>
          <span v-else class="no-value">Not recorded</span>
        </div>
        <div v-else class="rest-state-row">
          <button
            class="rest-btn"
            :class="{ active: editRestState === 'resting' }"
            @click="editRestState = editRestState === 'resting' ? undefined : 'resting'"
          >Resting</button>
          <button
            class="rest-btn"
            :class="{ active: editRestState === 'sleeping' }"
            @click="editRestState = editRestState === 'sleeping' ? undefined : 'sleeping'"
          >Sleeping</button>
        </div>
      </div>

      <div class="detail-card">
        <p class="section-label">Notes</p>
        <p v-if="!editing && reading.notes" class="notes-text">{{ reading.notes }}</p>
        <p v-else-if="!editing" class="no-value">No notes</p>
        <textarea
          v-else
          class="notes-input"
          v-model="editNotes"
          placeholder="Add notes… (optional)"
          rows="4"
        />
      </div>

      <button
        v-if="editing"
        class="submit-btn"
        @click="saveEdit"
        :disabled="saving"
      >{{ saving ? 'Saving…' : 'Save changes' }}</button>
    </div>

    <div v-else class="not-found">Reading not found.</div>

    <ConfirmDialog
      v-if="showDeleteDialog"
      message="Delete this reading? This cannot be undone."
      @confirm="confirmDelete"
      @cancel="showDeleteDialog = false"
    />
  </div>
</template>

<style scoped>
.reading-view {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}

.reading-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.back-btn {
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  padding: 4px;
}

.header-center {
  height: 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
}

.header-subtitle {
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
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

.submit-btn {
  height: 52px;
  background: var(--color-primary);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  border-radius: var(--radius-md);
  transition: opacity 0.15s;
}

.submit-btn:disabled {
  opacity: 0.5;
}

.reading-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.reading-card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.reading-date {
  font-size: 13px;
  color: var(--color-text-muted);
}

.rate-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.rate-display {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.rate-number {
  font-size: 52px;
  font-weight: 800;
  color: var(--color-text);
  line-height: 1;
}

.rate-unit {
  font-size: 13px;
  color: var(--color-text-muted);
}

.rate-edit-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.rate-input {
  width: 110px;
  height: 44px;
  padding: 0 12px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 22px;
  font-weight: 700;
}

.rate-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.rate-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
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

.detail-card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.rest-state-view {
  display: flex;
}

.rest-chip {
  font-size: 13px;
  font-weight: 500;
  padding: 4px 14px;
  border-radius: var(--radius-full);
}

.rest-chip.resting {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.rest-chip.sleeping {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.no-value {
  font-size: 14px;
  color: var(--color-text-muted);
}

.rest-state-row {
  display: flex;
  gap: 8px;
}

.rest-btn {
  flex: 1;
  height: 40px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-bg);
  transition: border-color 0.15s, color 0.15s, background 0.15s;
  max-width: 160px;
}

.rest-btn.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.notes-text {
  font-size: 15px;
  color: var(--color-text);
  line-height: 1.6;
  white-space: pre-wrap;
}

.notes-input {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  line-height: 1.5;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.notes-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.notes-input::placeholder {
  color: var(--color-text-muted);
}

.not-found {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--color-text-muted);
}
</style>
