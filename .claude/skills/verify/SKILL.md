---
name: verify
description: Build, launch, and drive CardiPaw in a headless browser to verify changes end-to-end.
---

# Verifying CardiPaw

## Build & serve

- `npm ci` first (the build needs `vue-tsc` from devDependencies)
- `npm run build` runs `vue-tsc -b && vite build`
- `npx vite preview --port 4173` serves the built `dist/`

## Drive with Playwright

Install the `playwright` npm package outside the repo (e.g. a scratchpad dir);
in remote sessions Chromium is preinstalled — launch with
`executablePath: '/opt/pw-browsers/chromium'`.

- The app is hash-routed: `http://localhost:4173/#/`
- Data lives in IndexedDB, so every fresh browser context starts empty —
  create a pet before anything else is reachable.
- Add-pet flow: click `.fab` → fill the name input (placeholder "e.g. Luna")
  → click "Select date" → pick a past day (future days are disabled) →
  click `.submit-btn`. Saving lands directly on the pet detail view.
- Tracker: "Start tracking" button on the detail view (`/#/pets/:id/track`).
- Dismiss the PWA "App ready to work offline" toast (button "Close") if it
  overlaps something you need to click.

## Gotchas

- The bottom nav is visible on all views including the tracker; in a
  390×844 viewport, y≈820 hits the nav, not the view body.
- To assert haptics, stub `navigator.vibrate` with `context.addInitScript`
  and record the calls into a window array.
