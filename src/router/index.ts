import { createRouter, createWebHashHistory, type RouteComponent } from 'vue-router';
import HomeView from '../views/HomeView.vue';

// Home is the entry screen and stays in the main bundle; every other view is its own
// chunk, loaded on first navigation (and precached by the service worker for offline use).

class ViewChunkError extends Error {
  constructor(readonly cause: unknown) {
    super(`Failed to load view chunk: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'ViewChunkError';
  }
}

function lazyView(loader: () => Promise<{ default: RouteComponent }>) {
  return () => loader().catch((err: unknown) => {
    throw new ViewChunkError(err);
  });
}

const AddEditPetView = lazyView(() => import('../views/AddEditPetView.vue'));
const PetDetailView = lazyView(() => import('../views/PetDetailView.vue'));
const TrackerView = lazyView(() => import('../views/TrackerView.vue'));
const ReadingView = lazyView(() => import('../views/ReadingView.vue'));
const EditReadingView = lazyView(() => import('../views/EditReadingView.vue'));
const NoteView = lazyView(() => import('../views/NoteView.vue'));
const AddEditNoteView = lazyView(() => import('../views/AddEditNoteView.vue'));
const SettingsView = lazyView(() => import('../views/SettingsView.vue'));
const ShareView = lazyView(() => import('../views/ShareView.vue'));

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/pets/add', name: 'pet-add', component: AddEditPetView },
    { path: '/pets/:id', name: 'pet', component: PetDetailView },
    { path: '/pets/:id/edit', name: 'pet-edit', component: AddEditPetView },
    { path: '/pets/:id/track', name: 'tracker', component: TrackerView },
    { path: '/pets/:id/readings/:readingId', name: 'reading', component: ReadingView },
    { path: '/pets/:id/readings/:readingId/edit', name: 'reading-edit', component: EditReadingView },
    { path: '/pets/:id/notes/add', name: 'note-add', component: AddEditNoteView },
    { path: '/pets/:id/notes/:noteId', name: 'note', component: NoteView },
    { path: '/pets/:id/notes/:noteId/edit', name: 'note-edit', component: AddEditNoteView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/share', name: 'share', component: ShareView },
  ],
});

// A view chunk can fail to load, e.g. when a deploy replaced the hashed files and this tab
// still runs the previous index.html. Reload at the target route so the browser picks up the
// current build. Reloads are spaced out so a chunk that keeps failing can't cause a loop.
const RELOAD_KEY = 'cardipaw-chunk-reload-at';
const RELOAD_COOLDOWN_MS = 10_000;

router.onError((err, to) => {
  if (!(err instanceof ViewChunkError)) return;
  // Dev: surface the real error (e.g. a compile error) instead of reloading.
  // Offline: a reload would swap the running app for the browser's offline page.
  if (!import.meta.env.PROD || !navigator.onLine) return;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY));
    if (last && Date.now() - last < RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return; // storage unavailable: no way to guard against a loop, so don't reload
  }
  // Hash routing: replace() only changes the hash (no extra history entry), reload() then
  // fetches the current build at that route.
  window.location.replace(router.resolve(to).href);
  window.location.reload();
});
