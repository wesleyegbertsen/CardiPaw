# Contributing to CardiPaw

Thanks for helping! Bugs and ideas go in [issues](https://github.com/wesleyegbertsen/CardiPaw/issues); security problems don't: see [SECURITY.md](SECURITY.md). For code, open a PR against `main` and fill in the [PR template](.github/pull_request_template.md): a summary, release notes, the changes and how you verified them.

When a PR changes how a feature works, update its section in [docs/features.md](docs/features.md) or [docs/android.md](docs/android.md), and its README bullet if it has one, in the same PR.

## Development

```bash
npm ci
npm run dev           # start the dev server
npm test              # run the unit tests once (npm run test:watch to keep them running)
npm run test:coverage # the tests with a coverage report; fails below the thresholds in vitest.config.ts
npm run lint          # ESLint
npm run typecheck     # vue-tsc
npm run check-locale  # key parity of every locale against en.json
npm run check-links   # relative links and #anchors in the Markdown files
npm run build
```

CI runs all of these, plus `npm audit --omit=dev --audit-level=high`, on every PR and every push to `main`, and the Release workflow runs them again before it deploys. Tests live next to the code they cover as `*.test.ts` (`*.test.mjs` for the Node scripts in `scripts/`) and use [Vitest](https://vitest.dev/); IndexedDB is provided by [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) and components are mounted with [Vue Test Utils](https://test-utils.vuejs.org/). Tests run in [happy-dom](https://github.com/capricorn86/happy-dom), except the pure-logic files listed in the `node` project in `vitest.config.ts`, which run in plain Node.

Research prototypes live in `research/` (currently the camera-based breath counting exploration for [#130](https://github.com/wesleyegbertsen/CardiPaw/issues/130), see [`research/camera-breath/README.md`](research/camera-breath/README.md)). CI type-checks, lints and tests them like `scripts/`. The pure signal modules the app's experimental camera counting uses live in `src/camera/`; `research/` keeps the ffmpeg reader, the sweep and the scoring, which are never bundled.

Other scripts:

```bash
npm run preview             # serve the production build in dist/ (run npm run build first)
npm run seed                # write demo pets, readings and notes to public/seed-data.json
npm run generate-pwa-assets # regenerate the PWA icons in public/ from public/favicon.svg
```

- **seed** writes 5 pets with about 200 readings over the last months and 8 notes. The values are random, but Milo always ends on a rising trend (**Trending up**) and Ollie stays above the default Normal ceiling (**Above normal**). Load it with the dev server: **Settings → Developer → Load seed data**, which replaces all data in that browser. The file is gitignored and left out of the Docker build context, but Vite copies everything in `public/` into `dist/`: delete it before you deploy a local build.
- **generate-pwa-assets** writes `pwa-*.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png` and `favicon.ico` (settings in [`pwa-assets.config.ts`](pwa-assets.config.ts)). It only prints the `<head>` links and the manifest's icons; `index.html` and the manifest in `vite.config.ts` are kept by hand and already match. It rewrites the files with slightly different bytes even when `favicon.svg` hasn't changed, so commit its output only after changing the icon (and run `npm run generate-android-assets` too).

A Prettier config is included for new code (`npm run format:check`, `npm run format`). The existing code has not been reformatted yet, so CI does not enforce it.

## PR titles

PRs are squash-merged, so each PR title becomes a commit message on `main`. Titles must follow [Conventional Commits](https://www.conventionalcommits.org/) (`<type>[(scope)][!]: <description>`), which a CI check enforces. The type decides how much the next release bumps the version:

| PR title | Release bump |
| --- | --- |
| `feat!: …`, `fix(tracker)!: …`, or a `BREAKING CHANGE:` line in the commit body | major (`1.4.2` → `2.0.0`) |
| `feat: …`, `feat(pdf): …` | minor (`1.4.2` → `1.5.0`) |
| `fix: …`, `perf: …`, `refactor: …`, `docs: …`, `style: …`, `test: …`, `build: …`, `ci: …`, `chore: …`, `revert: …` | patch (`1.4.2` → `1.4.3`) |

When a release contains several PRs, the biggest bump wins: one `feat:` among ten `fix:` PRs makes it a minor release.

How releases are cut from these titles: [docs/releasing.md](docs/releasing.md).

## Android app

The same app also runs as an Android app, built with [Capacitor](https://capacitorjs.com/). The native project lives in [`android/`](android/) and its settings in [`capacitor.config.ts`](capacitor.config.ts).

You need [Android Studio](https://developer.android.com/studio) with the Android SDK 36 platform, JDK 21 and Node 24 (the version CI and the Dockerfile use).

```bash
npm run build:android # type-check, build the web files into dist-native/ and copy them into android/
npm run android:open  # open the project in Android Studio, then run it on a device or emulator
npm run generate-android-assets # regenerate the launcher icon from public/favicon.svg
```

The launcher icon, and the icon on the launch screen, come from `public/favicon.svg`, the same source as the PWA icons. After changing it, run `npm run generate-android-assets` and commit the result; a test fails while the generated XML is out of date. The launch screen's background is `app_background` in `android/app/src/main/res/values*/colors.xml`, which a test keeps equal to `--color-bg` in `global.css`. The launch screen and the app's first frame follow the **system** dark mode, not the in-app theme setting, because Android shows them before the page loads.

After changing the icon or the launch screen, check them on a device: the icon under round, squircle and themed (Android 13+) masks, and the launch screen in light and dark mode with no white flash before the page appears.

CI builds a debug APK on every PR and attaches it to the run as the `cardipaw-debug-apk` artifact, so you can install it without Android Studio. The same job also builds a release APK, signs it with a throwaway key and verifies it, so every PR tests the release signing (see [Release signing](docs/releasing.md#release-signing)).

- **The app's data is separate from cardipaw.com.** The app serves itself from `https://localhost`, so its IndexedDB and settings belong to that origin. To move data between the website and the app, use Export on one and Import on the other.
- **Never change `androidScheme` or `hostname` in `capacitor.config.ts`.** They define that origin: after a change, the app starts with no data for every user who installed an earlier version.
- **Android Auto Backup is disabled** (`allowBackup="false"` and backup rules that exclude everything), so nothing is copied to Google's backup or to a new phone, and the in-app export is the only backup (what users are told: [Updating](docs/android.md#updating)). Don't turn it back on without changing that text too.
- **The app has the `INTERNET` permission, only for the opt-in update check.** Android grants it at install time to the whole app; the setting only decides whether CardiPaw's own code makes the request. The page's Content-Security-Policy is nginx.conf's with the one URL the check asks, `https://api.github.com/repos/wesleyegbertsen/CardiPaw/releases/latest`, added to `connect-src` ([`src/native/csp.ts`](src/native/csp.ts)), so the page itself can't fetch anything else, not even other GitHub API URLs. Native plugins aren't covered by the CSP: Capacitor's built-in CapacitorHttp and `@capacitor/filesystem`'s `downloadFile` could still make requests, so dependency hygiene matters as much as before. WebView Safe Browsing and WebView metrics are turned off in the manifest. Local and CI debug builds are version 0.0.0 and never check; to try the check, stamp a version first (`npm run set-version -- 0.1.0`, then revert `package.json` and `package-lock.json`).
- Share links still point at `https://cardipaw.com`, so the people you send them to open them in their browser.
- Google Play publishing is not set up yet ([#85](https://github.com/wesleyegbertsen/CardiPaw/issues/85)).
- Debug and release APKs are signed with different keys: see [Coming from a CI debug build](docs/android.md#coming-from-a-ci-debug-build).

## Translations

To fix a label or add a language, see [docs/translations.md](docs/translations.md).
