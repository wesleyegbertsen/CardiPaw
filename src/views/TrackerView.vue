<script setup lang="ts">
import { ref, computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, useId, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { returnTo } from '../router/returnTo';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import { useAudioBeep } from '../composables/useAudioBeep';
import { useHaptics } from '../composables/useHaptics';
import { useTrackerPrefs } from '../composables/useTrackerPrefs';
import { useWakeLock } from '../composables/useWakeLock';
import { useOnboarding } from '../composables/useOnboarding';
import { isCameraSupported, useCameraOptIn } from '../composables/useCameraOptIn';
import { useLandscapeTouch } from '../composables/useLandscapeTouch';
import { ImmersiveMode } from '../native/immersiveMode';
import { isNative } from '../utils/platform';
import type { CameraResult } from '../composables/useCameraBreath';
import { LazyRichTextEditor as RichTextEditor, preloadRichTextEditor } from '../components/LazyRichTextEditor';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import OnboardingModal from '../components/OnboardingModal.vue';
import RestStateToggle from '../components/RestStateToggle.vue';
import SlideToggle from '../components/SlideToggle.vue';
import { getRateStatus, isValidRate } from '../utils/rateStatus';
import { MEASUREMENT_DURATIONS, breathsPerMinute, type MeasurementSeconds } from '../utils/measurement';
import type { Reading } from '../types';

// Lazy: the camera's signal code stays out of the main chunk until the Camera pill is tapped.
const CameraCapture = defineAsyncComponent(() => import('../components/CameraCapture.vue'));

const route = useRoute();
const router = useRouter();
const petsStore = usePetsStore();
const readingsStore = useReadingsStore();
const { init: initAudio, playBeep, playDoneSound } = useAudioBeep();
const { isSupported: hapticsSupported, vibrateTap, vibrateDone } = useHaptics();
// Keeps the screen on while counting; released at the end and when leaving the tracker.
const wakeLock = useWakeLock();

const petId = route.params.id as string;
const pet = computed(() => petsStore.getPetById(petId));
const { soundEnabled, vibrationEnabled, durationSeconds } = useTrackerPrefs(petId);
const { hasSeenOnboarding, markSeen, hasSeenCameraOnboarding, markCameraSeen } = useOnboarding();
const showOnboarding = ref(!hasSeenOnboarding.value);
// Which steps the modal shows: the camera's in camera mode, the tap steps otherwise.
const onboardingVariant = ref<'tap' | 'camera'>('tap');

function openOnboarding() {
  onboardingVariant.value = mode.value === 'camera' ? 'camera' : 'tap';
  showOnboarding.value = true;
}

function closeOnboarding() {
  showOnboarding.value = false;
  if (onboardingVariant.value === 'camera') markCameraSeen();
  else markSeen();
  // When onboarding opened by itself on mount there is no focus to restore;
  // start keyboard users on the heart instead of <body>.
  nextTick(() => {
    if (!document.activeElement || document.activeElement === document.body) heartRef.value?.focus();
  });
}

type Phase = 'idle' | 'running' | 'done';
type Mode = 'guided' | 'manual' | 'camera';
const phase = ref<Phase>('idle');
const mode = ref<Mode>('guided');
// Experimental: the Camera pill needs the Settings opt-in and getUserMedia.
const { enabled: cameraEnabled } = useCameraOptIn();
const modes = computed<Mode[]>(() =>
  cameraEnabled.value && isCameraSupported() ? ['guided', 'manual', 'camera'] : ['guided', 'manual'],
);
// The camera's suggestion; saved only when the owner confirms it.
const cameraResult = ref<CameraResult | null>(null);
// Measure again remounts the capture with the camera opening by itself.
const cameraReopen = ref(false);
// Placing or capturing: the mode bar would cover the preview.
const cameraBusy = ref(false);
// Capturing only: a running count the leave guard asks about.
const cameraCapturing = ref(false);
// A phone propped sideways to film the pet: the camera mode fills the screen, the preview on
// the left and the steps on the right, over the app header and the bottom nav.
const landscapeTouch = useLandscapeTouch();
const immersive = computed(() => mode.value === 'camera' && landscapeTouch.value);
const saveChoice = ref<'camera' | 'taps'>('camera');
const saveChoiceLabelId = useId();
// Length of the current measurement: the pet's chosen length, fixed when it starts.
const runSeconds = ref<MeasurementSeconds>(durationSeconds.value);
const timeLeft = ref<number>(durationSeconds.value);
// Wall-clock end of the measurement. Timers are throttled in background tabs, on a
// locked screen or in battery saver, so the count is timed by the clock, not by ticks.
let endsAt = 0;
const clickCount = ref(0);
const intervalId = ref<ReturnType<typeof setInterval> | null>(null);
const isPulsing = ref(false);
const saving = ref(false);
const restState = ref<'resting' | 'sleeping' | undefined>(undefined);
const notes = ref('');
const manualRate = ref(0);
const manualValid = computed(() => isValidRate(manualRate.value));
const saveError = ref(false);
const loadError = ref(false);
const soundLabelId = useId();
const vibrationLabelId = useId();
const isManualMode = computed(() => mode.value === 'manual');
const heartRef = ref<HTMLButtonElement | null>(null);
const resultRef = ref<HTMLElement | null>(null);

function switchMode(next: Mode) {
  // Clicking the active mode again must not wipe what was entered
  if (mode.value === next) return;
  mode.value = next;
  restState.value = undefined;
  notes.value = '';
  manualRate.value = 0;
  saveError.value = false;
  cameraResult.value = null;
  cameraReopen.value = false;
  cameraBusy.value = false;
  cameraCapturing.value = false;
  saveChoice.value = 'camera';
  // The camera steps open by themselves the first time, like the tap steps on the first visit.
  if (next === 'camera' && !hasSeenCameraOnboarding.value) openOnboarding();
}

// Like closeOnboarding: start keyboard and screen-reader users on the heart, not on <body>.
function tapInstead() {
  switchMode('guided');
  nextTick(() => heartRef.value?.focus());
}

function measureAgain() {
  cameraResult.value = null;
  cameraReopen.value = true;
  saveError.value = false;
  saveChoice.value = 'camera';
}

// Like the guided done state: park focus on the suggestion so it is read out.
// Not while the leave dialog is open: focus stays in it, and Cancel moves it here.
watch(cameraResult, (r) => {
  if (r) nextTick(() => {
    if (!answerLeave.value) resultRef.value?.focus();
  });
});

const resultRate = computed(() => breathsPerMinute(clickCount.value, runSeconds.value));

function handleHeartClick() {
  if (phase.value === 'idle') {
    startTracking();
  } else if (phase.value === 'running') {
    registerBreath();
  }
}

// Holding Enter auto-repeats clicks on a button; only count deliberate presses
function onHeartEnter(e: KeyboardEvent) {
  if (e.repeat) e.preventDefault();
}

function startTracking() {
  runSeconds.value = durationSeconds.value;
  endsAt = Date.now() + runSeconds.value * 1000;
  timeLeft.value = runSeconds.value;
  phase.value = 'running';
  wakeLock.acquire();
  clickCount.value = 1; // first click counts as the first breath
  if (soundEnabled.value) playBeep(880, 0.15, 0.3);
  if (vibrationEnabled.value) vibrateTap();
  triggerPulse();
  // Ticks more often than once a second: a timer can fire a millisecond before the clock
  // says the time is up, and the count must not run on for another full second.
  intervalId.value = setInterval(tick, 250);
}

function registerBreath() {
  if (finishIfOver()) return; // a tap after the time is up must not count
  clickCount.value++;
  if (soundEnabled.value) playBeep(880, 0.15, 0.3);
  if (vibrationEnabled.value) vibrateTap();
  triggerPulse();
}

function tick() {
  finishIfOver();
}

// Updates the seconds left from the clock and ends the measurement once time is up,
// however late this runs. Returns whether it has ended. Capped at the measurement's
// length so a clock set back mid-measurement cannot show more time than it has.
function finishIfOver(): boolean {
  timeLeft.value = Math.min(
    runSeconds.value,
    Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)),
  );
  if (timeLeft.value > 0) return false;
  stopTracking();
  return true;
}

