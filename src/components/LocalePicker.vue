<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import * as FlagSVGs from 'country-flag-icons/string/3x2';
import { SUPPORTED_LOCALES, setLocale, type Locale } from '../i18n';

const { locale } = useI18n();
const open = ref(false);

const LOCALE_COUNTRY: Record<Locale, keyof typeof FlagSVGs> = {
  en: 'GB',
  nl: 'NL',
  de: 'DE',
};

function flagSvg(loc: Locale): string {
  return FlagSVGs[LOCALE_COUNTRY[loc]] as string;
}

function pick(loc: Locale) {
  setLocale(loc);
  open.value = false;
}
</script>

<template>
  <div class="lang-picker">
    <button class="lang-trigger" @click="open = !open" :aria-label="$t('home.switchLanguage')">
      <span class="lang-trigger-spacer" />
      <span class="lang-flag" v-html="flagSvg(locale as Locale)" />
      <svg class="lang-chevron" :class="{ open }" viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <path d="M7 10l5 5 5-5z"/>
      </svg>
    </button>
    <div v-if="open" class="lang-dropdown">
      <button
        v-for="loc in SUPPORTED_LOCALES"
        :key="loc"
        class="lang-option"
        :class="{ active: locale === loc }"
        @click="pick(loc)"
      >
        <span v-html="flagSvg(loc)" />
      </button>
    </div>
    <div v-if="open" class="lang-backdrop" @click="open = false" />
  </div>
</template>

<style scoped>
.lang-picker {
  position: relative;
}

.lang-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.2);
  border: 1.5px solid rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: background 0.25s, border-color 0.25s;
  flex-shrink: 0;
}

.lang-trigger:hover {
  background: rgba(255, 255, 255, 0.28);
  border-color: rgba(255, 255, 255, 0.75);
}

.lang-trigger-spacer {
  width: 4px;
  flex-shrink: 0;
}

.lang-flag :deep(svg) {
  display: block;
  width: 22px;
  height: auto;
  border-radius: 2px;
}

.lang-chevron {
  color: rgba(255, 255, 255, 0.85);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.lang-chevron.open {
  transform: rotate(180deg);
}

.lang-backdrop {
  position: fixed;
  inset: 0;
  z-index: 49;
}

.lang-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 50;
}

.lang-option {
  padding: 7px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s;
}

.lang-option :deep(svg) {
  display: block;
  width: 22px;
  height: auto;
  border-radius: 2px;
}

.lang-option:hover {
  background: var(--color-bg);
}

.lang-option.active {
  background: var(--color-primary-light);
}
</style>
