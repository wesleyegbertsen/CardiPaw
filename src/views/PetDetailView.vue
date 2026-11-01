<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { App } from '@capacitor/app';
import { returnTo } from '../router/returnTo';
import { useI18n } from 'vue-i18n';
import type { Reading } from '../types';
import { localDayKey, localMonthKey } from '../utils/date';
import { petInitial } from '../utils/petInitial';
import { getChartWindow, weekOffsetOf, type ChartRange } from '../utils/chartWindow';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import { useAgeCalculator } from '../composables/useAgeCalculator';
import { useLastMeasured } from '../composables/useLastMeasured';
import { useTrend } from '../composables/useTrend';
import { useDismissable } from '../composables/useModal';
import RRRChart from '../components/RRRChart.vue';
import ReadingList from '../components/ReadingList.vue';
import NoteList from '../components/NoteList.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import PdfExportModal from '../components/PdfExportModal.vue';
import ShareLinkModal from '../components/ShareLinkModal.vue';
import InfoModal from '../components/InfoModal.vue';
import ReminderModal from '../components/ReminderModal.vue';
import { reminderPermission, type ReminderPermission } from '../native/reminders';
import { WEEK_START, type Locale } from '../i18n';
import { isNative } from '../utils/platform';
import { loadReminderSettings } from '../utils/reminderSettings';
import { formatDays, formatReminderTime } from '../utils/reminderFormat';
import { useNotesStore } from '../stores/notes';

const route = useRoute();
const router = useRouter();
const petsStore = usePetsStore();
const readingsStore = useReadingsStore();
const notesStore = useNotesStore();
const { locale, t } = useI18n();

const petId = route.params.id as string;
const pet = computed(() => petsStore.getPetById(petId));
const birthdateRef = computed(() => pet.value?.birthdate ?? '');
const ageDisplay = useAgeCalculator(birthdateRef);

const readings = computed(() => readingsStore.getReadingsForPet(petId));
const lastMeasured = useLastMeasured(readings);
const trend = useTrend(readings, pet);
const showTrendInfo = ref(false);
const notes = computed(() => notesStore.getNotesForPet(petId));
const showDeleteDialog = ref(false);
const showPdfModal = ref(false);
const showShareModal = ref(false);
// Reminders are local notifications, so they exist in the Android app only.
const native = isNative();
const showReminderModal = ref(false);
const reminder = ref(native ? loadReminderSettings()[petId] : undefined);
// Null until checked, or when the check failed: then the reminders aren't called paused.
const permission = ref<ReminderPermission | null>(null);
// On, but Android won't show them: notifications for CardiPaw were turned off.
const remindersPaused = computed(
  () => reminder.value?.enabled === true && permission.value !== null && permission.value !== 'granted',
);
const remindersOn = computed(() => reminder.value?.enabled === true && !remindersPaused.value);
const bellLabel = computed(() =>
  remindersPaused.value ? 'reminders.bellPaused' : remindersOn.value ? 'reminders.bellOn' : 'reminders.bellOff',
);
const reminderSummary = computed(() => {
  const setting = reminder.value;
  if (!setting?.enabled) return '';
  if (remindersPaused.value) return t('reminders.summaryBlocked');
  const time = formatReminderTime(setting.time, locale.value);
  if (setting.days.length === 7) return t('reminders.summaryDaily', { time });
  const days = formatDays(setting.days, locale.value, WEEK_START[locale.value as Locale] ?? 1);
  return t('reminders.summaryDays', { days, time });
});

function closeReminderModal() {
  showReminderModal.value = false;
  reminder.value = loadReminderSettings()[petId];
  // The dialog may have asked for the permission.
  void checkReminderPermission();
}

async function checkReminderPermission() {
  try {
    permission.value = await reminderPermission();
  } catch (e) {
    console.error('Checking the notification permission failed', e);
  }
}

if (native) {
  onMounted(checkReminderPermission);
  // Back from Android's settings, where notifications may have been turned on or off.
  const resume = App.addListener('resume', () => void checkReminderPermission());
  onUnmounted(() => void resume.then((handle) => handle.remove()));
}

const TABS = ['chart', 'readings', 'notes'] as const;
type Tab = typeof TABS[number];

const activeTab = computed({
  get: (): Tab => TABS.find((t) => t === route.query.tab) ?? 'chart',
  set: (val: Tab) => {
    router.replace({ query: { ...route.query, tab: val } });
  },
});
const activeTabIndex = computed(() => TABS.indexOf(activeTab.value));

