<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { App } from '@capacitor/app';
import type { Pet, Reading } from '../types';
import { WEEK_START, type Locale } from '../i18n';
import { useModal } from '../composables/useModal';
import SlideToggle from './SlideToggle.vue';
import { localDayKey } from '../utils/date';
import { planReminders } from '../utils/reminderSchedule';
import {
  ALL_DAYS,
  DEFAULT_REMINDER,
  isValidTime,
  loadReminderSettings,
  saveReminderSetting,
} from '../utils/reminderSettings';
import { orderedWeekdays, weekdayName } from '../utils/reminderFormat';
import {
  applyReminders,
  openNotificationSettings,
  reminderPermission,
  requestReminderPermission,
  type ReminderPermission,
} from '../native/reminders';

// App only: PetDetailView shows the bell that opens this on Android alone.
const props = defineProps<{ pet: Pet; readings: Reading[] }>();
const emit = defineEmits<{ close: [] }>();
const { locale } = useI18n();

const stored = loadReminderSettings()[props.pet.id] ?? DEFAULT_REMINDER;
const enabled = ref(stored.enabled);
const time = ref(stored.time);
const days = ref<number[]>([...stored.days]);
const permission = ref<ReminderPermission | null>(null);
const saving = ref(false);
const saveFailed = ref(false);

const titleId = useId();
const enableId = useId();
const timeId = useId();
const daysId = useId();
const dialogRef = ref<HTMLElement | null>(null);
useModal(dialogRef, { onClose: () => emit('close'), canClose: () => !saving.value });

const weekdays = computed(() => orderedWeekdays(WEEK_START[locale.value as Locale] ?? 1));
// Turning reminders on needs the permission; once Android won't ask any more, only its settings can give it.
const switchDisabled = computed(
  () => saving.value || (!enabled.value && permission.value === 'denied'),
);
const canSave = computed(
  () => !saving.value && (!enabled.value || (days.value.length > 0 && isValidTime(time.value))),
);