function stopTracking() {
  if (intervalId.value !== null) {
    clearInterval(intervalId.value);
    intervalId.value = null;
  }
  phase.value = 'done';
  wakeLock.release();
  if (soundEnabled.value) playDoneSound();
  if (vibrationEnabled.value) vibrateDone();
  // The heart button is gone; park focus on the result (not on Save) so it is
  // read out and further key presses meant as breaths can't trigger an action.
  // Not while the leave dialog is open: focus stays in it, and Cancel moves it here.
  nextTick(() => {
    if (!answerLeave.value) resultRef.value?.focus();
  });
}

function triggerPulse() {
  isPulsing.value = true;
  setTimeout(() => { isPulsing.value = false; }, 180);
}

type MeasuredFields = Pick<Reading, 'rate' | 'clickCount' | 'source' | 'durationSeconds'>;

// What the reading records about how it was measured; null in camera mode without a suggestion.
function measuredFields(): MeasuredFields | null {
  switch (mode.value) {
    case 'manual':
      return { rate: manualRate.value, clickCount: 0, source: 'manual', durationSeconds: undefined };
    case 'camera': {
      const cam = cameraResult.value;
      if (!cam) return null;
      // A tapped count saved from the camera screen is an ordinary guided reading over the camera's window.
      if (cam.taps !== null && saveChoice.value === 'taps') {
        return { rate: breathsPerMinute(cam.taps, cam.seconds), clickCount: cam.taps, source: undefined, durationSeconds: cam.seconds };
      }
      return { rate: cam.rate, clickCount: 0, source: 'camera', durationSeconds: cam.seconds };
    }
    case 'guided':
      return { rate: resultRate.value, clickCount: clickCount.value, source: undefined, durationSeconds: runSeconds.value };
  }
}

