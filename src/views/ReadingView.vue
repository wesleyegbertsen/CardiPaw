<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useReadingsStore } from '../stores/readings';
import { usePetsStore } from '../stores/pets';
import ConfirmDialog from '../components/ConfirmDialog.vue';

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

const showDeleteDialog = ref(false);

const sanitizedNotes = computed(() => {
  const raw = reading.value?.notes ?? '';
  const isHtml = /^<[a-z]/i.test(raw.trimStart());
  return isHtml ? raw : raw.replace(/\n/g, '<br>');
});

onMounted(async () => {
  await petsStore.loadPets();
  await readingsStore.loadReadingsForPet(petId);
});

function goBack() {
  router.push({ name: 'pet', params: { id: petId }, query: { tab: 'history' } });
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
      <div class="header-start">
        <button class="back-btn" @click="goBack" aria-label="Go back">
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>
      </div>

      <div class="header-center">
        <span class="header-title">{{ pet?.name }}</span>
      </div>

      <div class="header-actions">
        <button
          class="icon-btn"
          @click="router.replace({ name: 'reading-edit', params: { id: petId, readingId } })"
          aria-label="Edit reading"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
        </button>
        <button
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
          <div class="rate-display">
            <span class="rate-number">{{ reading.rate }}</span>
            <span class="rate-unit">breaths/min</span>
          </div>
          <span class="rate-badge" :class="getRateClass(reading.rate)">
            {{ getRateLabel(reading.rate) }}
          </span>
        </div>
      </div>

      <div class="detail-card">
        <p class="section-label">Pet was</p>
        <div class="rest-state-view">
          <span v-if="reading.restState" class="rest-chip" :class="reading.restState">
            {{ reading.restState === 'resting' ? 'Resting' : 'Sleeping' }}
          </span>
          <span v-else class="no-value">Not recorded</span>
        </div>
      </div>

      <div class="detail-card">
        <p class="section-label">Notes</p>
        <div v-if="reading.notes" class="notes-text" v-html="sanitizedNotes" />
        <p v-else class="no-value">No notes</p>
      </div>
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

.header-actions {
  flex: 1;
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
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

.notes-text {
  font-size: 15px;
  color: var(--color-text);
  line-height: 1.6;
}

.notes-text :deep(p) {
  margin-bottom: 0.4em;
}

.notes-text :deep(p:last-child) {
  margin-bottom: 0;
}

.notes-text :deep(ul) {
  padding-left: 20px;
}

.notes-text :deep(li) {
  margin-bottom: 2px;
}

.notes-text :deep(strong) {
  font-weight: 600;
}

.notes-text :deep(em) {
  font-style: italic;
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
