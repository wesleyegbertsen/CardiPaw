<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePetsStore } from '../stores/pets';
import PetPhotoUpload from '../components/PetPhotoUpload.vue';
import type { Species } from '../types';
import { DEFAULT_NORMAL_CEILING, DEFAULT_ELEVATED_CEILING } from '../utils/rateStatus';

const route = useRoute();
const router = useRouter();
const petsStore = usePetsStore();

const isEdit = !!route.params.id;
const petId = route.params.id as string;

const name = ref('');
const species = ref<Species>('cat');
const birthdate = ref('');
const photo = ref<string | null>(null);
const normalCeiling = ref<number | ''>('');
const elevatedCeiling = ref<number | ''>('');
const saving = ref(false);
const thresholdError = computed(() => {
  const effectiveNormal   = typeof normalCeiling.value   === 'number' ? normalCeiling.value   : DEFAULT_NORMAL_CEILING;
  const effectiveElevated = typeof elevatedCeiling.value === 'number' ? elevatedCeiling.value : DEFAULT_ELEVATED_CEILING;
  return effectiveElevated <= effectiveNormal
    ? `Elevated ceiling must be higher than normal ceiling (${effectiveNormal}).`
    : '';
});

onMounted(async () => {
  if (isEdit) {
    await petsStore.loadPets();
    const pet = petsStore.getPetById(petId);
    if (pet) {
      name.value = pet.name;
      species.value = pet.species;
      birthdate.value = pet.birthdate;
      photo.value = pet.photo;
      normalCeiling.value = pet.normalCeiling ?? '';
      elevatedCeiling.value = pet.elevatedCeiling ?? '';
    }
  }
});

async function submit() {
  if (!name.value.trim() || !birthdate.value || thresholdError.value) return;
  saving.value = true;
  try {
    if (isEdit) {
      await petsStore.updatePet(petId, {
        name: name.value.trim(),
        species: species.value,
        birthdate: birthdate.value,
        photo: photo.value,
        normalCeiling:   typeof normalCeiling.value   === 'number' ? normalCeiling.value   : undefined,
        elevatedCeiling: typeof elevatedCeiling.value === 'number' ? elevatedCeiling.value : undefined,
      });
      router.push({ name: 'pet', params: { id: petId } });
    } else {
      const pet = await petsStore.addPet({
        name: name.value.trim(),
        species: species.value,
        birthdate: birthdate.value,
        photo: photo.value,
        normalCeiling:   typeof normalCeiling.value   === 'number' ? normalCeiling.value   : undefined,
        elevatedCeiling: typeof elevatedCeiling.value === 'number' ? elevatedCeiling.value : undefined,
      });
      router.push({ name: 'pet', params: { id: pet.id } });
    }
  } finally {
    saving.value = false;
  }
}


function goBack() {
  if (isEdit) {
    router.push({ name: 'pet', params: { id: petId } });
  } else {
    router.push({ name: 'home' });
  }
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button class="back-btn" @click="goBack" aria-label="Go back">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>
      <h1 class="page-title">{{ isEdit ? 'Edit pet' : 'Add pet' }}</h1>
      <div class="header-spacer"></div>
    </header>

    <form class="form" novalidate @submit.prevent="submit">
      <div class="photo-row">
        <PetPhotoUpload v-model="photo" />
      </div>

      <div class="field">
        <label class="label" for="pet-name">Name</label>
        <input
          id="pet-name"
          v-model="name"
          class="input"
          type="text"
          placeholder="e.g. Luna"
          maxlength="50"
          required
        />
      </div>

      <div class="field">
        <label class="label">Species</label>
        <div class="species-radios">
          <label class="species-option" :class="{ selected: species === 'cat' }">
            <input type="radio" v-model="species" value="cat" class="sr-only" />
            <span class="species-icon">🐱</span>
            <span>Cat</span>
          </label>
          <label class="species-option" :class="{ selected: species === 'dog' }">
            <input type="radio" v-model="species" value="dog" class="sr-only" />
            <span class="species-icon">🐶</span>
            <span>Dog</span>
          </label>
        </div>
      </div>

      <div class="field">
        <label class="label" for="pet-birthdate">Birthdate</label>
        <input
          id="pet-birthdate"
          v-model="birthdate"
          class="input"
          type="date"
          :max="new Date().toISOString().slice(0, 10)"
          required
        />
      </div>

      <div class="field">
        <label class="label"><abbr title="Resting respiratory rate">RRR</abbr> thresholds (optional)</label>
        <div class="threshold-inputs">
          <div class="threshold-input-group">
            <label class="threshold-sub-label" for="normal-ceiling">Normal ceiling</label>
            <input
              id="normal-ceiling"
              v-model.number="normalCeiling"
              class="input"
              type="number"
              min="1"
              max="199"
              :placeholder="String(DEFAULT_NORMAL_CEILING)"
            />
          </div>
          <div class="threshold-input-group" :data-error="thresholdError || undefined">
            <label class="threshold-sub-label" for="elevated-ceiling">Elevated ceiling</label>
            <input
              id="elevated-ceiling"
              v-model.number="elevatedCeiling"
              class="input"
              type="number"
              :min="typeof normalCeiling === 'number' ? normalCeiling + 1 : DEFAULT_NORMAL_CEILING + 1"
              max="200"
              :placeholder="String(DEFAULT_ELEVATED_CEILING)"
            />
          </div>
        </div>
        <p class="threshold-hint">Leave blank to use the defaults ({{ DEFAULT_NORMAL_CEILING }} / {{ DEFAULT_ELEVATED_CEILING }} breaths/min).</p>
      </div>

      <button
        type="submit"
        class="submit-btn"
        :disabled="saving || !name.trim() || !birthdate || !!thresholdError"
      >
        {{ saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add pet') }}
      </button>
    </form>
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

.header-spacer {
  width: 32px;
}

.back-btn {
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  padding: 4px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
}

.form {
  padding: 24px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.photo-row {
  display: flex;
  justify-content: center;
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

.input {
  height: 48px;
  padding: 0 16px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 16px;
  background: var(--color-surface);
  color: var(--color-text);
  transition: border-color 0.15s;
}

.input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.species-radios {
  display: flex;
  gap: 12px;
}

.species-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 8px;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
  transition: border-color 0.15s, color 0.15s, background 0.15s;
  background: var(--color-surface);
}

.species-option.selected {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.species-icon {
  font-size: 28px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.submit-btn {
  margin-top: 8px;
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

.threshold-inputs {
  display: flex;
  gap: 12px;
}

.threshold-input-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.threshold-input-group[data-error] .input {
  border-color: var(--color-danger);
  border-width: 2px;
  padding-right: 36px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23dc2626'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 18px;
}

.threshold-input-group[data-error]::after {
  content: attr(data-error);
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  background: var(--color-danger);
  color: #fff;
  font-size: 11px;
  line-height: 1.4;
  padding: 5px 9px;
  border-radius: var(--radius-sm);
  max-width: min(360px, 90vw);
  pointer-events: none;
  display: none;
  z-index: 10;
}

.threshold-input-group[data-error]:hover::after,
.threshold-input-group[data-error]:focus-within::after {
  display: block;
}

.threshold-sub-label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.threshold-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

abbr[title] {
  text-decoration: underline dotted;
  cursor: help;
}
</style>