async function saveReading() {
  if (saving.value || (mode.value === 'manual' && !manualValid.value)) return;
  saving.value = true;
  saveError.value = false;
  try {
    const measured = measuredFields();
    if (!measured) return;
    await readingsStore.addReading({
      petId,
      date: new Date().toISOString(),
      ...measured,
      restState: restState.value,
      notes: notes.value || undefined,
    });
    // The user confirmed leaving while this saved: stay wherever they went, also when
    // that page is still opening and this view is not gone yet.
    if (unmounted || leaving) return;
    // Saved while the leave dialog asks: nothing is lost any more, so let them go.
    if (answerLeave.value) {
      answerLeave.value(true);
      return;
    }
    leaveForPet();
  } catch (e) {
    console.error('Saving reading failed', e);
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

function discard() {
  saveError.value = false;
  leaveForPet();
}

// Header back arrow: an ordinary way out, so the leave guard asks first.
function goBack() {
  returnTo(router, { name: 'pet', params: { id: petId } });
}

// Leaving on purpose (saved, or Discard): the leave guard lets it go.
let leaving = false;
function leaveForPet() {
  leaving = true;
  returnTo(router, { name: 'pet', params: { id: petId } });
}

// What leaving would throw away: a count running or finished but not saved, a manual
// entry with anything filled in (v-model.number gives '' for a cleared rate), or a camera
// capture running or its suggestion not confirmed (placing or an abstain loses nothing).
const hasUnsaved = computed(() => {
  if (isManualMode.value) return !!manualRate.value || notes.value !== '' || restState.value !== undefined;
  if (mode.value === 'camera') return cameraCapturing.value || cameraResult.value !== null;
  return phase.value !== 'idle';
});

// The leave dialog's Discard sits over the heart on small screens: after a stray back
// swipe mid-count, the next breath tap would land on it and throw the count away.
const LEAVE_DISCARD_DELAY_MS = 500;

// Answers the open leave dialog (true leaves, false stays); null while none is open.
const answerLeave = ref<((leave: boolean) => void) | null>(null);
let pendingLeave: Promise<boolean> | null = null;

function confirmLeave(): boolean | Promise<boolean> {
  if (leaving || !hasUnsaved.value) return true;
  // The help is stacked above this dialog and would hide it (and take Escape last).
  if (showOnboarding.value) closeOnboarding();
  // A second back while asking waits for the same answer instead of a second dialog.
  pendingLeave ??= new Promise<boolean>((resolve) => {
    answerLeave.value = (leave) => {
      if (leave) leaving = true;
      answerLeave.value = null;
      pendingLeave = null;
      resolve(leave);
    };
  });
  return pendingLeave;
}
// Back gestures, browser back, the bottom nav and reminder taps. Another pet's tracker is
// the same route, so vue-router runs update guards for it, not leave guards, while App's
// keyed RouterView still remounts this view and would drop the count.
onBeforeRouteLeave(confirmLeave);
onBeforeRouteUpdate(confirmLeave);

function stayOnTracker() {
  answerLeave.value?.(false);
  // The dialog hands focus back to where it was; if the count ended behind it, that was
  // the heart, which is gone. Park it on the result, as the end of a count does.
  nextTick(() => {
    const ended = phase.value === 'done' || cameraResult.value !== null;
    if (!ended || document.activeElement !== document.body) return;
    resultRef.value?.focus();
  });
}

function reset() {
  if (intervalId.value !== null) {
    clearInterval(intervalId.value);
    intervalId.value = null;
  }
  phase.value = 'idle';
  timeLeft.value = durationSeconds.value;
  clickCount.value = 0;
  isPulsing.value = false;
  restState.value = undefined;
  notes.value = '';
  manualRate.value = 0;
  saveError.value = false;
  nextTick(() => heartRef.value?.focus());
}

// In the app the system bars go too. Not requestFullscreen on the website: it needs a tap,
// and turning the phone is not one; covering the app's own chrome is the full screen there.
let barsHidden = false;
async function hideSystemBars(hide: boolean) {
  if (!isNative() || hide === barsHidden) return;
  barsHidden = hide;
  try {
    await (hide ? ImmersiveMode.enter() : ImmersiveMode.exit());
  } catch (e) {
    console.warn(hide ? 'Hiding the system bars failed' : 'Showing the system bars failed', e);
  }
}
watch(immersive, (on) => void hideSystemBars(on), { immediate: true });

let unmounted = false;

onMounted(async () => {
  initAudio();
  // Fetch the notes editor while the user counts, so the done screen doesn't wait for it.
  preloadRichTextEditor();
  // Opened directly (reload, shortcut): the app-level load may still be running or may have
  // failed. loadPets() joins a running load or retries a failed one.
  if (pet.value) return;
  try {
    await petsStore.loadPets();
  } catch (e) {
    console.error('Loading pet failed', e);
    loadError.value = true;
    return;
  }
  // Unknown id: a reading saved here would belong to no pet and never show up anywhere.
  // Skipped once the user has left, so a slow load can't pull them away from another page.
  if (!pet.value && !unmounted) router.replace({ name: 'home' });
});

onUnmounted(() => {
  unmounted = true;
  void hideSystemBars(false);
  if (intervalId.value !== null) clearInterval(intervalId.value);
});
</script>

<template>
  <!-- Full screen sideways: dark like a camera app, whatever the app theme -->
  <div
    class="tracker"
    :class="[`phase-${phase}`, { immersive }]"
    :data-theme="immersive ? 'dark' : undefined"
  >
    <header class="tracker-header">
      <button class="back-btn" @click="goBack" :aria-label="$t('common.back')">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>
      <span class="pet-name-label">{{ pet?.name }}</span>
      <button class="help-btn" @click="openOnboarding" :aria-label="$t('onboarding.howItWorks')">?</button>
    </header>

    <OnboardingModal v-if="showOnboarding" :variant="onboardingVariant" @close="closeOnboarding" />

    <ConfirmDialog
      v-if="answerLeave"
      :message="$t('tracker.leaveConfirm')"
      :confirm-label="$t('common.discard')"
      :confirm-delay-ms="LEAVE_DISCARD_DELAY_MS"
      @confirm="answerLeave?.(true)"
      @cancel="stayOnTracker"
    />

    <p v-if="loadError" class="save-error load-error" role="alert">{{ $t('common.loadError') }}</p>

    <!-- Needs the pet: its thresholds rate a manual entry and saving files the reading under it. -->
    <div v-else-if="pet" class="tracker-main">
    <!-- Mode toggle: absolutely positioned so it overlays the body without affecting its height -->
    <div v-if="phase === 'idle' && !cameraBusy && !cameraResult" class="mode-toggle-bar">
      <div class="mode-toggle" role="group" :aria-label="$t('tracker.modeLabel')">
        <div
          class="mode-toggle-indicator"
          :style="{ '--count': modes.length, '--index': modes.indexOf(mode) }"
          aria-hidden="true"
        ></div>
        <button
          v-for="m in modes"
          :key="m"
          class="mode-pill"
          :class="{ active: mode === m }"
          :aria-pressed="mode === m"
          @click="switchMode(m)"
        >{{ $t('tracker.' + m) }}</button>
      </div>
    </div>

    <!-- Manual entry mode -->
    <div v-if="isManualMode" class="tracker-body done-body manual-body">
      <div class="manual-rate-field">
        <input
          class="manual-rate-input"
          type="number"
          v-model.number="manualRate"
          min="1"
          max="200"
          placeholder="0"
          inputmode="numeric"
          :aria-label="$t('reading.rateLabel')"
          autofocus
        />
        <span class="manual-rate-unit" aria-hidden="true">{{ $t('tracker.unitSpaced') }}</span>
        <span
          class="rate-badge"
          :class="getRateStatus(manualRate, pet).cssClass"
          :style="{ visibility: manualValid ? 'visible' : 'hidden' }"
        >{{ $t('status.' + getRateStatus(manualRate, pet).cssClass) }}</span>
      </div>

      <RestStateToggle v-model="restState" />

      <div class="notes-wrapper">
        <RichTextEditor v-model="notes" :label="$t('reading.notesLabel')" />
      </div>

      <div class="done-actions">
        <p v-if="saveError" class="save-error" role="alert">{{ $t('tracker.saveError') }}</p>
        <button class="btn-save" @click="saveReading" :disabled="saving || !manualValid">
          {{ saving ? $t('common.saving') : $t('tracker.saveReading') }}
        </button>
        <button class="btn-discard" @click="discard">{{ $t('common.discard') }}</button>
      </div>
    </div>

    <!-- Camera (experimental): the capture, then its suggestion as a card the owner confirms -->
    <div v-else-if="mode === 'camera'" class="tracker-body done-body camera-body" :class="{ 'with-bar': !cameraBusy && !cameraResult }">
      <CameraCapture
        v-if="!cameraResult"
        :pet="pet"
        :auto-open="cameraReopen"
        :landscape="immersive"
        @result="cameraResult = $event"
        @tap-instead="tapInstead"
        @busy="cameraBusy = $event"
        @capturing="cameraCapturing = $event"
      />
      <template v-else>
        <!-- Sideways the number takes the camera's place; the card keeps the read-out copy -->
        <div v-if="immersive" class="camera-result-preview" aria-hidden="true">
          <div class="result-number">{{ cameraResult.rate }}</div>
          <div class="result-label">{{ $t('common.breathsPerMin') }}</div>
        </div>
        <!-- Upright it gives way (display: contents) and the card is one column -->
        <div class="camera-result">
          <span class="experimental-chip">{{ $t('camera.experimental') }}</span>
          <p class="result-title">{{ $t('camera.resultTitle') }}</p>
          <div ref="resultRef" class="result" tabindex="-1" aria-live="polite" aria-atomic="true">
            <div class="result-number">{{ cameraResult.rate }}</div>
            <div class="result-label">{{ $t('common.breathsPerMin') }}</div>
          </div>
          <span class="rate-badge" :class="getRateStatus(cameraResult.rate, pet).cssClass">
            {{ $t('status.' + getRateStatus(cameraResult.rate, pet).cssClass) }}
          </span>
          <p class="result-note">
            {{ $t('camera.resultNote', { seconds: cameraResult.seconds, lo: cameraResult.interval[0], hi: cameraResult.interval[1] }) }}
          </p>
          <div v-if="cameraResult.taps !== null" class="save-choice" role="group" :aria-labelledby="saveChoiceLabelId">
            <span :id="saveChoiceLabelId" class="toggle-label">
              {{ $t('camera.yourCount', { n: breathsPerMinute(cameraResult.taps, cameraResult.seconds) }) }}
            </span>
            <div class="length-toggle">
              <button
                type="button"
                :aria-pressed="saveChoice === 'camera'"
                class="length-pill"
                :class="{ active: saveChoice === 'camera' }"
                @click="saveChoice = 'camera'"
              >{{ $t('camera.saveCamera') }}</button>
              <button
                type="button"
                :aria-pressed="saveChoice === 'taps'"
                class="length-pill"
                :class="{ active: saveChoice === 'taps' }"
                @click="saveChoice = 'taps'"
              >{{ $t('camera.saveTaps', { n: breathsPerMinute(cameraResult.taps, cameraResult.seconds) }) }}</button>
            </div>
          </div>

          <RestStateToggle v-model="restState" />

          <div class="notes-wrapper">
            <RichTextEditor v-model="notes" :label="$t('reading.notesLabel')" />
          </div>

          <div class="done-actions">
            <p v-if="saveError" class="save-error" role="alert">{{ $t('tracker.saveError') }}</p>
            <button class="btn-save" @click="saveReading" :disabled="saving">
              {{ saving ? $t('common.saving') : $t('camera.confirm') }}
            </button>
            <button class="btn-retry" @click="measureAgain">{{ $t('camera.measureAgain') }}</button>
            <button class="btn-discard" @click="discard">{{ $t('common.discard') }}</button>
          </div>
        </div>
      </template>
    </div>

    <!-- Guided: idle and running share one body so the heart button (and keyboard focus on it) persists -->
    <div v-else-if="phase !== 'done'" class="tracker-body tap-area" @click="handleHeartClick">
      <div class="body-top">
        <p v-if="phase === 'idle'" class="instruction">{{ $t('tracker.instruction') }}</p>
        <div v-else class="timer-ring">
          <svg viewBox="0 0 120 120" class="ring-svg">
            <circle cx="60" cy="60" r="54" class="ring-track" />
            <circle
              cx="60" cy="60" r="54"
              class="ring-progress"
              :stroke-dashoffset="(339.3 * timeLeft) / runSeconds"
            />
          </svg>
          <div class="timer-text">
            <span class="timer-number">{{ timeLeft }}</span>
            <span class="timer-unit">{{ $t('tracker.secondsUnit') }}</span>
          </div>
        </div>
      </div>

      <button
        ref="heartRef"
        class="heart-btn"
        :class="{ pulsing: isPulsing }"
        :aria-label="phase === 'idle' ? $t('tracker.tapToStart') : $t('tracker.tapForBreath')"
        @keydown.enter="onHeartEnter"
      >
        <svg class="heart-svg" viewBox="0 0 100 90" fill="currentColor" aria-hidden="true">
          <path d="M50 85 C50 85 5 55 5 28 C5 13 17 3 30 3 C39 3 47 8 50 15 C53 8 61 3 70 3 C83 3 95 13 95 28 C95 55 50 85 50 85Z"/>
        </svg>
      </button>

      <!-- Mounted in idle too (empty), so the first count is announced as a change -->
      <p class="sr-only" aria-live="polite" aria-atomic="true">
        {{ phase === 'running' ? `${clickCount} ${$t('tracker.breathsCounted')}` : '' }}
      </p>

      <div class="body-bottom">
        <template v-if="phase === 'idle'">
          <p class="tap-hint">{{ $t('tracker.tapAnywhereToStart') }}</p>
          <!-- Full width, so a tap just beside the pills doesn't start a measurement -->
          <div class="length-row" @click.stop>
            <div class="length-toggle" role="group" :aria-label="$t('tracker.lengthLabel')">
              <button
                v-for="s in MEASUREMENT_DURATIONS"
                :key="s"
                type="button"
                class="length-pill"
                :class="{ active: durationSeconds === s }"
                :aria-pressed="durationSeconds === s"
                @click="durationSeconds = s"
              >{{ $t('tracker.lengthOption', { n: s }) }}</button>
            </div>
          </div>
          <div class="option-row" @click.stop>
            <span :id="soundLabelId" class="toggle-label">{{ $t('tracker.sound') }}</span>
            <SlideToggle v-model="soundEnabled" :labelledby="soundLabelId" />
          </div>
          <div v-if="hapticsSupported" class="option-row" @click.stop>
            <span :id="vibrationLabelId" class="toggle-label">{{ $t('tracker.vibration') }}</span>
            <SlideToggle v-model="vibrationEnabled" :labelledby="vibrationLabelId" />
          </div>
        </template>
        <div v-else class="breath-count">
          <span class="count-number">{{ clickCount }}</span>
          <span class="count-label">{{ $t('tracker.breathsCounted') }}</span>
        </div>
      </div>
    </div>

    <!-- Done state -->
    <div v-else class="tracker-body done-body">
      <div class="done-icon">
        <svg viewBox="0 0 100 90" fill="currentColor" width="80" height="80">
          <path d="M50 85 C50 85 5 55 5 28 C5 13 17 3 30 3 C39 3 47 8 50 15 C53 8 61 3 70 3 C83 3 95 13 95 28 C95 55 50 85 50 85Z"/>
        </svg>
      </div>

      <div ref="resultRef" class="result" tabindex="-1" aria-live="polite" aria-atomic="true">
        <div class="result-number">{{ resultRate }}</div>
        <div class="result-label">{{ $t('common.breathsPerMin') }}</div>
      </div>

      <p class="result-note">{{ $t('tracker.basedOn', { n: clickCount, seconds: runSeconds }, clickCount) }}</p>

      <RestStateToggle v-model="restState" />

      <div class="notes-wrapper">
        <RichTextEditor v-model="notes" :label="$t('reading.notesLabel')" />
      </div>

      <div class="done-actions">
        <p v-if="saveError" class="save-error" role="alert">{{ $t('tracker.saveError') }}</p>
        <button class="btn-save" @click="saveReading" :disabled="saving">
          {{ saving ? $t('common.saving') : $t('tracker.saveResult') }}
        </button>
        <button class="btn-retry" @click="reset">{{ $t('tracker.tryAgain') }}</button>
        <button class="btn-discard" @click="discard">{{ $t('common.discard') }}</button>
      </div>
    </div>
    </div>

    <div v-else class="loading" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <span class="sr-only">{{ $t('common.loading') }}</span>
    </div>
  </div>
</template>

<style scoped>
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

.tracker {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}

.tracker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.back-btn {
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  padding: 4px;
}

.help-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
}

.pet-name-label {
  font-size: 16px;
  font-weight: 600;
}

.tracker-body {
  flex: 1;
  display: grid;
  grid-template-rows: 1fr auto 1fr;
  justify-items: center;
  padding: 32px 24px;
}

/* Whole body acts as the tap target in idle/running; suppress selection and
   double-tap zoom so rapid breath taps register cleanly */
.tap-area {
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.body-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 32px;
}

.body-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding-top: 32px;
}

