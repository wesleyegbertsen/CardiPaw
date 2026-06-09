<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePetsStore } from '../stores/pets';
import { useRemindersStore } from '../stores/reminders';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import type { DayOfWeek } from '../types';

const route = useRoute();
const router = useRouter();
const petsStore = usePetsStore();
const remindersStore = useRemindersStore();

const petId = route.params.id as string;
const reminderId = route.params.reminderId as string | undefined;
const isEdit = !!reminderId;

const pet = computed(() => petsStore.getPetById(petId));

// Canonical time value in HH:MM 24h format — what save() reads
const time = ref('08:00');

// Drum picker state (kept in sync with `time`)
const displayHour = ref(8);
const displayMinute = ref('00');
const isPM = ref(false);

const hourColRef = ref<HTMLElement | null>(null);
const minuteColRef = ref<HTMLElement | null>(null);
const ampmColRef = ref<HTMLElement | null>(null);

const ITEM_HEIGHT = 44;
const HALF = ITEM_HEIGHT / 2;
const HOUR_COUNT = 12;
const MINUTE_COUNT = 60;
const COPIES = 3; // 3× each list; center = copy 1; in-scroll reset keeps it infinite

const hourItems = Array.from({ length: HOUR_COUNT * COPIES }, (_, i) => (i % HOUR_COUNT) + 1);
const minuteItems = Array.from({ length: MINUTE_COUNT * COPIES }, (_, i) => i % MINUTE_COUNT);

let hourTimer: ReturnType<typeof setTimeout>;
let minTimer: ReturnType<typeof setTimeout>;
let ampmTimer: ReturnType<typeof setTimeout>;

function setTime(val: string) {
  const [h, m] = val.split(':').map(Number);
  time.value = val;
  displayHour.value = h % 12 || 12;
  displayMinute.value = String(m).padStart(2, '0');
  isPM.value = h >= 12;
  nextTick(() => {
    if (hourColRef.value)
      hourColRef.value.scrollTop = (HOUR_COUNT + displayHour.value - 1) * ITEM_HEIGHT;
    if (minuteColRef.value)
      minuteColRef.value.scrollTop = (MINUTE_COUNT + m) * ITEM_HEIGHT;
    if (ampmColRef.value)
      ampmColRef.value.scrollTop = (isPM.value ? 1 : 0) * ITEM_HEIGHT;
  });
}

