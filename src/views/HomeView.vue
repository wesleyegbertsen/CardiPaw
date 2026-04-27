<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { usePetsStore } from '../stores/pets';
import { useThemeStore } from '../stores/theme';
import PetCard from '../components/PetCard.vue';

const petsStore = usePetsStore();
const router = useRouter();
const themeStore = useThemeStore();
const hasToggledTheme = ref(false);

function toggleTheme() {
  hasToggledTheme.value = true;
  themeStore.toggle();
}
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
      <button
        class="theme-toggle"
        :class="{ 'is-light': !themeStore.isDark, 'has-toggled': hasToggledTheme }"
        @click="toggleTheme"
        :aria-label="themeStore.isDark ? 'Switch to light mode' : 'Switch to dark mode'"
      >
        <span class="theme-toggle-thumb">
          <svg v-if="themeStore.isDark" viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
            <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 1 0 9.79 9.79z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        </span>
        <span class="theme-toggle-label">{{ themeStore.isDark ? 'Dark' : 'Light' }}</span>
      </button>
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
  padding: 24px;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
  color: #fff;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  column-gap: 12px;
  row-gap: 4px;
}

.title {
  grid-column: 1;
  grid-row: 1;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.5px;
  line-height: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.theme-toggle {
  grid-column: 2;
  grid-row: 1 / 3;
  align-self: center;
  position: relative;
  width: 72px;
  height: 28px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.2);
  border: 1.5px solid rgba(255, 255, 255, 0.5);
  transition: background 0.25s, border-color 0.25s;
  flex-shrink: 0;
}

.theme-toggle:hover {
  background: rgba(255, 255, 255, 0.28);
  border-color: rgba(255, 255, 255, 0.75);
}

.theme-toggle-thumb {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  color: var(--color-primary-dark);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.theme-toggle-thumb svg {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.theme-toggle.is-light .theme-toggle-thumb {
  transform: translateX(44px);
}

.theme-toggle-label {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.3px;
  pointer-events: none;
}

.theme-toggle.is-light .theme-toggle-label {
  right: auto;
  left: 10px;
}

.theme-toggle.has-toggled:not(.is-light) .theme-toggle-label {
  animation: label-appear-dark 0.35s ease-out;
}

.theme-toggle.has-toggled.is-light .theme-toggle-label {
  animation: label-appear-light 0.35s ease-out;
}

@keyframes label-appear-dark {
  0%, 70% { opacity: 0; }
  100% { opacity: 1; }
}

@keyframes label-appear-light {
  0%, 70% { opacity: 0; }
  100% { opacity: 1; }
}

.paw-icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  opacity: 0.9;
  margin-top: 2px;
}

.subtitle {
  grid-column: 1;
  grid-row: 2;
  font-size: 14px;
  opacity: 0.85;
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
