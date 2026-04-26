<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView, RouterLink, useRoute } from 'vue-router';
import { usePetsStore } from './stores/pets';

const petsStore = usePetsStore();
const route = useRoute();

onMounted(() => {
  petsStore.loadPets();
});
</script>

<template>
  <div class="app-layout">
    <main class="app-main">
      <RouterView />
    </main>

    <nav class="bottom-nav">
      <RouterLink :to="{ name: 'home' }" class="nav-item" :class="{ active: route.name === 'home' }">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
        </svg>
        <span>Home</span>
      </RouterLink>

      <RouterLink :to="{ name: 'settings' }" class="nav-item" :class="{ active: route.name === 'settings' }">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a6.97 6.97 0 0 0-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.04.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/>
        </svg>
        <span>Settings</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.app-main {
  flex: 1;
  overflow-y: auto;
  padding-bottom: var(--nav-height);
}

.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--nav-height);
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-around;
  z-index: 100;
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.06);
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 24px;
  color: var(--color-text-muted);
  transition: color 0.15s;
  border-radius: var(--radius-md);
}

.nav-item.active {
  color: var(--color-primary);
}

.nav-item span {
  font-size: 11px;
  font-weight: 500;
}
</style>