.instruction {
  font-size: 15px;
  color: var(--color-text-muted);
  text-align: center;
  max-width: 280px;
  line-height: 1.5;
}

/* Heart button */
.heart-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  transition: transform 0.1s;
  -webkit-tap-highlight-color: transparent;
}

.heart-btn .heart-svg {
  width: 140px;
  height: 128px;
  fill: var(--color-primary);
  filter: drop-shadow(0 8px 24px rgba(224, 92, 122, 0.35));
  transition: transform 0.15s ease, filter 0.15s;
}

.heart-btn.pulsing .heart-svg {
  transform: scale(1.18);
  filter: drop-shadow(0 12px 32px rgba(224, 92, 122, 0.55));
}

.heart-btn:active .heart-svg {
  transform: scale(0.93);
}

.tap-hint {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
}

.length-row {
  align-self: stretch;
  display: flex;
  justify-content: center;
  /* A margin of safety around the small pills: a tap just beside or between
     them must not start a measurement. The negative margin keeps the layout
     unchanged; the padding reaches into the gaps around the row. */
  padding: 6px 16px;
  margin: -6px 0;
}
.length-toggle {
  display: inline-flex;
  /* Surface, not bg: it sits on the page background, unlike the mode toggle */
  background: var(--color-surface);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: 3px;
}
.length-pill {
  height: 30px;
  padding: 0 14px;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: transparent;
  white-space: nowrap;
  transition: background-color 0.2s, color 0.2s;
}
.length-pill.active {
  background: var(--color-primary);
  color: #fff;
}

