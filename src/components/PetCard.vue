<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { Pet } from '../types';
import { useAgeCalculator } from '../composables/useAgeCalculator';

const props = defineProps<{ pet: Pet }>();
const router = useRouter();

const birthdateRef = computed(() => props.pet.birthdate);
const ageDisplay = useAgeCalculator(birthdateRef);

function navigate() {
  router.push({ name: 'pet', params: { id: props.pet.id } });
}
</script>

<template>
  <button class="pet-card" @click="navigate" :aria-label="`View ${pet.name}'s profile`">
    <div class="photo-wrap">
      <img v-if="pet.photo" :src="pet.photo" :alt="pet.name" class="photo" />
      <div v-else class="photo-placeholder">
        <!-- Cat silhouette -->
        <svg v-if="pet.species === 'cat'" viewBox="0 0 64 64" fill="currentColor" width="40" height="40">
          <path d="M8 4l8 12c-4 2-6 6-6 10v8c0 6 4 10 10 10h24c6 0 10-4 10-10v-8c0-4-2-8-6-10l8-12-10 6c-2-2-6-4-14-4s-12 2-14 4L8 4zm10 22a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm18 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm-10 8c4 0 7-2 8-4H18c1 2 4 4 8 4z"/>
        </svg>
        <!-- Dog silhouette -->
        <svg v-else viewBox="0 0 64 64" fill="currentColor" width="40" height="40">
          <path d="M52 12l-4 8c2 2 4 6 4 10v8c0 6-4 10-10 10H22c-6 0-10-4-10-10v-8c0-4 2-8 4-10l-4-8 8 4c2-2 6-4 12-4s10 2 12 4l8-4zm-28 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm18 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm-9 10c-3 0-6-1-8-3h16c-2 2-5 3-8 3z"/>
        </svg>
      </div>
    </div>

    <div class="info">
      <h3 class="name">{{ pet.name }}</h3>
      <span class="badge" :class="pet.species">{{ pet.species }}</span>
      <p class="age">{{ ageDisplay }}</p>
    </div>

    <svg class="chevron" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <path d="M9.29 6.71a1 1 0 0 0 0 1.41L13.17 12l-3.88 3.88a1 1 0 1 0 1.41 1.41l4.59-4.59a1 1 0 0 0 0-1.41L10.7 6.7a1 1 0 0 0-1.41.01z"/>
    </svg>
  </button>
</template>

<style scoped>
.pet-card {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 16px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  text-align: left;
  transition: box-shadow 0.15s, transform 0.1s;
}

.pet-card:active {
  transform: scale(0.98);
}

.photo-wrap {
  flex-shrink: 0;
}

.photo {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  object-fit: cover;
}

.photo-placeholder {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  background: var(--color-primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
}

.info {
  flex: 1;
  min-width: 0;
}

.name {
  font-size: 17px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  margin: 4px 0;
}

.badge.cat {
  background: #fce7f3;
  color: #9d174d;
}

.badge.dog {
  background: #dbeafe;
  color: #1e40af;
}

.age {
  font-size: 13px;
  color: var(--color-text-muted);
}

.chevron {
  flex-shrink: 0;
  color: var(--color-border);
}
</style>
