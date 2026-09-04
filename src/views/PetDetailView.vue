<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { Reading } from '../types';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import { useAgeCalculator } from '../composables/useAgeCalculator';
import { useLastMeasured } from '../composables/useLastMeasured';
import { useTrendWatch } from '../composables/useTrendWatch';
import RRRChart from '../components/RRRChart.vue';
import ReadingList from '../components/ReadingList.vue';
import NoteList from '../components/NoteList.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import PdfExportModal from '../components/PdfExportModal.vue';
import ShareLinkModal from '../components/ShareLinkModal.vue';
import InfoModal from '../components/InfoModal.vue';
import { useNotesStore } from '../stores/notes';

const route = useRoute();
const router = useRouter();
const petsStore = usePetsStore();
const readingsStore = useReadingsStore();
const notesStore = useNotesStore();
const { t, locale } = useI18n();

const petId = route.params.id as string;
const pet = computed(() => petsStore.getPetById(petId));
const birthdateRef = computed(() => pet.value?.birthdate ?? '');
const ageDisplay = useAgeCalculator(birthdateRef);

const readings = computed(() => readingsStore.getReadingsForPet(petId));
const lastMeasured = useLastMeasured(readings);
const trend = useTrendWatch(readings);

function formatRate(value: number): string {
  return new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value);
}

const deviationLabel = computed(() =>
  trend.value.deviation === null
    ? ''
    : new Intl.NumberFormat(locale.value, {
        style: 'percent',
        signDisplay: 'exceptZero',
        maximumFractionDigits: 0,
      }).format(trend.value.deviation)
);

// 'rising' -> 'Rising', so trend.state* / trend.body* keys can be built from the state.
const trendKey = computed(() => trend.value.state.charAt(0).toUpperCase() + trend.value.state.slice(1));
const notes = computed(() => notesStore.getNotesForPet(petId));
const showDeleteDialog = ref(false);
const showPdfModal = ref(false);
const showShareModal = ref(false);
const showTrendInfo = ref(false);
const TABS = ['chart', 'readings', 'notes'] as const;
type TabName = (typeof TABS)[number];

const activeTab = computed({
  get: (): TabName => {
    const q = route.query.tab;
    return TABS.includes(q as TabName) ? (q as TabName) : 'chart';
  },
  set: (val: TabName) => {
    router.replace({ query: { ...route.query, tab: val } });
  },
});

const activeTabIndex = computed(() => TABS.indexOf(activeTab.value));
const canTabPrev = computed(() => activeTabIndex.value > 0);
const canTabNext = computed(() => activeTabIndex.value < TABS.length - 1);

function goToTab(index: number) {
  if (index < 0 || index >= TABS.length) return;
  activeTab.value = TABS[index];
}

const tabItems = computed(() => [
  { name: 'chart' as const, label: t('petDetail.tabChart'), count: 0 },
  { name: 'readings' as const, label: t('petDetail.tabReadings'), count: readings.value.length },
  { name: 'notes' as const, label: t('petDetail.tabNotes'), count: notes.value.length },
]);

// The indicator is measured from the live tab elements rather than assuming equal
// widths: labels differ per locale and the count badges change the widths too.
const tabsBarRef = ref<HTMLElement | null>(null);
const tabsRef = ref<HTMLElement | null>(null);
const tabEls = ref<HTMLElement[]>([]);
const tabIndicatorStyle = ref<Record<string, string>>({ width: '0px', transform: 'translateX(0)' });
// The arrows exist only when the labels genuinely do not all fit; when they do,
// there is nothing to step towards that is not already on screen.
const tabsOverflow = ref(false);
// Which edges currently cut a label off, so only those get faded.
const tabsFadeStart = ref(false);
const tabsFadeEnd = ref(false);

function setTabRef(el: Element | null, index: number) {
  if (el) tabEls.value[index] = el as HTMLElement;
}

// Smooth scrolling's last scroll event can land a pixel or two short of the
// resting position, and fractional device pixels round the same way, so the edges
// are compared with a small tolerance rather than exactly.
const TAB_EDGE_TOLERANCE = 4;

// Measured from the tabs rather than the strip's scrollWidth: the indicator
// overshoots as it slides (its easing is deliberately springy) and while it does,
// it inflates the strip's scrollable width, which would read as "more tabs to the
// right" for as long as the bounce lasts.
function tabsContentWidth(): number {
  const last = tabEls.value[tabEls.value.length - 1];
  return last ? last.offsetLeft + last.offsetWidth : 0;
}