/* Timer ring */
.timer-ring {
  position: relative;
  width: 120px;
  height: 120px;
}

.ring-svg {
  width: 120px;
  height: 120px;
  transform: rotate(-90deg);
}

.ring-track {
  fill: none;
  stroke: var(--color-border);
  stroke-width: 8;
}

.ring-progress {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 8;
  stroke-linecap: round;
  stroke-dasharray: 339.3;
  transition: stroke-dashoffset 0.8s linear;
}

.timer-text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.timer-number {
  font-size: 32px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1;
}

.timer-unit {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

/* Breath count */
.breath-count {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.count-number {
  font-size: 48px;
  font-weight: 800;
  color: var(--color-text);
  line-height: 1;
}

.count-label {
  font-size: 13px;
  color: var(--color-text-muted);
}

/* Done state */
.done-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.done-icon .heart-svg,
.done-icon svg {
  fill: var(--color-primary);
  opacity: 0.9;
}

.result {
  text-align: center;
}

/* Focused programmatically when the timer ends; not a control */
.result:focus {
  outline: none;
}

.result-number {
  font-size: 72px;
  font-weight: 800;
  color: var(--color-primary);
  line-height: 1;
}

.result-label {
  font-size: 16px;
  color: var(--color-text-muted);
  margin-top: 4px;
}

.result-note {
  font-size: 13px;
  color: var(--color-text-muted);
}

.notes-wrapper {
  width: 100%;
  max-width: 320px;
}

.done-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 320px;
}

.save-error {
  margin: 0;
  font-size: 13px;
  color: var(--color-danger-text);
  background: var(--color-danger-bg);
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  text-align: center;
}

.load-error {
  margin: 16px;
}

.btn-save {
  height: 52px;
  background: var(--color-primary);
  color: #fff;
  border-radius: var(--radius-md);
  font-size: 16px;
  font-weight: 600;
  transition: opacity 0.15s;
}

.btn-save:disabled {
  opacity: 0.5;
}

.btn-retry {
  height: 48px;
  background: var(--color-bg);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text);
}

