<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { WEEK_START, type Locale } from '../i18n';

const props = defineProps<{
  modelValue: string;
  max?: string;
  id?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const { t, locale } = useI18n();

const open = ref(false);
const view = ref<'days' | 'months' | 'years'>('days');
const viewYear = ref(new Date().getFullYear());
const viewMonth = ref(new Date().getMonth());
const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLDivElement | null>(null);

const YEARS_PER_PAGE = 12;

// Parse a YYYY-MM-DD string as a local-time date; toISOString() would shift
// the day across the UTC boundary in some timezones.
function parseISO(value: string | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toISO(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const selected = computed(() => parseISO(props.modelValue));
const maxDate = computed(() => parseISO(props.max));

const displayText = computed(() =>
  selected.value
    ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(selected.value)
    : ''
);

const weekStart = computed(() => WEEK_START[locale.value as Locale] ?? 1);

// 2021-08-01 is a Sunday, used as a reference week for weekday names.
const weekdayNames = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' });
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(2021, 7, 1 + ((weekStart.value + i) % 7)))
  );
});

const monthNames = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { month: 'short' });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2021, i, 1)));
});

const headerTitle = computed(() => {
  if (view.value === 'days') {
    return new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' })
      .format(new Date(viewYear.value, viewMonth.value, 1));
  }
  if (view.value === 'months') {
    return new Intl.DateTimeFormat(locale.value, { year: 'numeric' })
      .format(new Date(viewYear.value, 0, 1));
  }
  return `${yearPageStart.value} – ${yearPageStart.value + YEARS_PER_PAGE - 1}`;
});

const yearPageStart = computed(() => viewYear.value - (viewYear.value % YEARS_PER_PAGE));
const yearPage = computed(() =>
  Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPageStart.value + i)
);

interface DayCell {
  day: number;
  disabled: boolean;
  isToday: boolean;
  isSelected: boolean;
}

const leadingBlanks = computed(() => {
  const firstWeekday = new Date(viewYear.value, viewMonth.value, 1).getDay();
  return (firstWeekday - weekStart.value + 7) % 7;
});

const dayCells = computed<DayCell[]>(() => {
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate();
  const today = new Date();
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const date = new Date(viewYear.value, viewMonth.value, day);
    return {
      day,
      disabled: maxDate.value !== null && date > maxDate.value,
      isToday:
        day === today.getDate() &&
        viewMonth.value === today.getMonth() &&
        viewYear.value === today.getFullYear(),
      isSelected:
        selected.value !== null &&
        day === selected.value.getDate() &&
        viewMonth.value === selected.value.getMonth() &&
        viewYear.value === selected.value.getFullYear(),
    };
  });
});

function isMonthDisabled(month: number): boolean {
  return maxDate.value !== null && new Date(viewYear.value, month, 1) > maxDate.value;
}

function isYearDisabled(year: number): boolean {
  return maxDate.value !== null && year > maxDate.value.getFullYear();
}

const prevLabel = computed(() =>
  view.value === 'days' ? t('datePicker.prevMonth')
  : view.value === 'months' ? t('datePicker.prevYear')
  : t('datePicker.prevYears')
);

const nextLabel = computed(() =>
  view.value === 'days' ? t('datePicker.nextMonth')
  : view.value === 'months' ? t('datePicker.nextYear')
  : t('datePicker.nextYears')
);

const nextDisabled = computed(() => {
  if (!maxDate.value) return false;
  if (view.value === 'days') return new Date(viewYear.value, viewMonth.value + 1, 1) > maxDate.value;
  if (view.value === 'months') return viewYear.value + 1 > maxDate.value.getFullYear();
  return yearPageStart.value + YEARS_PER_PAGE > maxDate.value.getFullYear();
});

function openPicker() {
  const base = selected.value ?? new Date();
  viewYear.value = base.getFullYear();
  viewMonth.value = base.getMonth();
  view.value = 'days';
  open.value = true;
}

function close() {
  open.value = false;
  triggerRef.value?.focus();
}

watch(open, async (isOpen) => {
  if (isOpen) {
    await nextTick();
    panelRef.value?.focus();
  }
});

function goPrev() {
  if (view.value === 'days') {
    if (viewMonth.value === 0) {
      viewMonth.value = 11;
      viewYear.value--;
    } else {
      viewMonth.value--;
    }
  } else if (view.value === 'months') {
    viewYear.value--;
  } else {
    viewYear.value -= YEARS_PER_PAGE;
  }
}

function goNext() {
  if (view.value === 'days') {
    if (viewMonth.value === 11) {
      viewMonth.value = 0;
      viewYear.value++;
    } else {
      viewMonth.value++;
    }
  } else if (view.value === 'months') {
    viewYear.value++;
  } else {
    viewYear.value += YEARS_PER_PAGE;
  }
}

function onTitleClick() {
  view.value = view.value === 'days' ? 'months' : 'years';
}

function selectDay(day: number) {
  emit('update:modelValue', toISO(viewYear.value, viewMonth.value, day));
  close();
}

function selectMonth(month: number) {
  viewMonth.value = month;
  view.value = 'days';
}