function setTabFades(scrollLeft: number, strip: HTMLElement) {
  const content = tabsContentWidth();
  tabsFadeStart.value = scrollLeft > TAB_EDGE_TOLERANCE;
  tabsFadeEnd.value = scrollLeft + strip.clientWidth < content - TAB_EDGE_TOLERANCE;
}

function onTabsScroll() {
  const strip = tabsRef.value;
  if (strip) setTabFades(strip.scrollLeft, strip);
}

async function syncTabs(behavior: ScrollBehavior = 'smooth') {
  const strip = tabsRef.value;
  const bar = tabsBarRef.value;
  if (!strip || !bar) return;

  // Measured against the bar rather than the strip: the arrows take space of their
  // own, so measuring the strip would make the answer depend on whether they are
  // already shown, and the two would flip-flop.
  tabsOverflow.value = tabsContentWidth() > bar.clientWidth + 1;
  await nextTick(); // showing or hiding the arrows changes the strip's width

  const el = tabEls.value[activeTabIndex.value];
  if (!el) return;
  tabIndicatorStyle.value = {
    width: `${el.offsetWidth}px`,
    transform: `translateX(${el.offsetLeft}px)`,
  };
  // When the labels do not all fit, keep the active tab centred in the strip.
  const maxScroll = Math.max(0, tabsContentWidth() - strip.clientWidth);
  const target = Math.min(
    Math.max(0, el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2),
    maxScroll
  );
  strip.scrollTo({ left: target, behavior });
  // Derived from where the scroll comes to rest, not from the live position:
  // the scroll has not happened yet, and a scroll that does not move fires no
  // event to correct a stale reading.
  setTabFades(target, strip);
}

watch(
  [activeTab, locale, () => readings.value.length, () => notes.value.length],
  () => nextTick(() => syncTabs())
);

function onWindowResize() {
  syncTabs('auto');
}

onMounted(() => window.addEventListener('resize', onWindowResize));
onUnmounted(() => window.removeEventListener('resize', onWindowResize));

// Swipe between tabs, matching the onboarding walkthrough's gesture.
const TAB_SWIPE_THRESHOLD = 40;
let tabTouchStartX = 0;
let tabTouchStartY = 0;

function onTabTouchStart(e: TouchEvent) {
  tabTouchStartX = e.touches[0].clientX;
  tabTouchStartY = e.touches[0].clientY;
}