.btn-discard {
  height: 44px;
  font-size: 14px;
  color: var(--color-text-muted);
}

/* Sound toggle */
.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}

.toggle-label {
  font-size: 13px;
  color: var(--color-text-muted);
}

/* tracker-main fills remaining height; mode-toggle-bar floats above it */
.tracker-main {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
}

.mode-toggle-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1;
  display: flex;
  justify-content: center;
  padding: 12px 24px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

/* Mode toggle pill */
.mode-toggle {
  position: relative;
  display: flex;
  background: var(--color-bg);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: 3px;
  gap: 0;
}

/* Sized and placed by the pill count and the active index (set inline), for any number of pills */
.mode-toggle-indicator {
  position: absolute;
  top: 3px;
  left: 3px;
  width: calc((100% - 6px) / var(--count));
  height: calc(100% - 6px);
  background: var(--color-primary);
  border-radius: var(--radius-full);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  transform: translateX(calc(var(--index) * 100%));
  pointer-events: none;
}

.mode-pill {
  flex: 1;
  height: 30px;
  padding: 0 16px;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: transparent;
  position: relative;
  z-index: 1;
  transition: color 0.2s;
  white-space: nowrap;
}

.mode-pill.active {
  color: #fff;
}

/* Manual body: centered in the space below the bar, scrollable on short screens */
.manual-body {
  padding-top: 88px; /* bar height + breathing room — centers content in remaining space */
  overflow-y: auto;
}