function selectYear(year: number) {
  viewYear.value = year;
  // Selecting a year could leave a disabled month in view; clamp to the max.
  if (maxDate.value && year === maxDate.value.getFullYear() && viewMonth.value > maxDate.value.getMonth()) {
    viewMonth.value = maxDate.value.getMonth();
  }
  view.value = 'months';
}

function dayAriaLabel(day: number): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'full' })
    .format(new Date(viewYear.value, viewMonth.value, day));
}
</script>

<template>
  <button
    :id="id"
    ref="triggerRef"
    type="button"
    class="trigger"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="openPicker"
  >
    <span :class="{ 'trigger-placeholder': !selected }">
      {{ displayText || t('datePicker.placeholder') }}
    </span>
    <svg class="trigger-icon" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
      <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z"/>
    </svg>
  </button>

  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="close">
      <div
        ref="panelRef"
        class="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="t('datePicker.placeholder')"
        tabindex="-1"
        @keydown.esc="close"
      >
        <div class="nav">
          <button type="button" class="nav-btn" :aria-label="prevLabel" @click="goPrev">
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22" aria-hidden="true">
              <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
            </svg>
          </button>
          <button
            type="button"
            class="title-btn"
            :disabled="view === 'years'"
            :aria-label="view === 'days' ? t('datePicker.selectMonth') : t('datePicker.selectYear')"
            @click="onTitleClick"
          >
            {{ headerTitle }}
          </button>
          <button type="button" class="nav-btn" :aria-label="nextLabel" :disabled="nextDisabled" @click="goNext">
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22" aria-hidden="true">
              <path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z"/>
            </svg>
          </button>
        </div>

        <template v-if="view === 'days'">
          <div class="weekdays" aria-hidden="true">
            <span v-for="(name, i) in weekdayNames" :key="i" class="weekday">{{ name }}</span>
          </div>
          <div class="day-grid">
            <span v-for="i in leadingBlanks" :key="`blank-${i}`"></span>
            <button
              v-for="cell in dayCells"
              :key="cell.day"
              type="button"
              class="day-btn"
              :class="{ selected: cell.isSelected, today: cell.isToday }"
              :disabled="cell.disabled"
              :aria-label="dayAriaLabel(cell.day)"
              @click="selectDay(cell.day)"
            >
              {{ cell.day }}
            </button>
          </div>
        </template>

        <div v-else-if="view === 'months'" class="option-grid">
          <button
            v-for="(name, i) in monthNames"
            :key="i"
            type="button"
            class="option-btn"
            :class="{ selected: selected && i === selected.getMonth() && viewYear === selected.getFullYear() }"
            :disabled="isMonthDisabled(i)"
            @click="selectMonth(i)"
          >
            {{ name }}
          </button>
        </div>

        <div v-else class="option-grid">
          <button
            v-for="year in yearPage"
            :key="year"
            type="button"
            class="option-btn"
            :class="{ selected: selected && year === selected.getFullYear() }"
            :disabled="isYearDisabled(year)"
            @click="selectYear(year)"
          >
            {{ year }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.trigger {
  height: 48px;
  padding: 0 16px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 16px;
  background: var(--color-surface);
  color: var(--color-text);
  transition: border-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  width: 100%;
}

.trigger:focus-visible {
  outline: none;
  border-color: var(--color-primary);
}

.trigger-placeholder {
  color: var(--color-text-muted);
}

.trigger-icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
  padding: 24px;
}

.panel {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: 16px;
  width: 100%;
  max-width: 340px;
  box-shadow: var(--shadow-lg);
  outline: none;
}

.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
}

.nav-btn:hover:not(:disabled) {
  background: var(--color-bg);
  color: var(--color-text);
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.title-btn {
  flex: 1;
  height: 40px;
  border-radius: var(--radius-sm);
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.title-btn:hover:not(:disabled) {
  background: var(--color-bg);
}

.title-btn:disabled {
  cursor: default;
}

.weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 4px;
}

.weekday {
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  padding: 4px 0;
}

.day-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.day-btn {
  aspect-ratio: 1;
  min-height: 38px;
  border-radius: var(--radius-full);
  font-size: 14px;
  color: var(--color-text);
  display: flex;
  align-items: center;
  justify-content: center;
}

.day-btn:hover:not(:disabled):not(.selected) {
  background: var(--color-bg);
}

.day-btn.today {
  box-shadow: inset 0 0 0 1.5px var(--color-primary);
}

.day-btn.selected {
  background: var(--color-primary);
  color: #fff;
  font-weight: 600;
}

.day-btn:disabled {
  color: var(--color-text-muted);
  opacity: 0.35;
  cursor: default;
}

.option-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.option-btn {
  height: 48px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--color-text);
}

.option-btn:hover:not(:disabled):not(.selected) {
  background: var(--color-bg);
}

.option-btn.selected {
  background: var(--color-primary);
  color: #fff;
  font-weight: 600;
}

.option-btn:disabled {
  color: var(--color-text-muted);
  opacity: 0.35;
  cursor: default;
}
</style>
