<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePetsStore } from '../stores/pets';
import PetPhotoUpload from '../components/PetPhotoUpload.vue';
import type { Species } from '../types';

const route = useRoute();
const router = useRouter();
const petsStore = usePetsStore();

const isEdit = !!route.params.id;
const petId = route.params.id as string;

const name = ref('');
const species = ref<Species>('cat');
const birthdate = ref('');
const photo = ref<string | null>(null);
const saving = ref(false);

onMounted(() => {
  if (isEdit) {
    const pet = petsStore.getPetById(petId);
    if (pet) {
      name.value = pet.name;
      species.value = pet.species;
      birthdate.value = pet.birthdate;
      photo.value = pet.photo;
    }
  }
});

async function submit() {
  if (!name.value.trim() || !birthdate.value) return;
  saving.value = true;
  try {
    if (isEdit) {
      await petsStore.updatePet(petId, {
        name: name.value.trim(),
        species: species.value,
        birthdate: birthdate.value,
        photo: photo.value,
      });
      router.push({ name: 'pet', params: { id: petId } });
    } else {
      const pet = await petsStore.addPet({
        name: name.value.trim(),
        species: species.value,
        birthdate: birthdate.value,
        photo: photo.value,
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
    </header>

    <form class="form" @submit.prevent="submit">
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

      <button
        type="submit"
        class="submit-btn"
        :disabled="saving || !name.trim() || !birthdate"
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
  gap: 12px;
  padding: 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 10;
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
</style>