const nextLabel = computed(() => {
  if (!canSave.value || !enabled.value) return '';
  const now = new Date();
  const measured = new Set(props.readings.map((r) => localDayKey(r.date)));
  const next = planReminders(
    { enabled: true, time: time.value, days: days.value, slot: 1 },
    measured,
    now,
  ).find((p) => p.at > now);
  if (!next) return '';
  return new Intl.DateTimeFormat(locale.value, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(next.at);
});

async function checkPermission() {
  try {
    permission.value = await reminderPermission();
  } catch (e) {
    console.error('Checking the notification permission failed', e);
  }
}

onMounted(checkPermission);
// Back from Android's settings, where the permission may have changed.
const resume = App.addListener('resume', () => void checkPermission());
onBeforeUnmount(() => void resume.then((handle) => handle.remove()));

// SlideToggle flips the value it shows; turning on waits for the permission instead.
const enabledModel = computed({
  get: () => enabled.value,
  set: (on: boolean) => void toggle(on),
});

async function toggle(on: boolean) {
  if (!on) {
    enabled.value = false;
    return;
  }
  if (permission.value !== 'granted') {
    try {
      permission.value = await requestReminderPermission();
    } catch (e) {
      console.error('Asking for the notification permission failed', e);
      return;
    }
    if (permission.value !== 'granted') return;
  }
  enabled.value = true;
}

function toggleDay(day: number) {
  days.value = days.value.includes(day)
    ? days.value.filter((d) => d !== day)
    : [...days.value, day].sort((a, b) => a - b);
}

async function openSettings() {
  try {
    await openNotificationSettings();
  } catch (e) {
    console.error('Opening the notification settings failed', e);
  }
}

async function save() {
  saving.value = true;
  saveFailed.value = false;
  try {
    // Off, the emptied day list or time are kept valid: a setting without them can't be stored.
    saveReminderSetting(props.pet.id, {
      enabled: enabled.value,
      time: isValidTime(time.value) ? time.value : DEFAULT_REMINDER.time,
      days: days.value.length ? days.value : ALL_DAYS,
    });
    await applyReminders(props.pet.id);
  } catch (e) {
    console.error('Saving reminders failed', e);
    saveFailed.value = true;
    return;
  } finally {
    saving.value = false;
  }
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div
      class="overlay"
      @click.self="
        () => {
          if (!saving) emit('close');
        }
      "
    >
      <div
        ref="dialogRef"
        class="dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
      >
        <div class="dialog-header">
          <h2 :id="titleId" class="dialog-title">{{ $t('reminders.title') }}</h2>
          <p class="dialog-subtitle">{{ pet.name }}</p>
        </div>

        <div class="option-row">
          <span :id="enableId" class="option-label">{{ $t('reminders.enable') }}</span>
          <SlideToggle v-model="enabledModel" :labelledby="enableId" :disabled="switchDisabled" />
        </div>

        <div v-if="permission === 'denied'" class="denied">
          <p role="alert">{{ $t('reminders.denied') }}</p>
          <button type="button" class="settings-btn" @click="openSettings">
            {{ $t('reminders.openSettings') }}
          </button>
        </div>

        <template v-if="enabled">
          <div class="option-row">
            <label :for="timeId" class="option-label">{{ $t('reminders.time') }}</label>
            <input
              :id="timeId"
              v-model="time"
              type="time"
              class="time-input"
              required
              :disabled="saving"
            />
          </div>
          <div class="field">
            <span :id="daysId" class="option-label">{{ $t('reminders.days') }}</span>
            <div class="day-row" role="group" :aria-labelledby="daysId">
              <button
                v-for="day in weekdays"
                :key="day"
                type="button"
                class="day-btn"
                :class="{ active: days.includes(day) }"
                :aria-pressed="days.includes(day)"
                :aria-label="weekdayName(day, locale, 'long')"
                :disabled="saving"
                @click="toggleDay(day)"
              >
                {{ weekdayName(day, locale, 'short') }}
              </button>
            </div>
          </div>
          <p v-if="!days.length" class="hint">{{ $t('reminders.noDays') }}</p>
          <p v-else-if="nextLabel" class="next">{{ $t('reminders.next', { when: nextLabel }) }}</p>
          <p class="hint">{{ $t('reminders.skipHint', { name: pet.name }) }}</p>
          <p class="hint">{{ $t('reminders.localHint') }}</p>
        </template>

        <p v-if="saveFailed" class="error-msg" role="alert">{{ $t('common.saveError') }}</p>

        <div class="dialog-footer">
          <button type="button" class="btn-cancel" :disabled="saving" @click="emit('close')">
            {{ $t('common.cancel') }}
          </button>
          <button type="button" class="btn-save" :disabled="!canSave" @click="save">
            {{ saving ? $t('common.saving') : $t('reminders.save') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* .overlay, .dialog, the header, .error-msg and the footer follow PdfExportModal. */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 500;
}

@media (min-width: 480px) {
  .overlay {
    align-items: center;
    padding: 24px;
  }
}

.dialog {
  background: var(--color-surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding: 24px;
  padding-bottom: calc(24px + var(--safe-bottom));
  width: 100%;
  max-width: 420px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 80vh;
  overflow-y: auto;
  outline: none;
}

@media (min-width: 480px) {
  .dialog {
    border-radius: var(--radius-lg);
  }
}

.dialog-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dialog-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
}

.dialog-subtitle,
.hint {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
}

.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.option-label {
  font-size: 14px;
  color: var(--color-text);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.time-input {
  font: inherit;
  font-size: 15px;
  padding: 6px 10px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
}

.day-row {
  display: flex;
  gap: 4px;
}

.day-btn {
  flex: 1;
  min-width: 0;
  height: 40px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-surface);
  transition:
    border-color 0.15s,
    color 0.15s,
    background 0.15s;
}

.day-btn.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.next {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.denied {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: var(--color-danger-text);
  background: var(--color-danger-bg);
  padding: 10px 14px;
  border-radius: var(--radius-sm);
}

.denied p {
  margin: 0;
}

.settings-btn {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-primary);
  padding: 6px 12px;
  border-radius: var(--radius-full);
  background: var(--color-surface);
}

.error-msg {
  font-size: 13px;
  color: var(--color-danger-text);
  background: var(--color-danger-bg);
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  margin: 0;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 4px;
  border-top: 1px solid var(--color-border);
}

.btn-cancel {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
}

.btn-save {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: var(--color-primary);
}

.btn-cancel:disabled,
.btn-save:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