const tabsId = useId();
const tabId = (tab: Tab) => `${tabsId}-tab-${tab}`;
const panelId = (tab: Tab) => `${tabsId}-panel-${tab}`;
// Panels are named by the tab text without its count
const tabLabelId = (tab: Tab) => `${tabId(tab)}-label`;
const titleId = `${tabsId}-title`;
const tablistRef = ref<HTMLElement | null>(null);

// WAI-ARIA tabs with automatic activation: arrows wrap, Home/End jump to the ends
function onTabKeydown(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const tabEls = [...(tablistRef.value?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
  const i = tabEls.indexOf(e.target as HTMLElement);
  if (i < 0) return;
  const n = TABS.length;
  const keys: Record<string, number> = {
    ArrowRight: (i + 1) % n,
    ArrowLeft: (i - 1 + n) % n,
    Home: 0,
    End: n - 1,
  };
  const next = keys[e.key];
  if (next === undefined) return;
  e.preventDefault();
  tabEls[next].focus();
  activeTab.value = TABS[next];
}

// Index the swipe track is positioned at. Updated immediately on swipe commit so the
// slide animation doesn't wait for router.replace to resolve; otherwise mirrors activeTab.
const trackIndex = ref(activeTabIndex.value);

const tabViewportRef = ref<HTMLElement | null>(null);
const dragOffset = ref(0);
const viewportWidth = ref(0);
const isDragging = ref(false);
// Keeps off-screen panels expanded until the slide transition ends, so they don't vanish mid-slide
const isAnimating = ref(false);
const dragProgress = computed(() => (viewportWidth.value ? dragOffset.value / viewportWidth.value : 0));

// Any tab change closes the jump picker; changes by tap or URL also slide the track
watch(activeTabIndex, (i) => {
  showJumpPicker.value = false;
  if (i === trackIndex.value) return;
  trackIndex.value = i;
  isAnimating.value = true;
});

function isPanelCollapsed(i: number) {
  return i !== trackIndex.value && !isDragging.value && !isAnimating.value;
}

const SWIPE_LOCK_THRESHOLD = 10; // px
const SWIPE_COMMIT_RATIO = 0.25;
const SWIPE_FLICK_VELOCITY = 0.3; // px/ms
const SWIPE_EDGE_RESISTANCE = 0.3;
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let swipeAxis: 'x' | 'y' | 'ignore' | null = null;

function onTabTouchStart(e: TouchEvent) {
  if (e.touches.length > 1) {
    // A second finger cancels any swipe in progress
    endDrag();
    swipeAxis = 'ignore';
    return;
  }
  swipeAxis = showJumpPicker.value ? 'ignore' : null;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchStartTime = e.timeStamp;
  viewportWidth.value = tabViewportRef.value?.clientWidth ?? 0;
}

function onTabTouchMove(e: TouchEvent) {
  if (swipeAxis === 'ignore' || swipeAxis === 'y') return;
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  if (swipeAxis === null) {
    if (Math.abs(dx) < SWIPE_LOCK_THRESHOLD && Math.abs(dy) < SWIPE_LOCK_THRESHOLD) return;
    swipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (swipeAxis === 'y') return;
    isDragging.value = true;
  }
  const pastEdge = (dx > 0 && trackIndex.value === 0) || (dx < 0 && trackIndex.value === TABS.length - 1);
  dragOffset.value = pastEdge ? dx * SWIPE_EDGE_RESISTANCE : dx;
}

function onTabTouchEnd(e: TouchEvent) {
  if (!isDragging.value) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const velocity = Math.abs(dx) / Math.max(e.timeStamp - touchStartTime, 1);
  const target = trackIndex.value + (dx < 0 ? 1 : -1);
  const committed =
    (Math.abs(dx) > viewportWidth.value * SWIPE_COMMIT_RATIO || velocity > SWIPE_FLICK_VELOCITY) &&
    target >= 0 && target < TABS.length;
  if (committed) {
    endDrag(target);
    activeTab.value = TABS[target];
  } else {
    endDrag();
  }
}

function endDrag(targetIndex = trackIndex.value) {
  if (!isDragging.value) return;
  isDragging.value = false;
  // Only wait for transitionend if the track will actually move; otherwise it never fires
  isAnimating.value = dragOffset.value !== 0 || targetIndex !== trackIndex.value;
  dragOffset.value = 0;
  trackIndex.value = targetIndex;
}

const chartRange = ref<ChartRange>('week');
const chartOffset = ref(0);
const showJumpPicker = ref(false);
const pickerYear = ref(new Date().getFullYear());
const jumpPickerRef = ref<HTMLElement | null>(null);
const rangeLabelBtnRef = ref<HTMLButtonElement | null>(null);
const rangeLabelWrapRef = ref<HTMLElement | null>(null);
const jumpPickerId = useId();


watch(chartRange, () => {
  chartOffset.value = 0;
  showJumpPicker.value = false;
});

function fmt(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale.value, options).format(date);
}

function fmtWeekRange(start: Date, end: Date): string {
  const currentYear = new Date().getFullYear();
  const spansTwoYears = start.getFullYear() !== end.getFullYear();
  const isCurrentYear = end.getFullYear() === currentYear;

  if (spansTwoYears) {
    return `${fmt(start, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  if (!isCurrentYear) {
    return `${fmt(start, { month: 'short', day: 'numeric' })} – ${fmt(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return `${fmt(start, { month: 'short', day: 'numeric' })} – ${fmt(end, { month: 'short', day: 'numeric' })}`;
}

const chartWindow = computed(() => getChartWindow(chartRange.value, chartOffset.value));

const chartReadings = computed(() => {
  const filtered = readings.value.filter((r) => {
    const d = new Date(r.date);
    return d >= chartWindow.value.start && d <= chartWindow.value.end;
  });

  if (chartRange.value === 'week') return filtered;

  const keyFn = chartRange.value === 'month'
    ? (r: Reading) => localDayKey(r.date)
    : (r: Reading) => localMonthKey(r.date);

  const groups = new Map<string, number[]>();
  for (const r of filtered) {
    const key = keyFn(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r.rate);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rates]) => ({
      id: key,
      petId,
      date: chartRange.value === 'month' ? `${key}T12:00:00` : `${key}-15T12:00:00`,
      rate: Math.round(rates.reduce((s, r) => s + r, 0) / rates.length),
      clickCount: 0,
    }));
});

const chartLabel = computed(() => {
  const { start, end } = chartWindow.value;
  if (chartRange.value === 'week')
    return fmtWeekRange(start, end);
  if (chartRange.value === 'month')
    return fmt(start, { month: 'long', year: 'numeric' });
  return fmt(start, { year: 'numeric' });
});

const canGoNext = computed(() => chartOffset.value < 0);

const oldestReadingDate = computed(() => {
  if (readings.value.length === 0) return null;
  return readings.value.reduce((min, r) => r.date < min ? r.date : min, readings.value[0].date);
});

const canGoPrev = computed(() => {
  if (!oldestReadingDate.value) return false;
  return new Date(oldestReadingDate.value) < chartWindow.value.start;
});

const monthsWithReadings = computed(() => {
  const set = new Set<string>();
  for (const r of readings.value) set.add(localMonthKey(r.date));
  return set;
});

const availableYears = computed(() => {
  const cur = new Date().getFullYear();
  const oldest = oldestReadingDate.value
    ? new Date(oldestReadingDate.value).getFullYear()
    : cur;
  const years: number[] = [];
  for (let y = cur; y >= oldest; y--) years.push(y);
  return years;
});

const weeksWithReadings = computed(() => {
  const now = new Date();
  const offsets = new Set<number>();
  for (const r of readings.value) {
    offsets.add(weekOffsetOf(new Date(r.date), now));
  }
  return [...offsets].sort((a, b) => b - a);
});

const weeksWithReadingsSections = computed(() => {
  const now = new Date();
  const result: Array<{ type: 'header'; year: number } | { type: 'week'; offset: number }> = [];
  let lastYear: number | null = null;
  for (const offset of weeksWithReadings.value) {
    const end = new Date(now);
    end.setDate(now.getDate() + offset * 7);
    const year = end.getFullYear();
    if (year !== lastYear) {
      result.push({ type: 'header', year });
      lastYear = year;
    }
    result.push({ type: 'week', offset });
  }
  return result;
});

const MONTH_NAMES = computed(() => Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(locale.value, { month: 'short' }).format(new Date(2000, i, 1))));

function weekLabel(offset: number): string {
  const { start, end } = getChartWindow('week', offset);
  return `${fmt(start, { month: 'short', day: 'numeric' })} – ${fmt(end, { month: 'short', day: 'numeric' })}`;
}

function openJumpPicker() {
  if (chartRange.value === 'month') {
    pickerYear.value = chartWindow.value.start.getFullYear();
  }
  showJumpPicker.value = !showJumpPicker.value;
  if (showJumpPicker.value) {
    nextTick(() => {
      const picker = jumpPickerRef.value;
      const active = picker?.querySelector<HTMLElement>('.active');
      if (picker && active) {
        picker.scrollTop = active.offsetTop - picker.clientHeight / 2 + active.offsetHeight / 2;
      }
    });
  }
}

function closeJumpPicker() {
  if (!showJumpPicker.value) return;
  showJumpPicker.value = false;
  rangeLabelBtnRef.value?.focus();
}

useDismissable(showJumpPicker, closeJumpPicker);

// Tabbing out closes the picker without moving focus. A null relatedTarget (a click on
// something unfocusable; Safari never focuses clicked buttons) is left to the backdrop.
function onJumpPickerFocusout(e: FocusEvent) {
  const next = e.relatedTarget as Node | null;
  if (showJumpPicker.value && next && !rangeLabelWrapRef.value?.contains(next)) {
    showJumpPicker.value = false;
  }
}

function jumpToYear(year: number) {
  chartOffset.value = year - new Date().getFullYear();
  closeJumpPicker();
}

function jumpToMonth(monthIndex: number, year: number) {
  const now = new Date();
  chartOffset.value = (year - now.getFullYear()) * 12 + (monthIndex - now.getMonth());
  closeJumpPicker();
}

function jumpToWeekOffset(offset: number) {
  chartOffset.value = offset;
  closeJumpPicker();
}

function isFutureMonth(monthIndex: number, year: number): boolean {
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && monthIndex > now.getMonth());
}

