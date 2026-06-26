<script setup lang="ts">
import { ref } from 'vue';
import { useThemeStore } from '../stores/theme';

const themeStore = useThemeStore();
const hasToggled = ref(false);

function toggle() {
  hasToggled.value = true;
  themeStore.toggle();
}
</script>

<template>
  <button
    class="theme-toggle"
    :class="{ 'is-light': !themeStore.isDark, 'has-toggled': hasToggled }"
    @click="toggle"
    :aria-label="themeStore.isDark ? $t('home.switchToLight') : $t('home.switchToDark')"
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
    <span class="theme-toggle-label">{{ themeStore.isDark ? $t('home.themeDark') : $t('home.themeLight') }}</span>
  </button>
</template>

<style scoped>
.theme-toggle {
  position: relative;
  width: 80px;
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
  transform: translateX(52px);
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
</style>
