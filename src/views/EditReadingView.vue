<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useReadingsStore } from '../stores/readings';
import { usePetsStore } from '../stores/pets';
import type { Reading } from '../types';
import RichTextEditor from '../components/RichTextEditor.vue';

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

const editRate = ref(0);
const editRestState = ref<'resting' | 'sleeping' | undefined>(undefined);
const editNotes = ref('');
const saving = ref(false);

onMounted(async () => {
  await petsStore.loadPets();
  await readingsStore.loadReadingsForPet(petId);
  if (!reading.value) {
    router.push({ name: 'pet', params: { id: petId }, query: { tab: 'readings' } });
    return;
  }
  editRate.value = reading.value.rate;
  editRestState.value = reading.value.restState;
  editNotes.value = reading.value.notes ?? '';
});

function goBack() {
  router.replace({ name: 'reading', params: { id: petId, readingId } });
}

async function saveEdit() {
  if (!reading.value || saving.value) return;
  saving.value = true;
  try {
    const updated: Reading = {
      ...reading.value,
      rate: editRate.value,
      restState: editRestState.value,
      notes: editNotes.value || undefined,
    };
    await readingsStore.updateReading(updated);
    router.replace({ name: 'reading', params: { id: petId, readingId } });
  } finally {
    saving.value = false;
  }
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
</script>

<template>
  <div class="reading-view">
    <header class="reading-header">
      <div class="header-start">
        <button class="back-btn" @click="goBack" aria-label="Go back">
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>
      </div>

      <div class="header-center">
        <span class="header-title">Edit reading</span>
        <span class="header-subtitle">{{ pet?.name }}</span>
      </div>

      <div class="header-actions"></div>
    </header>

    <form v-if="reading" class="form" @submit.prevent="saveEdit">
      <p class="reading-date">{{ formatDate(reading.date) }}</p>

      <div class="field">
        <label class="label">Rate (breaths/min)</label>
        <div class="rate-row">
          <input
            class="rate-input"
            type="number"
            v-model.number="editRate"
            min="1"
            max="200"
          />
          <span class="rate-badge" :class="getRateClass(editRate)">
            {{ getRateLabel(editRate) }}
          </span>
        </div>
      </div>

      <div class="field">
        <label class="label">Pet was</label>
        <div class="rest-state-row">
          <button
            type="button"
            class="rest-btn"
            :class="{ active: editRestState === 'resting' }"
            @click="editRestState = editRestState === 'resting' ? undefined : 'resting'"
          >Resting</button>
          <button
            type="button"
            class="rest-btn"
            :class="{ active: editRestState === 'sleeping' }"
            @click="editRestState = editRestState === 'sleeping' ? undefined : 'sleeping'"
          >Sleeping</button>
        </div>
      </div>

      <div class="field">
        <label class="label">Notes</label>
        <RichTextEditor v-model="editNotes" />
      </div>

      <button type="submit" class="submit-btn" :disabled="saving">
        {{ saving ? 'Saving…' : 'Save changes' }}
      </button>
    </form>
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

.header-start {
  flex: 1;
  display: flex;
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
  flex: 1;
}

.form {
  padding: 24px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.reading-date {
  font-size: 13px;
  color: var(--color-text-muted);
  margin-top: -8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.rate-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.rate-input {
  width: 110px;
  height: 48px;
  padding: 0 12px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
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

.rest-state-row {
  display: flex;
  gap: 8px;
}

.rest-btn {
  flex: 1;
  height: 48px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-surface);
  transition: border-color 0.15s, color 0.15s, background 0.15s;
  max-width: 160px;
}

.rest-btn.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
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
</style>
