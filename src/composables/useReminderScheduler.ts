import { onMounted, onUnmounted } from 'vue';
import { getAllReminders } from '../services/db';

const FIRED_KEY = 'cardipaw-fired-reminders';

function loadFired(): Set<string> {
  try {
    const raw = sessionStorage.getItem(FIRED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveFired(fired: Set<string>) {
  try {
    sessionStorage.setItem(FIRED_KEY, JSON.stringify([...fired]));
  } catch {}
}

export function useReminderScheduler() {
  const fired = loadFired();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const now = new Date();
    const day = now.getDay();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const minuteKey = now.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"

    let reminders;
    try {
      reminders = await getAllReminders();
    } catch {
      return;
    }

    for (const r of reminders) {
      if (!r.enabled || !r.days.includes(day as 0|1|2|3|4|5|6) || r.time !== hhmm) continue;
      const key = `${r.id}-${minuteKey}`;
      if (fired.has(key)) continue;
      fired.add(key);
      if (fired.size > 100) fired.clear();
      saveFired(fired);

      try {
        const reg = await navigator.serviceWorker.ready;
        reg.active?.postMessage({
          type: 'SHOW_REMINDER',
          title: r.title,
          body: r.description ?? `Time to measure ${r.petName}'s breathing rate`,
          petId: r.petId,
          reminderId: r.id,
        });
      } catch {
        // SW not ready — silently skip; next tick will retry
      }
    }
  }

  onMounted(() => {
    timer = setInterval(tick, 30_000);
    tick();
  });

  onUnmounted(() => {
    if (timer !== null) clearInterval(timer);
  });
}