function onTabTouchEnd(e: TouchEvent) {
  if (showJumpPicker.value) return; // the open picker owns the gesture
  const dx = e.changedTouches[0].clientX - tabTouchStartX;
  const dy = e.changedTouches[0].clientY - tabTouchStartY;
  if (Math.abs(dx) < TAB_SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
  goToTab(activeTabIndex.value + (dx < 0 ? 1 : -1));
}

const chartRange = ref<'week' | 'month' | 'year'>('week');
const chartOffset = ref(0);
const showJumpPicker = ref(false);
const pickerYear = ref(new Date().getFullYear());
const jumpPickerRef = ref<HTMLElement | null>(null);


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

const chartWindow = computed(() => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (chartRange.value === 'week') {
    end.setDate(now.getDate() + chartOffset.value * 7);
    start.setTime(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  } else if (chartRange.value === 'month') {
    start.setMonth(now.getMonth() + chartOffset.value, 1);
    end.setMonth(now.getMonth() + chartOffset.value + 1, 0);
  } else {
    start.setFullYear(now.getFullYear() + chartOffset.value, 0, 1);
    end.setFullYear(now.getFullYear() + chartOffset.value, 11, 31);
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
});

const chartReadings = computed(() => {
  const filtered = readings.value.filter((r) => {
    const d = new Date(r.date);
    return d >= chartWindow.value.start && d <= chartWindow.value.end;
  });

  if (chartRange.value === 'week') return filtered;

  const keyFn = chartRange.value === 'month'
    ? (r: Reading) => r.date.slice(0, 10)
    : (r: Reading) => r.date.slice(0, 7);

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

// The usual range is a "right now" figure. Drawing it across a period the user has
// navigated back to — or across a year of monthly averages — would compare the pet
// to a range that did not exist then, so the line is limited to the current week/month.
const chartBaseline = computed(() => {
  if (chartOffset.value !== 0 || chartRange.value === 'year') return null;
  const b = trend.value.baseline;
  return b === null ? null : Math.round(b * 10) / 10;
});

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
  for (const r of readings.value) set.add(r.date.slice(0, 7));
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
    const daysDiff = Math.floor((new Date(r.date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    // Same offset formula used by chartWindow: ceil maps a day to the week whose end covers it
    offsets.add(Math.ceil(daysDiff / 7));
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
  const now = new Date();
  const end = new Date(now);
  end.setDate(now.getDate() + offset * 7);
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
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

function jumpToYear(year: number) {
  chartOffset.value = year - new Date().getFullYear();
  showJumpPicker.value = false;
}

function jumpToMonth(monthIndex: number, year: number) {
  const now = new Date();
  chartOffset.value = (year - now.getFullYear()) * 12 + (monthIndex - now.getMonth());
  showJumpPicker.value = false;
}

function jumpToWeekOffset(offset: number) {
  chartOffset.value = offset;
  showJumpPicker.value = false;
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

onMounted(async () => {
  await petsStore.loadPets();
  if (!pet.value) {
    router.push({ name: 'home' });
    return;
  }
  readingsStore.loadReadingsForPet(petId);
  notesStore.loadNotesForPet(petId);
  // Measure once the labels and count badges are actually in the DOM.
  await nextTick();
  syncTabs('auto');
});

async function deletePet() {
  await petsStore.removePet(petId);
  router.push({ name: 'home' });
}

</script>

<template>
  <div v-if="pet" class="page">
    <header class="page-header">
      <button class="back-btn" @click="router.push({ name: 'home' })" :aria-label="$t('common.back')">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>
      <div class="header-actions">
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

    <div class="pet-hero">
      <div class="pet-avatar">
        <img v-if="pet.photo" :src="pet.photo" :alt="pet.name" class="avatar-img" />
        <div v-else class="avatar-placeholder">
          <span>{{ pet.name[0].toUpperCase() }}</span>
        </div>
      </div>
      <h1 class="pet-name">{{ pet.name }}</h1>
      <div class="pet-meta">
        <span class="badge" :class="pet.species">{{ $t('species.' + pet.species) }}</span>
        <span class="meta-dot">·</span>
        <span class="pet-age">{{ ageDisplay }}</span>
      </div>
      <p class="last-measured" :class="{ stale: lastMeasured.isStale }">{{ lastMeasured.label }}</p>
      <button
        v-if="trend.state !== 'insufficient'"
        type="button"
        class="trend-line"
        :class="trend.state"
        @click="showTrendInfo = true"
      >
        <span class="trend-line-dot" :class="trend.state"></span>
        <span>
          {{ $t('trend.state' + trendKey) }} ·
          {{ $t('trend.heroSummary', { current: formatRate(trend.current!), baseline: formatRate(trend.baseline!) }) }}
        </span>
        <svg class="trend-line-chevron" viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
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

    <div class="tabs-bar" ref="tabsBarRef">
      <button
        v-if="tabsOverflow"
        class="tab-arrow"
        :style="{ visibility: canTabPrev ? 'visible' : 'hidden' }"
        :disabled="!canTabPrev"
        :aria-label="$t('petDetail.prevTab')"
        @click="goToTab(activeTabIndex - 1)"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
        </svg>
      </button>

      <div
        class="tabs"
        :class="{ 'fade-start': tabsFadeStart, 'fade-end': tabsFadeEnd }"
        ref="tabsRef"
        role="tablist"
        @scroll="onTabsScroll"
        @scrollend="onTabsScroll"
      >
        <button
          v-for="(item, i) in tabItems"
          :key="item.name"
          :ref="(el) => setTabRef(el as Element | null, i)"
          class="tab"
          :class="{ active: activeTab === item.name }"
          role="tab"
          :aria-selected="activeTab === item.name"
          @click="activeTab = item.name"
        >
          {{ item.label }}
          <span v-if="item.count > 0" class="tab-count">{{ item.count }}</span>
        </button>
        <div class="tab-indicator" :style="tabIndicatorStyle"></div>
      </div>

      <button
        v-if="tabsOverflow"
        class="tab-arrow"
        :style="{ visibility: canTabNext ? 'visible' : 'hidden' }"
        :disabled="!canTabNext"
        :aria-label="$t('petDetail.nextTab')"
        @click="goToTab(activeTabIndex + 1)"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
        </svg>
      </button>
    </div>

    <div class="tab-content" @touchstart="onTabTouchStart" @touchend="onTabTouchEnd">
      <template v-if="activeTab === 'chart'">
        <div class="chart-controls">
          <div class="range-toggle">
            <button :class="{ active: chartRange === 'week' }" @click="chartRange = 'week'">{{ $t('petDetail.rangeWeek') }}</button>
            <button :class="{ active: chartRange === 'month' }" @click="chartRange = 'month'">{{ $t('petDetail.rangeMonth') }}</button>
            <button :class="{ active: chartRange === 'year' }" @click="chartRange = 'year'">{{ $t('petDetail.rangeYear') }}</button>
          </div>
          <div class="range-nav">
            <button class="nav-btn" @click="chartOffset--" :disabled="!canGoPrev" :aria-label="$t('petDetail.prevPeriod')">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
              </svg>
            </button>
            <div class="range-label-wrap">
              <button class="range-label-btn" @click="openJumpPicker">
                {{ chartLabel }}
                <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                  <path d="M7 10l5 5 5-5z"/>
                </svg>
              </button>
              <div v-if="showJumpPicker" class="jump-picker" :class="`picker-${chartRange}`">
                <div class="jump-picker-scroll" ref="jumpPickerRef">
                <template v-if="chartRange === 'year'">
                  <button v-for="y in availableYears" :key="y"
                    class="jump-year-btn" :class="{ active: y === chartWindow.start.getFullYear() }"
                    @click="jumpToYear(y)">{{ y }}</button>
                </template>
                <template v-else-if="chartRange === 'month'">
                  <div class="jump-month-nav">
                    <button class="jump-nav-arrow" :disabled="pickerYear <= availableYears[availableYears.length - 1]" @click="pickerYear--">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                        <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                      </svg>
                    </button>
                    <span class="jump-year-label">{{ pickerYear }}</span>
                    <button class="jump-nav-arrow" :disabled="pickerYear >= new Date().getFullYear()" @click="pickerYear++">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                      </svg>
                    </button>
                  </div>
                  <div class="jump-month-grid">
                    <button v-for="(m, i) in MONTH_NAMES" :key="i"
                      class="jump-month-btn"
                      :class="{ active: isDisplayedMonth(i, pickerYear) }"
                      :disabled="isFutureMonth(i, pickerYear) || hasNoReadingsInMonth(i, pickerYear)"
                      @click="jumpToMonth(i, pickerYear)">{{ m }}</button>
                  </div>
                </template>
                <template v-else>
                  <template v-for="item in weeksWithReadingsSections" :key="item.type === 'header' ? `h-${item.year}` : item.offset">
                    <div v-if="item.type === 'header'" class="jump-week-year-header">{{ item.year }}</div>
                    <button v-else
                      class="jump-year-btn" :class="{ active: item.offset === chartOffset }"
                      @click="jumpToWeekOffset(item.offset)">{{ weekLabel(item.offset) }}</button>
                  </template>
                </template>
                </div>
              </div>
            </div>
            <div v-if="showJumpPicker" class="jump-backdrop" @click="showJumpPicker = false" />
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
        <RRRChart
          :readings="chartReadings"
          :max-ticks="chartRange === 'year' ? 12 : chartRange === 'month' ? 6 : 8"
          :normal-ceiling="pet?.normalCeiling"
          :baseline="chartBaseline"
        />
      </template>
      <ReadingList v-else-if="activeTab === 'readings'" :readings="readings" :pet="pet" />
      <NoteList v-else :notes="notes" :petId="petId" />
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

    <ShareLinkModal
      v-if="showShareModal"
      :pet="pet"
      :readings="readings"
      @close="showShareModal = false"
    />

    <ConfirmDialog
      v-if="showDeleteDialog"
      :message="$t('petDetail.deleteConfirm', { name: pet.name })"
      @confirm="deletePet"
      @cancel="showDeleteDialog = false"
    />

    <InfoModal
      v-if="showTrendInfo"
      :title="$t('trend.title')"
      @close="showTrendInfo = false"
    >
      <div v-if="trend.baseline !== null && trend.current !== null" class="trend-stats">
        <div class="trend-stat">
          <span class="trend-stat-value">{{ formatRate(trend.baseline) }}</span>
          <span class="trend-stat-label">{{ $t('trend.usualLabel') }}</span>
        </div>
        <div class="trend-stat">
          <span class="trend-stat-value">{{ formatRate(trend.current) }}</span>
          <span class="trend-stat-label">{{ $t('trend.nowLabel') }}</span>
        </div>
        <div class="trend-stat">
          <span class="trend-stat-value" :class="trend.state">{{ deviationLabel }}</span>
          <span class="trend-stat-label">{{ $t('trend.changeLabel') }}</span>
        </div>
      </div>
      <p class="trend-body">{{ $t('trend.body' + trendKey, { name: pet.name }) }}</p>
      <p class="trend-meta">{{ $t('trend.basedOn', { recent: trend.recentCount, baseline: trend.baselineCount }) }}</p>
      <p class="trend-disclaimer">{{ $t('trend.disclaimer') }}</p>
    </InfoModal>

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

.trend-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  color: var(--color-text-muted);
  background: transparent;
  transition: background 0.15s;
}

.trend-line.watch {
  color: var(--color-warning);
  background: var(--color-warning-bg);
}

.trend-line.rising {
  color: var(--color-danger);
  background: var(--color-danger-bg);
}

/* align-items: center lines up the flex items' boxes, but the text's box is taller
   than its letters — the font reserves descender space below the baseline whether
   or not the string uses it — so both marks land a little above the letters they
   read alongside. They are nudged down to sit level with the "·" separator in the
   string itself, which is the mark the eye compares them against. Aligning instead
   to the text's full ink box would overshoot, since that box includes descenders.
   A whole pixel keeps them off a half-pixel, where they would render soft. */
.trend-line-dot,
.trend-line-chevron {
  transform: translateY(1px);
}

.trend-line-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-success);
  flex-shrink: 0;
}

.trend-line-dot.watch {
  background: var(--color-warning);
}

.trend-line-dot.rising {
  background: var(--color-danger);
}

.trend-line-chevron {
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.15s;
}

.trend-line:hover .trend-line-chevron {
  opacity: 1;
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

.tabs-bar {
  display: flex;
  align-items: stretch;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.tab-arrow {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  color: var(--color-text-muted);
  transition: color 0.15s;
}

.tab-arrow:hover {
  color: var(--color-primary);
}

.tabs {
  --tab-fade: 24px;
  display: flex;
  position: relative;
  flex: 1;
  min-width: 0;
  /* Four tabs do not fit at narrow widths in every language, so the strip scrolls
     and the arrows step through it. */
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  scroll-behavior: smooth;
}

.tabs::-webkit-scrollbar {
  display: none;
}

/* A scrolled strip cuts a label mid-word. Fading the cut edge makes that read as
   "more this way" instead of as a rendering glitch — and only the edge that is
   actually cutting something off is faded. */
.tabs.fade-start {
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 var(--tab-fade));
  mask-image: linear-gradient(to right, transparent 0, #000 var(--tab-fade));
}

.tabs.fade-end {
  -webkit-mask-image: linear-gradient(to left, transparent 0, #000 var(--tab-fade));
  mask-image: linear-gradient(to left, transparent 0, #000 var(--tab-fade));
}

.tabs.fade-start.fade-end {
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 var(--tab-fade),
    #000 calc(100% - var(--tab-fade)),
    transparent 100%
  );
  mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 var(--tab-fade),
    #000 calc(100% - var(--tab-fade)),
    transparent 100%
  );
}

.tab {
  flex: 1 0 auto;
  padding: 14px 12px;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
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
  left: 0;
  height: 2px;
  background: var(--color-primary);
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  border-radius: 1px 1px 0 0;
}

.tab-count {
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: var(--radius-full);
}

.tab-content {
  padding: 16px;
  padding-bottom: 32px;
  /* Vertical scrolling stays native; horizontal is ours, for the tab swipe. */
  touch-action: pan-y;
}

.trend-stats {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.trend-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  background: var(--color-bg);
  border-radius: var(--radius-sm);
  min-width: 0;
}

.trend-stat-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
}

.trend-stat-value.watch {
  color: var(--color-warning);
}

.trend-stat-value.rising {
  color: var(--color-danger);
}

.trend-stat-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--color-text-muted);
  text-align: center;
}

.trend-body {
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text);
}

.trend-meta {
  margin-top: 6px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.trend-disclaimer {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
  font-size: 11px;
  line-height: 1.45;
  color: var(--color-text-muted);
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