function isDisplayedMonth(monthIndex: number, year: number): boolean {
  const s = chartWindow.value.start;
  return year === s.getFullYear() && monthIndex === s.getMonth();
}

function hasNoReadingsInMonth(monthIndex: number, year: number): boolean {
  // Build "YYYY-MM" key (monthIndex is 0-based, so +1 and zero-pad to match ISO date prefix)
  const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  return !monthsWithReadings.value.has(key);
}

const loadError = ref(false);
// Cached readings may be stale after a failed reload, so the trend alert hides, as on the card.
const readingsError = ref(false);
const showTrend = computed(() => trend.value.alerting && !readingsError.value);
const deleting = ref(false);
const deleteError = ref(false);

let unmounted = false;
onUnmounted(() => {
  unmounted = true;
});

onMounted(async () => {
  try {
    await petsStore.loadPets();
  } catch (e) {
    console.error('Loading pet failed', e);
    loadError.value = true;
    // A pet cached from an earlier visit can still be shown, with the alert.
    if (!pet.value) return;
  }
  // The user may have left while the pets loaded; don't pull them back home from another page.
  if (unmounted) return;
  if (!pet.value) {
    router.replace({ name: 'home' });
    return;
  }
  // Alert on failure, so an empty tab is not mistaken for a pet without data.
  readingsStore.loadReadingsForPet(petId).catch((e) => {
    console.error('Loading readings failed', e);
    loadError.value = true;
    readingsError.value = true;
  });
  notesStore.loadNotesForPet(petId).catch((e) => {
    console.error('Loading notes failed', e);
    loadError.value = true;
  });
});

