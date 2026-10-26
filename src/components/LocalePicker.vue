<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { GB, NL, DE, FR, JP } from 'country-flag-icons/string/3x2';
import { SUPPORTED_LOCALES, LOCALE_NAMES, setLocale, type Locale } from '../i18n';

const { locale } = useI18n();
const open = ref(false);

// Named imports keep the bundle to just these flags; a namespace import with a
// dynamic lookup would pull in all ~265. Record<Locale, ...> makes the build
// fail if a locale is added to SUPPORTED_LOCALES without a flag.
const FLAGS: Record<Locale, string> = {
  en: GB,
  nl: NL,
  de: DE,
  fr: FR,
  ja: JP,
};

const listId = useId();
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);

// A disclosure, not a menu: Tab moves through the options, Escape closes
function toggle() {
  open.value = !open.value;
  if (open.value) {
    nextTick(() => rootRef.value?.querySelector<HTMLElement>('.lang-option.active')?.focus());
  }
}

function close() {
  open.value = false;
  triggerRef.value?.focus();
}

function onEscape(e: KeyboardEvent) {
  if (!open.value) return;
  e.stopPropagation();
  close();
}

// Tabbing out closes the list. A null relatedTarget (a click on something unfocusable;
// Safari never focuses clicked buttons) is left to the backdrop and the options.
function onFocusout(e: FocusEvent) {
  const next = e.relatedTarget as Node | null;
  if (open.value && next && !rootRef.value?.contains(next)) open.value = false;
}

function pick(loc: Locale) {
  setLocale(loc);
  close();
}
</script>

<template>
  <div ref="rootRef" class="lang-picker" @keydown.esc="onEscape" @focusout="onFocusout">
    <button
      ref="triggerRef"
      class="lang-trigger"
      :aria-label="$t('home.switchLanguage')"
      :aria-expanded="open"
      :aria-controls="open ? listId : undefined"
      @click="toggle"
    >
      <span class="lang-trigger-spacer" />
      <span class="lang-flag" aria-hidden="true" v-html="FLAGS[locale as Locale]" />
      <svg class="lang-chevron" :class="{ open }" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <path d="M7 10l5 5 5-5z"/>
      </svg>
    </button>
    <div v-if="open" :id="listId" class="lang-dropdown">
      <button
        v-for="loc in SUPPORTED_LOCALES"
        :key="loc"
        class="lang-option"
        :class="{ active: locale === loc }"
        :title="LOCALE_NAMES[loc]"
        :aria-current="locale === loc ? 'true' : undefined"
        @click="pick(loc)"
      >
        <span aria-hidden="true" v-html="FLAGS[loc]" />
        <span class="sr-only" :lang="loc">{{ LOCALE_NAMES[loc] }}</span>
      </button>
    </div>
    <div v-if="open" class="lang-backdrop" @click="close" />
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
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
}

.lang-option:hover {
  background: var(--color-bg);
}

.lang-option.active {
  background: var(--color-primary-light);
}

/* When the header is narrow enough that the two controls wrap to separate
   rows, match the ThemeToggle width. The threshold is the minimum header
   width at which both controls can sit side by side:
   padding(48) + gap(12) + title-min(~130) + controls(148) ≈ 338px.
   Firefox rounds container widths 7px more conservatively, so it needs 331px. */
@supports (-moz-appearance: none) {
  @container app-header (max-width: 331px) {
    .lang-trigger {
      width: 80px;
    }
  }
}
@supports not (-moz-appearance: none) {
  @container app-header (max-width: 338px) {
    .lang-trigger {
      width: 80px;
    }
  }
}
</style>
