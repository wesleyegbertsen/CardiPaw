---
name: verify
description: Build, serve, and drive CardiPaw in a headless browser to verify changes at the UI surface.
---

# Verifying CardiPaw changes

Build and serve the production bundle (typecheck is part of the build):

```bash
npm ci                 # once per container
npm run build          # vue-tsc -b && vite build
npx vite preview --port 4173 --strictPort &   # serves dist/
```

Drive it with Playwright (Chromium is pre-installed on remote runners at
`/opt/pw-browsers/chromium`; install the `playwright` npm package in a
scratch dir, not the repo):

```js
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
```

## Routes and gotchas

- Router uses **hash history**: tracker lives at `/#/pets/<id>/track`.
  The tracker needs a real pet: an unknown id redirects to Home. Add one
  first (Home → `+` → name → Save) and take its id from the URL.
- **Hash-only `page.goto` does NOT remount the view.** Navigating from
  `/#/pets/a/track` to `/#/pets/b/track` reuses the same component
  instance (and `TrackerView` captures `route.params.id` once in setup).
  Call `page.reload()` after `goto` to get a fresh mount.
- Pets/readings live in IndexedDB; theme, locale, and tracker toggle
  prefs live in `localStorage` under `cardipaw-*` keys.
- Seed data: `npm run seed` writes `public/seed-data.json`, imported via
  Settings → "Load seed data" (dev mode only).

## Flows worth driving

- Tracker guided mode: `.option-row .slide-toggle` (Sound/Vibration,
  `aria-checked` reflects state), `.heart-btn` starts/registers breaths.
- Manual mode via `.mode-pill` buttons.
