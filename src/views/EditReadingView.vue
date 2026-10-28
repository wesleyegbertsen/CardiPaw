<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, useId } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useReadingsStore } from '../stores/readings';
import { usePetsStore } from '../stores/pets';
import type { Reading } from '../types';
import { getRateStatus, isValidRate } from '../utils/rateStatus';
import { LazyRichTextEditor as RichTextEditor } from '../components/LazyRichTextEditor';
import RestStateToggle from '../components/RestStateToggle.vue';
import { useI18n } from 'vue-i18n';

const { locale } = useI18n();

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
const rateId = useId();
const rateStatusId = useId();
const notesLabelId = useId();
const editNotes = ref('');
const saving = ref(false);
const saveError = ref(false);
const loadError = ref(false);
// v-model.number yields '' when the field is cleared; never store that as the rate.
// Guided results (taps×2) can exceed 200, so an unchanged stored rate stays saveable.
const rateValid = computed(() => isValidRate(editRate.value) || editRate.value === reading.value?.rate);

let unmounted = false;
onUnmounted(() => {
  unmounted = true;
});

onMounted(async () => {
  try {
    await petsStore.loadPets();
    await readingsStore.loadReadingsForPet(petId);
  } catch (e) {
    console.error('Loading reading failed', e);
    loadError.value = true;
    return;
  }
  // The user may have left while the reading loaded; don't pull them away from another page.
  if (unmounted) return;
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
  if (!reading.value || loadError.value || saving.value || !rateValid.value) return;
  saving.value = true;
  saveError.value = false;
  try {
    const updated: Reading = {
      ...reading.value,
      rate: editRate.value,
      restState: editRestState.value,
      notes: editNotes.value || undefined,
    };
    await readingsStore.updateReading(updated);
    router.replace({ name: 'reading', params: { id: petId, readingId } });
  } catch (e) {
    console.error('Saving reading failed', e);
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat(locale.value, {
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
        <button class="back-btn" @click="goBack" :aria-label="$t('common.back')">
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>
      </div>

      <div class="header-center">
        <span class="header-title">{{ $t('reading.title') }}</span>
        <span class="header-subtitle">{{ pet?.name }}</span>
      </div>

      <div class="header-actions"></div>
    </header>

    <p v-if="loadError" class="save-error load-error" role="alert">{{ $t('common.loadError') }}</p>

    <form v-if="reading && !loadError" class="form" novalidate @submit.prevent="saveEdit">
      <div class="reading-meta-row">
        <p class="reading-date">{{ formatDate(reading.date) }}</p>
        <span class="source-chip" :class="reading.source === 'manual' ? 'manual' : 'guided'">
          {{ reading.source === 'manual' ? $t('source.manualEntry') : $t('source.guided30') }}
        </span>
      </div>

      <div class="field">
        <label class="label" :for="rateId">{{ $t('reading.rateLabel') }}</label>
        <div class="rate-row">
          <input
            :id="rateId"
            class="rate-input"
            type="number"
            v-model.number="editRate"
            required
            min="1"
            max="200"
            :aria-describedby="rateValid ? rateStatusId : undefined"
          />
          <span v-if="rateValid" :id="rateStatusId" class="rate-badge" :class="getRateStatus(editRate, pet).cssClass">
            {{ $t('status.' + getRateStatus(editRate, pet).cssClass) }}
          </span>
        </div>
      </div>

      <div class="field">
        <RestStateToggle v-model="editRestState" layout="stacked" />
      </div>

      <div class="field">
        <span :id="notesLabelId" class="label">{{ $t('reading.notesLabel') }}</span>
        <RichTextEditor v-model="editNotes" :labelledby="notesLabelId" />
      </div>

      <p v-if="saveError" class="save-error" role="alert">{{ $t('common.saveError') }}</p>

      <button type="submit" class="submit-btn" :disabled="saving || !rateValid">
        {{ saving ? $t('common.saving') : $t('common.saveChanges') }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.save-error {
  margin: 0;
  font-size: 13px;
  color: var(--color-danger-text);
  background: var(--color-danger-bg);
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  text-align: center;
}

.load-error {
  margin: 16px;
}

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

.reading-meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: -8px;
  flex-wrap: wrap;
}

.reading-date {
  font-size: 13px;
  color: var(--color-text-muted);
}

.source-chip {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.source-chip.manual {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
}

.source-chip.guided {
  background: var(--color-primary-light);
  color: var(--color-primary);
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
  color: var(--color-danger-text);
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
