<script setup lang="ts">
import { useRouter } from 'vue-router';
import { usePetsStore } from '../stores/pets';
import PetCard from '../components/PetCard.vue';

const petsStore = usePetsStore();
const router = useRouter();
</script>

<template>
  <div class="home">
    <header class="header">
      <h1 class="title">
        CardiPaw
        <svg class="paw-icon" viewBox="0 0 512 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M226.5 92.9c14.3 42.9-.3 86.2-32.6 96.8s-70.1-15.6-84.4-58.5 .3-86.2 32.6-96.8 70.1 15.6 84.4 58.5zm-133 106.8c18.9 32.4 14.3 70.1-10.2 84.1s-59.7-.9-78.5-33.3-14.3-70.1 10.2-84.1 59.7 .9 78.5 33.3zM256 224c-41.3 0-134.4 35.9-186.8 177.2-3.6 9.7-5.2 20.1-5.2 30.5v1.6C64 459.1 84.9 480 110.7 480c11.5 0 22.9-1.2 34-3.6 22.1-4.6 44.6-6.9 67.3-6.9s45.2 2.3 67.3 6.9c11.1 2.4 22.5 3.6 34 3.6 25.8 0 46.7-20.9 46.7-46.7v-1.6c0-10.4-1.6-20.8-5.2-30.5C402.4 259.9 309.3 224 256 224zm165.8 58.7c-24.5-14-29.1-51.7-10.2-84.1s54-47.3 78.5-33.3 29.1 51.7 10.2 84.1-54 47.3-78.5 33.3zM310.1 189.7c-32.3-10.6-46.9-53.9-32.6-96.8s52.1-69.1 84.4-58.5 46.9 53.9 32.6 96.8-52.1 69.1-84.4 58.5z"/>
        </svg>
      </h1>
      <p class="subtitle">Resting respiratory rate tracker</p>
    </header>

    <section class="content">
      <div v-if="petsStore.loading" class="loading">
        <div class="spinner"></div>
      </div>

      <template v-else-if="petsStore.pets.length > 0">
        <h2 class="section-title">Your pets</h2>
        <div class="pet-list">
          <PetCard v-for="pet in petsStore.pets" :key="pet.id" :pet="pet" />
        </div>
      </template>

      <div v-else class="empty-state">
        <div class="empty-icon">🐾</div>
        <h2>No pets yet</h2>
        <p>Add your first pet to start tracking their resting respiratory rate.</p>
      </div>
    </section>

    <button class="fab" @click="router.push({ name: 'pet-add' })" aria-label="Add pet">
      <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.home {
  min-height: 100%;
  position: relative;
}

.header {
  padding: 24px 24px 24px;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
  color: #fff;
}

.title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.paw-icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  opacity: 0.9;
  margin-top: 2px;
}

.subtitle {
  font-size: 14px;
  opacity: 0.85;
  margin-top: 4px;
}

.content {
  padding: 24px 16px 80px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--color-text-muted);
  margin-bottom: 12px;
}

.pet-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.loading {
  display: flex;
  justify-content: center;
  padding: 48px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  text-align: center;
  padding: 64px 24px;
  color: var(--color-text-muted);
}

.empty-icon {
  font-size: 56px;
  margin-bottom: 16px;
}

.empty-state h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 8px;
}

.empty-state p {
  font-size: 14px;
  line-height: 1.5;
  max-width: 260px;
  margin: 0 auto;
}

.fab {
  position: fixed;
  bottom: calc(var(--nav-height) + 20px);
  right: 20px;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-lg);
  transition: transform 0.15s, box-shadow 0.15s;
  z-index: 50;
}

.fab:active {
  transform: scale(0.94);
}
</style>