function readTimeFromScroll() {
  if (!hourColRef.value || !minuteColRef.value || !ampmColRef.value) return;

  const hourRaw = Math.round(hourColRef.value.scrollTop / ITEM_HEIGHT);
  const minuteRaw = Math.round(minuteColRef.value.scrollTop / ITEM_HEIGHT);
  const ampmRaw = Math.round(ampmColRef.value.scrollTop / ITEM_HEIGHT);

  const h = (hourRaw % HOUR_COUNT) + 1;
  const m = minuteRaw % MINUTE_COUNT;
  const pm = Math.max(0, Math.min(1, ampmRaw)) === 1;

  displayHour.value = h;
  displayMinute.value = String(m).padStart(2, '0');
  isPM.value = pm;

  // Reset to center copy (copy 1) after settling to restore full scroll buffer
  hourColRef.value.scrollTop = (HOUR_COUNT + h - 1) * ITEM_HEIGHT;
  minuteColRef.value.scrollTop = (MINUTE_COUNT + m) * ITEM_HEIGHT;


  let h24 = h % 12;
  if (pm) h24 += 12;
  time.value = `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function onHourScroll() {
  if (hourColRef.value) {
    const el = hourColRef.value;
    // HALF dead zone: only reset once past the midpoint between snap points,
    // so the post-reset snap always resolves to the correct adjacent item
    if (el.scrollTop < HOUR_COUNT * ITEM_HEIGHT - HALF)
      el.scrollTop += HOUR_COUNT * ITEM_HEIGHT;
    else if (el.scrollTop >= HOUR_COUNT * 2 * ITEM_HEIGHT + HALF)
      el.scrollTop -= HOUR_COUNT * ITEM_HEIGHT;
  }
  clearTimeout(hourTimer);
  hourTimer = setTimeout(readTimeFromScroll, 200);
}

function onMinuteScroll() {
  if (minuteColRef.value) {
    const el = minuteColRef.value;
    if (el.scrollTop < MINUTE_COUNT * ITEM_HEIGHT - HALF)
      el.scrollTop += MINUTE_COUNT * ITEM_HEIGHT;
    else if (el.scrollTop >= MINUTE_COUNT * 2 * ITEM_HEIGHT + HALF)
      el.scrollTop -= MINUTE_COUNT * ITEM_HEIGHT;
  }
  clearTimeout(minTimer);
  minTimer = setTimeout(readTimeFromScroll, 200);
}

function onAmpmScroll() {
  clearTimeout(ampmTimer);
  ampmTimer = setTimeout(readTimeFromScroll, 200);
}

onUnmounted(() => {
  clearTimeout(hourTimer);
  clearTimeout(minTimer);
  clearTimeout(ampmTimer);
});

const title = ref('');
const description = ref('');
const selectedDays = ref<DayOfWeek[]>([1, 2, 3, 4, 5]); // Mon–Fri default
const enabled = ref(true);
const showDeleteDialog = ref(false);
const saving = ref(false);

const DAYS: { label: string; value: DayOfWeek }[] = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

const titleError = ref('');
const daysError = ref('');

onMounted(async () => {
  setTime(time.value); // scroll drum to default (08:00 AM)
  await remindersStore.loadRemindersForPet(petId);
  if (isEdit) {
    const reminder = remindersStore.getRemindersForPet(petId).find(r => r.id === reminderId);
    if (reminder) {
      setTime(reminder.time);
      title.value = reminder.title;
      description.value = reminder.description ?? '';
      selectedDays.value = [...reminder.days];
      enabled.value = reminder.enabled;
    } else {
      router.replace({ name: 'reminders', params: { id: petId } });
    }
  }
});

function toggleDay(day: DayOfWeek) {
  const idx = selectedDays.value.indexOf(day);
  if (idx === -1) selectedDays.value.push(day);
  else selectedDays.value.splice(idx, 1);
  daysError.value = '';
}

function validate() {
  let ok = true;
  titleError.value = '';
  daysError.value = '';
  if (!title.value.trim()) {
    titleError.value = 'Title is required.';
    ok = false;
  }
  if (selectedDays.value.length === 0) {
    daysError.value = 'Select at least one day.';
    ok = false;
  }
  return ok;
}

async function save() {
  if (!validate() || saving.value) return;
  saving.value = true;
  try {
    if (isEdit) {
      const existing = remindersStore.getRemindersForPet(petId).find(r => r.id === reminderId)!;
      await remindersStore.updateReminder({
        ...existing,
        time: time.value,
        title: title.value.trim(),
        description: description.value.trim() || undefined,
        days: [...selectedDays.value].sort((a, b) => a - b) as DayOfWeek[],
        enabled: enabled.value,
        petName: pet.value?.name ?? existing.petName,
      });
    } else {
      await remindersStore.addReminder({
        petId,
        petName: pet.value?.name ?? '',
        time: time.value,
        title: title.value.trim(),
        description: description.value.trim() || undefined,
        days: [...selectedDays.value].sort((a, b) => a - b) as DayOfWeek[],
        enabled: enabled.value,
      });
    }
    router.push({ name: 'reminders', params: { id: petId } });
  } finally {
    saving.value = false;
  }
}

async function deleteReminder() {
  if (!reminderId) return;
  await remindersStore.removeReminder(reminderId, petId);
  router.push({ name: 'reminders', params: { id: petId } });
}

function goBack() {
  router.push({ name: 'reminders', params: { id: petId } });
}
</script>

<template>
  <div class="view-container">
    <header class="page-header">
      <button class="icon-btn" @click="goBack" aria-label="Back">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>
      <span class="header-main">{{ isEdit ? 'Edit Reminder' : 'Add Reminder' }}</span>
      <div class="header-spacer" aria-hidden="true" />
    </header>

    <div class="form">
      <!-- Time drum picker -->
      <div class="time-wrapper">
        <div class="drum-container">
          <div class="drum-picker">
            <div class="drum-col" ref="hourColRef" @scroll.passive="onHourScroll">
              <div class="drum-spacer" />
              <div v-for="(h, i) in hourItems" :key="i" class="drum-item">{{ h }}</div>
              <div class="drum-spacer" />
            </div>
            <div class="drum-sep">:</div>
            <div class="drum-col" ref="minuteColRef" @scroll.passive="onMinuteScroll">
              <div class="drum-spacer" />
              <div v-for="(m, i) in minuteItems" :key="i" class="drum-item">{{ String(m).padStart(2, '0') }}</div>
              <div class="drum-spacer" />
            </div>
            <div class="drum-col ampm-col" ref="ampmColRef" @scroll.passive="onAmpmScroll">
              <div class="drum-spacer" />
              <div class="drum-item">AM</div>
              <div class="drum-item">PM</div>
              <div class="drum-spacer" />
            </div>
          </div>
          <div class="drum-fade-top" />
          <div class="drum-fade-bottom" />
          <div class="drum-line drum-line-top" />
          <div class="drum-line drum-line-bottom" />
        </div>
      </div>

      <!-- Days of week -->
      <div class="field">
        <span class="label">Repeat</span>
        <div class="days-row">
          <button
            v-for="day in DAYS"
            :key="day.value"
            class="day-pill"
            :class="{ active: selectedDays.includes(day.value) }"
            @click="toggleDay(day.value)"
          >{{ day.label }}</button>
        </div>
        <p v-if="daysError" class="field-error">{{ daysError }}</p>
      </div>

      <!-- Title -->
      <div class="field">
        <label class="label" for="reminder-title">Title</label>
        <input
          id="reminder-title"
          type="text"
          class="text-input"
          :class="{ error: titleError }"
          v-model="title"
          placeholder="e.g. Morning RRR check"
          maxlength="80"
          @input="titleError = ''"
        />
        <p v-if="titleError" class="field-error">{{ titleError }}</p>
      </div>

      <!-- Description -->
      <div class="field">
        <label class="label" for="reminder-desc">Description <span class="optional">(optional)</span></label>
        <textarea
          id="reminder-desc"
          class="text-input textarea"
          v-model="description"
          placeholder="e.g. Measure while cat is resting on the couch"
          rows="3"
          maxlength="200"
        />
      </div>

      <!-- Enabled toggle -->
      <div class="field field-row">
        <span class="label">Active</span>
        <button class="toggle-btn" :aria-pressed="enabled" @click="enabled = !enabled">
          <span class="toggle-track" :class="{ on: enabled }">
            <span class="toggle-thumb" />
          </span>
        </button>
      </div>

      <!-- Submit -->
      <button class="submit-btn" :disabled="saving" @click="save">
        {{ saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add Reminder') }}
      </button>

      <!-- Delete (edit mode) -->
      <button v-if="isEdit" class="btn-delete" @click="showDeleteDialog = true">Delete Reminder</button>
    </div>

    <ConfirmDialog
      v-if="showDeleteDialog"
      title="Delete reminder?"
      message="This reminder will be permanently deleted."
      confirm-label="Delete"
      @confirm="deleteReminder"
      @cancel="showDeleteDialog = false"
    />
  </div>
</template>

<style scoped>
.view-container {
  min-height: 100%;
  background: var(--color-bg);
  padding-bottom: calc(var(--nav-height) + 24px);
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-main {
  flex: 1;
  font-size: 17px;
  font-weight: 600;
  text-align: center;
}

.icon-btn {
  background: none;
  border: none;
  color: var(--color-text);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  border-radius: var(--radius-sm);
}

.header-spacer {
  width: 36px;
  flex-shrink: 0;
}

.submit-btn {
  width: 100%;
  height: 52px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
  transition: opacity 0.15s;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.form {
  padding: 24px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.optional {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

/* Drum picker */
.time-wrapper {
  display: flex;
  justify-content: center;
}

.drum-container {
  position: relative;
  height: 220px; /* 5 × 44px */
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.drum-picker {
  display: flex;
  align-items: center;
  height: 100%;
}

.drum-col {
  height: 100%;
  width: 64px;
  overflow-y: scroll;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.drum-col::-webkit-scrollbar {
  display: none;
}

.ampm-col {
  width: 72px;
  margin-left: 8px;
}

.drum-spacer {
  height: 88px; /* 2 × 44px — centers first/last items */
  flex-shrink: 0;
}

.drum-item {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  scroll-snap-align: center;
  font-size: 22px;
  font-weight: 500;
  color: var(--color-text);
  user-select: none;
}

.drum-sep {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-text);
  padding: 0 4px;
  user-select: none;
  flex-shrink: 0;
  margin-bottom: 4px; /* align with digit optical center */
}

/* Gradient fades — blend items into background above/below selection */
.drum-fade-top,
.drum-fade-bottom {
  position: absolute;
  left: 0;
  right: 0;
  height: 88px;
  pointer-events: none;
  z-index: 2;
}

.drum-fade-top {
  top: 0;
  background: linear-gradient(to bottom, var(--color-bg) 20%, transparent);
}

.drum-fade-bottom {
  bottom: 0;
  background: linear-gradient(to top, var(--color-bg) 20%, transparent);
}

/* Selection indicator lines */
.drum-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--color-border);
  pointer-events: none;
  z-index: 3;
}

.drum-line-top {
  top: calc(50% - 22px);
}

.drum-line-bottom {
  top: calc(50% + 21px);
}

/* Days */
.days-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.day-pill {
  flex: 1;
  min-width: 36px;
  padding: 8px 4px;
  border-radius: var(--radius-full);
  border: 1.5px solid var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}

.day-pill.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

/* Text inputs */
.text-input {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 15px;
  background: var(--color-surface);
  color: var(--color-text);
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
}

.text-input:focus {
  border-color: var(--color-primary);
}

.text-input.error {
  border-color: var(--color-danger);
}

.textarea {
  resize: vertical;
  min-height: 80px;
}

.field-error {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--color-danger);
}

/* Toggle */
.toggle-btn {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
}

.toggle-track {
  display: block;
  width: 48px;
  height: 26px;
  border-radius: 13px;
  background: var(--color-border);
  position: relative;
  transition: background 0.2s;
}

.toggle-track.on {
  background: var(--color-primary);
}

.toggle-thumb {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  position: absolute;
  top: 3px;
  left: 3px;
  transition: transform 0.2s;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}

.toggle-track.on .toggle-thumb {
  transform: translateX(22px);
}

/* Delete */
.btn-delete {
  width: 100%;
  padding: 12px;
  border: 1.5px solid var(--color-danger);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-danger);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
</style>
