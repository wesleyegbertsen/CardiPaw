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
- **A route path change remounts the view; a query-only change does not.**
  `App.vue` keys `<RouterView>` by `route.path`, so a hash-only `page.goto`
  from `/#/pets/a/track` to `/#/pets/b/track` gives a fresh instance (no
  `page.reload()` needed). Changing only the query (`?tab=` on a pet page,
  `?d=` on `/share`) keeps the same instance, which must react to the new
  query itself.
- Pets/readings live in IndexedDB; theme, locale, and tracker prefs
  (sound, vibration, measurement length) live in `localStorage` under
  `cardipaw-*` keys.
- Seed data: `npm run seed` writes `public/seed-data.json`, imported via
  Settings → "Load seed data" (dev mode only).

## Flows worth driving

- Tracker guided mode: `.toggle-rows .slide-toggle` (Sound/Vibration,
  `aria-checked` reflects state), `.heart-btn` starts/registers breaths.
  The length picker (15/30/60 s, idle only, remembered per pet) uses
  visually hidden radios, so Playwright's `.check()` on them times out:
  click the label instead, e.g.
  `page.locator('.length-option', { hasText: '60' }).click()`, and assert
  `.length-picker input:checked`. The picker and switches sit in
  `.tracker-options`, which swallows taps; a tap anywhere else on the
  idle screen starts a measurement.
- Manual mode via `.mode-pill` buttons.