async function deletePet() {
  if (deleting.value) return;
  // Close first, so the dialog hands focus back to the delete button.
  showDeleteDialog.value = false;
  deleting.value = true;
  deleteError.value = false;
  try {
    await petsStore.removePet(petId);
    returnTo(router, { name: 'home' });
  } catch (e) {
    console.error('Deleting pet failed', e);
    deleteError.value = true;
  } finally {
    deleting.value = false;
  }
}

</script>

<template>
  <div v-if="pet" class="page">
    <header class="page-header">
      <button class="back-btn" @click="returnTo(router, { name: 'home' })" :aria-label="$t('common.back')">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>
      <div class="header-actions">
        <button
          v-if="native"
          type="button"
          class="icon-btn reminder-btn"
          :class="{ on: remindersOn }"
          aria-haspopup="dialog"
          :aria-label="$t(bellLabel, { name: pet.name })"
          @click="showReminderModal = true"
        >
          <svg v-if="remindersOn" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/>
          </svg>
        </button>
        <button class="icon-btn" @click="showShareModal = true" :aria-label="$t('petDetail.share')">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
          </svg>
        </button>
        <button class="icon-btn" @click="showPdfModal = true" :aria-label="$t('petDetail.exportPdf')">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/>
          </svg>
        </button>
        <button class="icon-btn" @click="router.push({ name: 'pet-edit', params: { id: petId } })" :aria-label="$t('petDetail.editPet')">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
        </button>
        <button class="icon-btn danger" @click="showDeleteDialog = true" :aria-label="$t('petDetail.deletePet')">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
    </header>

    <p v-if="deleteError" class="save-error delete-error" role="alert">
      {{ $t('petDetail.deleteError', { name: pet.name }) }}
    </p>
    <p v-if="loadError" class="save-error load-error" role="alert">{{ $t('common.loadError') }}</p>

    <div class="pet-hero">
      <div class="pet-avatar">
        <img v-if="pet.photo" :src="pet.photo" :alt="pet.name" class="avatar-img" />
        <div v-else class="avatar-placeholder">
          <span>{{ petInitial(pet.name) }}</span>
        </div>
      </div>
      <h1 :id="titleId" class="pet-name">{{ pet.name }}</h1>
      <div class="pet-meta">
        <span class="badge" :class="pet.species">{{ $t('species.' + pet.species) }}</span>
        <span class="meta-dot">·</span>
        <span class="pet-age">{{ ageDisplay }}</span>
      </div>
      <p class="last-measured" :class="{ stale: lastMeasured.isStale }">{{ lastMeasured.label }}</p>
      <p v-if="reminderSummary" class="reminder-summary">{{ reminderSummary }}</p>
      <button v-if="showTrend" type="button" class="trend-badge" aria-haspopup="dialog" @click="showTrendInfo = true">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
          <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/>
        </svg>
        {{ trend.badge }}
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
          <path d="M9.29 6.71a1 1 0 0 0 0 1.41L13.17 12l-3.88 3.88a1 1 0 1 0 1.41 1.41l4.59-4.59a1 1 0 0 0 0-1.41L10.7 6.7a1 1 0 0 0-1.41.01z"/>
        </svg>
      </button>
    </div>

    <div class="track-cta">
      <button class="track-btn" @click="router.push({ name: 'tracker', params: { id: petId } })">
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        </svg>
        {{ $t('petDetail.startTracking') }}
      </button>
    </div>

    <div ref="tablistRef" class="tabs" role="tablist" :aria-labelledby="titleId" @keydown="onTabKeydown">
      <button
        :id="tabId('chart')"
        class="tab"
        :class="{ active: activeTab === 'chart' }"
        role="tab"
        :aria-selected="activeTab === 'chart'"
        :aria-controls="panelId('chart')"
        :tabindex="activeTab === 'chart' ? 0 : -1"
        @click="activeTab = 'chart'"
      >
        <span :id="tabLabelId('chart')">{{ $t('petDetail.tabChart') }}</span>
      </button>
      <button
        :id="tabId('readings')"
        class="tab"
        :class="{ active: activeTab === 'readings' }"
        role="tab"
        :aria-selected="activeTab === 'readings'"
        :aria-controls="panelId('readings')"
        :tabindex="activeTab === 'readings' ? 0 : -1"
        @click="activeTab = 'readings'"
      >
        <span :id="tabLabelId('readings')">{{ $t('petDetail.tabReadings') }}</span>
        <span v-if="readings.length > 0" class="tab-count">{{ readings.length }}</span>
      </button>
      <button
        :id="tabId('notes')"
        class="tab"
        :class="{ active: activeTab === 'notes' }"
        role="tab"
        :aria-selected="activeTab === 'notes'"
        :aria-controls="panelId('notes')"
        :tabindex="activeTab === 'notes' ? 0 : -1"
        @click="activeTab = 'notes'"
      >
        <span :id="tabLabelId('notes')">{{ $t('petDetail.tabNotes') }}</span>
        <span v-if="notes.length > 0" class="tab-count">{{ notes.length }}</span>
      </button>
      <div
        class="tab-indicator"
        aria-hidden="true"
        :class="{ dragging: isDragging }"
        :style="{ transform: `translateX(${(trackIndex - dragProgress) * 100}%)` }"
      ></div>
    </div>

    <div
      ref="tabViewportRef"
      class="tab-viewport"
      @touchstart="onTabTouchStart"
      @touchmove="onTabTouchMove"
      @touchend="onTabTouchEnd"
      @touchcancel="endDrag()"
    >
      <div
        class="tab-track"
        :class="{ dragging: isDragging }"
        :style="{ transform: `translateX(calc(${-trackIndex * 100}% + ${dragOffset}px))` }"
        @transitionend.self="isAnimating = false"
      >
        <div :id="panelId('chart')" class="tab-panel" :class="{ collapsed: isPanelCollapsed(0) }" role="tabpanel" :aria-labelledby="tabLabelId('chart')">
          <div class="chart-controls">
            <div class="range-toggle" role="group" :aria-label="$t('petDetail.rangeLabel')">
              <button :class="{ active: chartRange === 'week' }" :aria-pressed="chartRange === 'week'" @click="chartRange = 'week'">{{ $t('petDetail.rangeWeek') }}</button>
              <button :class="{ active: chartRange === 'month' }" :aria-pressed="chartRange === 'month'" @click="chartRange = 'month'">{{ $t('petDetail.rangeMonth') }}</button>
              <button :class="{ active: chartRange === 'year' }" :aria-pressed="chartRange === 'year'" @click="chartRange = 'year'">{{ $t('petDetail.rangeYear') }}</button>
            </div>
            <div class="range-nav">
              <button class="nav-btn" @click="chartOffset--" :disabled="!canGoPrev" :aria-label="$t('petDetail.prevPeriod')">
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                </svg>
              </button>
              <div ref="rangeLabelWrapRef" class="range-label-wrap" @keydown.esc="closeJumpPicker" @focusout="onJumpPickerFocusout">
                <button
                  ref="rangeLabelBtnRef"
                  class="range-label-btn"
                  :aria-expanded="showJumpPicker"
                  :aria-controls="showJumpPicker ? jumpPickerId : undefined"
                  @click="openJumpPicker"
                >
                  {{ chartLabel }}
                  <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                    <path d="M7 10l5 5 5-5z"/>
                  </svg>
                </button>
                <div v-if="showJumpPicker" :id="jumpPickerId" class="jump-picker" :class="`picker-${chartRange}`">
                  <div class="jump-picker-scroll" ref="jumpPickerRef">
                  <template v-if="chartRange === 'year'">
                    <button v-for="y in availableYears" :key="y"
                      class="jump-year-btn" :class="{ active: y === chartWindow.start.getFullYear() }"
                      :aria-current="y === chartWindow.start.getFullYear() ? 'true' : undefined"
                      @click="jumpToYear(y)">{{ y }}</button>
                  </template>
                  <template v-else-if="chartRange === 'month'">
                    <div class="jump-month-nav">
                      <button class="jump-nav-arrow" :disabled="pickerYear <= availableYears[availableYears.length - 1]" :aria-label="$t('datePicker.prevYear')" @click="pickerYear--">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
                          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                        </svg>
                      </button>
                      <span class="jump-year-label">{{ pickerYear }}</span>
                      <button class="jump-nav-arrow" :disabled="pickerYear >= new Date().getFullYear()" :aria-label="$t('datePicker.nextYear')" @click="pickerYear++">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
                          <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                        </svg>
                      </button>
                    </div>
                    <div class="jump-month-grid">
                      <button v-for="(m, i) in MONTH_NAMES" :key="i"
                        class="jump-month-btn"
                        :class="{ active: isDisplayedMonth(i, pickerYear) }"
                        :aria-current="isDisplayedMonth(i, pickerYear) ? 'true' : undefined"
                        :disabled="isFutureMonth(i, pickerYear) || hasNoReadingsInMonth(i, pickerYear)"
                        @click="jumpToMonth(i, pickerYear)">{{ m }}</button>
                    </div>
                  </template>
                  <template v-else>
                    <template v-for="item in weeksWithReadingsSections" :key="item.type === 'header' ? `h-${item.year}` : item.offset">
                      <div v-if="item.type === 'header'" class="jump-week-year-header">{{ item.year }}</div>
                      <button v-else
                        class="jump-year-btn" :class="{ active: item.offset === chartOffset }"
                        :aria-current="item.offset === chartOffset ? 'true' : undefined"
                        @click="jumpToWeekOffset(item.offset)">{{ weekLabel(item.offset) }}</button>
                    </template>
                  </template>
                  </div>
                </div>
              </div>
              <div v-if="showJumpPicker" class="jump-backdrop" @click="closeJumpPicker" />
              <div class="range-right">
                <button class="today-btn" :style="{ visibility: chartOffset !== 0 ? 'visible' : 'hidden' }" @click="chartOffset = 0">
                  {{ chartRange === 'week' ? $t('petDetail.thisWeek') : chartRange === 'month' ? $t('petDetail.thisMonth') : $t('petDetail.thisYear') }}
                </button>
                <button class="nav-btn" @click="chartOffset++" :disabled="!canGoNext" :aria-label="$t('petDetail.nextPeriod')">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <RRRChart :readings="chartReadings" :max-ticks="chartRange === 'year' ? 12 : chartRange === 'month' ? 6 : 8" :normal-ceiling="pet?.normalCeiling" />
        </div>
        <div :id="panelId('readings')" class="tab-panel" :class="{ collapsed: isPanelCollapsed(1) }" role="tabpanel" :aria-labelledby="tabLabelId('readings')" tabindex="0">
          <ReadingList :readings="readings" :pet="pet" />
        </div>
        <div :id="panelId('notes')" class="tab-panel" :class="{ collapsed: isPanelCollapsed(2) }" role="tabpanel" :aria-labelledby="tabLabelId('notes')" tabindex="0">
          <NoteList :notes="notes" :petId="petId" />
        </div>
      </div>
    </div>

    <Transition name="fab">
      <button
        v-if="activeTab === 'notes'"
        class="fab"
        @click="router.push({ name: 'note-add', params: { id: petId } })"
        :aria-label="$t('petDetail.addNote')"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
      </button>
    </Transition>

    <PdfExportModal
      v-if="showPdfModal"
      :pet="pet"
      :readings="readings"
      @close="showPdfModal = false"
    />

    <ReminderModal
      v-if="showReminderModal"
      :pet="pet"
      :readings="readings"
      @close="closeReminderModal"
    />

    <ShareLinkModal
      v-if="showShareModal"
      :pet="pet"
      :readings="readings"
      @close="showShareModal = false"
    />

    <InfoModal v-if="showTrendInfo && showTrend" :title="trend.title" @close="showTrendInfo = false">
      <p class="trend-message">{{ trend.message }}</p>
      <p class="trend-advice">{{ $t('trend.advice', { name: pet?.name }) }}</p>
      <h3 class="trend-how">{{ $t('trend.how') }}</h3>
      <p>{{ $t('trend.info.p1', trend.infoParams) }}</p>
      <p>{{ $t('trend.info.p2', trend.infoParams) }}</p>
      <p>{{ $t('trend.info.p3') }}</p>
      <p>{{ $t('trend.info.p4') }}</p>
    </InfoModal>

    <ConfirmDialog
      v-if="showDeleteDialog"
      :message="$t('petDetail.deleteConfirm', { name: pet.name })"
      @confirm="deletePet"
      @cancel="showDeleteDialog = false"
    />

  </div>

  <div v-else-if="loadError" class="page">
    <header class="page-header">
      <button class="back-btn" @click="returnTo(router, { name: 'home' })" :aria-label="$t('common.back')">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>
    </header>
    <p class="save-error load-error" role="alert">{{ $t('common.loadError') }}</p>
  </div>
