import { onScopeDispose } from 'vue';

// Longer than the done chime (its last note ends 0.71 s after it starts), so leaving the
// tracker right as the count ends doesn't cut the chime off.
const SUSPEND_DELAY_MS = 1000;

// One context for the whole app. Browsers cap how many may exist, and in the Android app
// (which needs no tap to start audio) a running context renders silence until it is
// suspended or closed. It is created on the first sound, suspended between tracker visits,
// and never closed.
let ctx: AudioContext | null = null;
// Callers whose component is still mounted; the context is suspended soon after none are left.
let users = 0;
let suspendTimer: ReturnType<typeof setTimeout> | undefined;

function getContext(): AudioContext {
  // The browser can close a context on its own, and a closed one never plays again.
  if (!ctx || ctx.state === 'closed') {
    ctx = new AudioContext();
  }
  return ctx;
}

// A sound is a nicety: a context the browser refuses to create or resume must not stop the
// count, so the failure is logged and the count goes on.
function play(schedule: (audioCtx: AudioContext) => void): void {
  let audioCtx: AudioContext;
  try {
    audioCtx = getContext();
  } catch (e) {
    console.warn('Playing a sound failed', e);
    return;
  }
  audioCtx
    .resume()
    .then(() => schedule(audioCtx))
    .catch((e: unknown) => console.warn('Playing a sound failed', e));
}

// Resumes the context as the tracker opens, so the first beep plays as promptly as the rest.
function init(): void {
  play(() => {});
}

function playBeep(frequency = 880, duration = 0.5, volume = 0.3): void {
  play((audioCtx) => {
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';

    const start = audioCtx.currentTime;
    gainNode.gain.setValueAtTime(volume, start);
    gainNode.gain.exponentialRampToValueAtTime(0.001, start + duration);

    oscillator.start(start);
    oscillator.stop(start + duration);
  });
}

function playDoneSound(): void {
  play((audioCtx) => {
    const notes = [523, 659, 784]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const start = audioCtx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.start(start);
      osc.stop(start + 0.35);
    });
  });
}

function suspendIfIdle(): void {
  // Nothing to do for a context that was never created, is already suspended or closed, or
  // that the system holds ('interrupted' on iOS, during a call).
  if (ctx?.state !== 'running') return;
  ctx.suspend().catch((e: unknown) => console.warn('Suspending audio failed', e));
}

/**
 * The tracker's sounds, played through one AudioContext shared by every caller. The context
 * is suspended shortly after the last caller's component unmounts, so it renders nothing
 * between visits, and the next sound resumes it.
 */
export function useAudioBeep() {
  users++;
  // Back within the delay (the next visit): keep the context running.
  clearTimeout(suspendTimer);
  onScopeDispose(() => {
    users--;
    if (users > 0) return;
    suspendTimer = setTimeout(suspendIfIdle, SUSPEND_DELAY_MS);
  });
  return { init, playBeep, playDoneSound };
}
