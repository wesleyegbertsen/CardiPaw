import { onMounted, onUnmounted } from 'vue';
import { getAllReminders } from '../services/db';

export function useReminderScheduler() {
  const fired = new Set<string>();
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