/* Camera body: the bar is gone while placing/capturing, so the preview gets the top of the screen */
.camera-body {
  overflow-y: auto;
}

.camera-body.with-bar {
  padding-top: 88px;
}

.result-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-muted);
  margin: 0;
}

.save-choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
/* The length selector's bordered track, but the labels are longer than "30 s": on a
   narrow phone a pill may take two lines rather than push the track off the card. */
.save-choice .length-toggle {
  max-width: 100%;
}
.save-choice .length-pill {
  flex: 0 1 auto;
  min-width: 0;
  height: auto;
  min-height: 30px;
  padding: 4px 14px;
  white-space: normal;
  line-height: 1.3;
  text-align: center;
}

/* Manual entry form */
.manual-rate-field {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.manual-rate-input {
  width: 120px;
  height: 64px;
  padding: 0 16px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 36px;
  font-weight: 800;
  text-align: center;
}

.manual-rate-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.manual-rate-input::-webkit-inner-spin-button,
.manual-rate-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
}

.manual-rate-unit {
  font-size: 13px;
  color: var(--color-text-muted);
}

.rate-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: var(--radius-full);
}

.rate-badge.normal {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.rate-badge.warning {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.rate-badge.danger {
  background: var(--color-danger-bg);
  color: var(--color-danger-text);
}

.camera-result {
  display: contents;
}

/*
 * Sideways in camera mode: a layer over the app header, the bottom nav (100) and the update
 * notice (450), under the dialogs (500 and up) so the leave prompt and the help still show.
 * Two columns: the 4:3 preview as tall as the screen allows (at most 60% of its width), and
 * the header, the mode pills and the steps beside it. The tracker's wrappers give way so
 * their parts land in the grid; CameraCapture puts its regions in the preview and panel areas.
 */
.tracker.immersive {
  --immersive-pad: 8px;
  --preview-width: min(
    calc((100vh - var(--safe-top) - var(--safe-bottom) - 2 * var(--immersive-pad)) * 4 / 3),
    60vw
  );
  --preview-width: min(
    calc((100dvh - var(--safe-top) - var(--safe-bottom) - 2 * var(--immersive-pad)) * 4 / 3),
    60vw
  );
  position: fixed;
  inset: 0;
  z-index: 480;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--preview-width) minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  grid-template-areas:
    'preview header'
    'preview modes'
    'preview panel';
  column-gap: 16px;
  padding: calc(var(--safe-top) + var(--immersive-pad)) calc(var(--safe-right) + 12px)
    calc(var(--safe-bottom) + var(--immersive-pad)) calc(var(--safe-left) + 12px);
  background: #000;
  /* body resolved its colour with the app theme; text here inherits this one instead */
  color: var(--color-text);
}

.immersive .tracker-main,
.immersive .camera-body {
  display: contents;
}

.immersive .tracker-header {
  grid-area: header;
  gap: 8px;
  padding: 0;
  background: none;
  border: 0;
}

.immersive .back-btn,
.immersive .help-btn {
  min-width: 44px;
  min-height: 44px;
  justify-content: center;
}

.immersive .pet-name-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.immersive .mode-toggle-bar {
  grid-area: modes;
  position: static;
  padding: 4px 0 8px;
  background: none;
  border: 0;
}

.immersive .mode-pill {
  height: 44px;
}

.immersive .camera-result-preview {
  grid-area: preview;
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  text-align: center;
}

.immersive .camera-result-preview .result-number {
  font-size: 96px;
}

.immersive .camera-result {
  grid-area: panel;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0 8px;
}

/* Centred while it fits, from the top once it scrolls */
.immersive .camera-result::before,
.immersive .camera-result::after {
  content: '';
  margin: auto 0;
}

/* The number is on the left; the card's copy stays for the read-out and the focus */
.immersive .camera-result .result {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.immersive .camera-result .notes-wrapper,
.immersive .camera-result .done-actions {
  max-width: none;
}

.immersive .save-choice .length-pill,
.immersive :deep(.rest-btn) {
  min-height: 44px;
}
</style>
