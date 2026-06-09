import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import type { Reminder } from './types';

declare const self: ServiceWorkerGlobalScope;

// Preserve existing caching behavior exactly as the auto-generated SW did
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// SPA offline fallback — ensures deep links work without network
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'SHOW_REMINDER') {
    const { title, body, petId, reminderId } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-64x64.png',
        tag: `reminder-${reminderId}`,
        data: { petId },
      })
    );
  }
});

// Android Chrome (installed PWA only): best-effort background delivery
self.addEventListener('periodicsync', (event) => {
  if ((event as any).tag === 'check-reminders') {
    (event as any).waitUntil(checkAndFireReminders());
  }
});

async function checkAndFireReminders() {
  const { openDB } = await import('idb');
  const db = await openDB('cardipaw', 3);
  const reminders: Reminder[] = await db.getAll('reminders');
  const now = new Date();
  const day = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  for (const r of reminders) {
    if (!r.enabled || !r.days.includes(day as Reminder['days'][number])) continue;
    const [rh, rm] = r.time.split(':').map(Number);
    const reminderMin = rh * 60 + rm;
    // Fire if the reminder was due within the last 65 minutes (covers sync timing gaps)
    if (nowMin - reminderMin >= 0 && nowMin - reminderMin <= 65) {
      await self.registration.showNotification(r.title, {
        body: r.description ?? `Time to measure ${r.petName}'s breathing rate`,
        icon: '/pwa-192x192.png',
        badge: '/pwa-64x64.png',
        tag: `reminder-${r.id}`,
        data: { petId: r.petId },
      });
    }
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const petId = event.notification.data?.petId;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      const url = `/#/pets/${petId}`;
      const existing = list.find((c) => c.url.includes(petId));
      return existing ? existing.focus() : self.clients.openWindow(url);
    })
  );
});