</template>

<style scoped>
.save-error {
  margin: 0;
  font-size: 13px;
  color: var(--color-danger-text);
  background: var(--color-danger-bg);
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  text-align: center;
}

.delete-error,
.load-error {
  margin: 0 16px 12px;
}

.page {
  min-height: 100%;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
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

.back-btn {
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  padding: 4px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.icon-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  background: var(--color-bg);
}

.icon-btn.danger {
  color: var(--color-danger);
}

.reminder-btn.on {
  color: var(--color-primary);
}

.reminder-summary {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

.pet-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px 24px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.pet-avatar {
  margin-bottom: 16px;
}

.avatar-img {
  width: 96px;
  height: 96px;
  border-radius: var(--radius-full);
  object-fit: cover;
  border: 3px solid var(--color-primary-light);
}

.avatar-placeholder {
  width: 96px;
  height: 96px;
  border-radius: var(--radius-full);
  background: var(--color-primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  font-weight: 700;
  color: var(--color-primary);
}

.pet-name {
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 8px;
}

.pet-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--color-text-muted);
}

.badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.badge.cat { background: var(--color-badge-cat-bg); color: var(--color-badge-cat-text); }
.badge.dog { background: var(--color-badge-dog-bg); color: var(--color-badge-dog-text); }

.meta-dot { font-size: 18px; }

.last-measured {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 6px;
}

.last-measured.stale {
  color: #d97706;
}

.trend-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding: 4px 8px 4px 10px;
  border-radius: var(--radius-full);
  background: var(--color-badge-warning-bg);
  color: var(--color-warning-text);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* A 44px-tall tap target without making the badge itself bigger. */
.trend-badge::after {
  content: '';
  position: absolute;
  inset: -9px 0;
}

.trend-message,
.trend-how {
  color: var(--color-text);
}

.trend-how {
  font-size: 14px;
  font-weight: 600;
  margin: 20px 0 6px;
}

.track-cta {
  padding: 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.track-btn {
  width: 100%;
  height: 52px;
  background: var(--color-primary);
  color: #fff;
  border-radius: var(--radius-md);
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: opacity 0.15s;
}

.track-btn:active {
  opacity: 0.85;
}

.tabs {
  display: flex;
  position: relative;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  padding: 0 16px;
}

.tab {
  flex: 1;
  padding: 14px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
  transition: color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.tab.active {
  color: var(--color-primary);
}

.tab-indicator {
  position: absolute;
  bottom: 0;
  left: 16px;
  width: calc((100% - 32px) / 3);
  height: 2px;
  background: var(--color-primary);
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  border-radius: 1px 1px 0 0;
}

.tab-indicator.dragging,
.tab-track.dragging {
  transition: none;
}

.tab-count {
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: var(--radius-full);
}

/* Grows to the bottom of the page so swipes work below short tab content too */
.tab-viewport {
  flex: 1;
  overflow: hidden;
  touch-action: pan-y;
}

.tab-track {
  display: flex;
  align-items: flex-start;
  transition: transform 0.3s ease-out;
}

.tab-panel {
  flex: 0 0 100%;
  min-width: 0;
  padding: 16px;
  padding-bottom: 32px;
}

/* Off-screen panels stay mounted but take no height, so the page only scrolls the active tab */
.tab-panel.collapsed {
  height: 0;
  padding-top: 0;
  padding-bottom: 0;
  overflow: hidden;
  visibility: hidden;
}

.chart-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
  position: relative;
}

.range-toggle {
  display: flex;
  background: var(--color-bg);
  border-radius: var(--radius-full);
  padding: 3px;
  gap: 2px;
}

.range-toggle button {
  flex: 1;
  padding: 6px 0;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  transition: background 0.15s, color 0.15s;
}

.range-toggle button.active {
  background: var(--color-surface);
  color: var(--color-primary);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.range-nav {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}

.range-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.nav-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  transition: color 0.15s;
}

.nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.nav-btn:not(:disabled):active {
  color: var(--color-primary);
}

.range-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.today-btn {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: var(--color-primary-light);
  white-space: nowrap;
}

.range-label-wrap {
  position: relative;
  display: flex;
  justify-content: center;
}

.range-label-btn {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.range-label-btn:active {
  background: var(--color-bg);
}

.jump-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}

.jump-picker {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 41;
  min-width: 200px;
  max-width: 280px;
  overflow: hidden;
}

.jump-picker::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 28px;
  background: linear-gradient(to bottom, transparent, var(--color-surface));
  pointer-events: none;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
}

.jump-picker-scroll {
  padding: 12px;
  max-height: 224px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.picker-year .jump-picker-scroll {
  max-height: 200px;
}

.jump-week-year-header {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted);
  padding: 4px 12px 2px;
}

.jump-year-btn {
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  font-size: 14px;
  border-radius: var(--radius-sm);
  color: var(--color-text);
  transition: background 0.1s;
}

.jump-year-btn:hover {
  background: var(--color-bg);
}

.jump-year-btn.active {
  font-weight: 600;
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.jump-month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.jump-year-label {
  font-size: 14px;
  font-weight: 600;
}

.jump-nav-arrow {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  border-radius: var(--radius-full);
}

.jump-nav-arrow:disabled {
  opacity: 0.3;
  cursor: default;
}

.jump-month-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.jump-month-btn {
  padding: 6px 0;
  font-size: 13px;
  border-radius: var(--radius-sm);
  color: var(--color-text);
  transition: background 0.1s;
}

.jump-month-btn:hover:not(:disabled) {
  background: var(--color-bg);
}

.jump-month-btn.active {
  font-weight: 600;
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.jump-month-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.fab {
  position: fixed;
  bottom: calc(var(--nav-offset) + 20px);
  right: calc(20px + var(--safe-right));
  width: 56px;
  height: 56px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-lg);
  z-index: 20;
  transition: opacity 0.15s, transform 0.15s;
}

.fab:active {
  opacity: 0.85;
  transform: scale(0.94);
}

.fab-enter-active,
.fab-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

</style>
