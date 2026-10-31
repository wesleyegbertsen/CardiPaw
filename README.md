# CardiPaw

## Table of Contents

- [Try It](#try-it)
- [Why I Built This](#why-i-built-this)
- [What Is a Resting Respiratory Rate?](#what-is-a-resting-respiratory-rate)
- [Features](#features)
  - [Multiple Pets](#multiple-pets)
  - [Guided Tracking](#guided-tracking)
  - [Readings](#readings)
  - [Charts](#charts)
  - [Home Screen Sparkline](#home-screen-sparkline)
  - [Trend Alerts](#trend-alerts)
  - [PDF Report](#pdf-report)
  - [Share](#share)
  - [Pet Notes](#pet-notes)
  - [Data Export & Import](#data-export--import)
  - [Languages](#languages)
- [Contributing a Translation](#contributing-a-translation)
  - [Fixing a label in an existing language](#fixing-a-label-in-an-existing-language)
  - [Adding a new language](#adding-a-new-language)
- [Status Thresholds](#status-thresholds)
- [Docker](#docker)
- [Android](#android)
- [Releases & Versioning](#releases--versioning)
  - [PR titles](#pr-titles)
- [Development](#development)
  - [Android app](#android-app)
    - [Release signing](#release-signing)
- [Tech Stack](#tech-stack)

## Try It

CardiPaw is available for free at **[cardipaw.com](https://cardipaw.com/)**. No installation required and all data is stored locally in your browser.

## Why I Built This

My cat Lushi was diagnosed with HCM (Hypertrophic Cardiomyopathy), a heart condition that requires regular monitoring at home. One of the most important things you can do as an owner of a cat with HCM is to measure their Resting Respiratory Rate (RRR), the number of breaths per minute while they are asleep or at rest. A rising RRR can be an early warning sign of fluid building up around the lungs. Always follow your vet's guidance on what to monitor and when to act.

Tracking this consistently by hand (counting breaths, writing down numbers, trying to spot trends) quickly became tedious and error-prone. I built CardiPaw to make the whole process simple, reliable, and easy to review over time.

## What Is a Resting Respiratory Rate?

The RRR is measured by watching your pet's chest while they are resting or sleeping and counting the number of breaths over 30 seconds, then multiplying by 2 to get breaths per minute. Count chest movements: one rise and fall equals one breath. For cats and dogs, a normal RRR is generally **below 30 breaths/min**.

## Features

### Multiple Pets

Add as many pets as you need, each with a name, species, photo, and date of birth. All data is stored locally on your device and nothing is sent to any server.

### Guided Tracking

The built-in tracker walks you through a 30-second measurement. Tap the button each time your pet takes a breath, and CardiPaw calculates the rate automatically.

### Readings

Every measurement is saved with a timestamp and labelled as **Normal** (≤ 30), **Elevated** (31-35), or **High** (> 35). The readings list loads incrementally so it stays fast even with hundreds of entries.

When saving a reading you can optionally record your pet's **rest state** (resting or sleeping) and add a free-text **note** (for example, whether they had just eaten, were in an unusual position, or anything else worth remembering). Both fields appear alongside the reading in the list and in the exported PDF report.

### Charts

Visualise trends over time with a line chart that supports three time ranges:

- **Week** - individual readings over the past 7 days
- **Month** - daily averages for the selected month
- **Year** - monthly averages for the selected year

Navigate backwards and forwards through history with previous/next controls, or jump straight back to the current period. The chart automatically disables navigation when there is no data further back.

### Home Screen Sparkline

Each pet on the home screen shows a compact 7-day sparkline so you can see at a glance whether the trend is stable, rising, or falling, without opening the detail view.

### Trend Alerts

CardiPaw keeps an eye on the trend for you. When a pet's resting breathing rate has crept up, the pet's card on the home screen and the header of its detail view show a **Trending up** badge (**Above normal** for the second rule below). Tap the badge in the detail view to see the numbers behind it and what to do next. An alert shows when either of these is true:

- on **at least 2 of the last 3 days**, the rate was **20% and 4 breaths/min or more** above the pet's usual rate, or
- on **at least 2 of the last 3 days**, the rate was above the pet's Normal ceiling (see [Status Thresholds](#status-thresholds), or the pet's own ceiling when one is set).

Each day counts once, using the median (middle value) of that day's readings, so measuring again on the same day doesn't count twice. The usual rate is the median of the day values over the 28 days before the last 3, and it needs readings on at least 7 of those 28 days; the Normal-ceiling rule works without it.

The alert goes away on its own once readings settle. With too few readings nothing is shown, so no alert doesn't always mean all is well. Mixing sleeping and resting readings can also make the rate look higher, because the rate is usually lower during sleep. The badge's details in the app explain all of this too.

A trend alert is not a diagnosis. If you're worried, contact your vet, and if your pet is struggling to breathe, contact them straight away.

### PDF Report

Generate a PDF report for any pet directly from the detail view. Select one or more months from the full history, choose whether to order them newest or oldest first, and CardiPaw produces a report where each month gets its own chart and a complete reading list with timestamps and status labels. This makes it easy to hand your vet a clear, structured overview of your pet's RRR measurements.

### Share

Create a shareable link for any pet directly from the detail view — for example to give your vet a quick overview. Select which months to include and CardiPaw packs the readings into the link itself — compressed and encoded in the URL fragment, which browsers never send to any server. Opening the link shows a standalone read-only report with summary statistics, a chart and a reading list per month, without exposing the rest of the app. Nothing is uploaded or stored: the link *is* the data, so only the people you send it to can see it.

### Pet Notes

Each pet has a general-purpose **Notes** tab where you can write anything that does not fit neatly into a reading: medication changes, vet visit summaries, behavioural observations, or anything else you want to keep alongside the RRR data. Notes are stored locally with the rest of your pet's data and are included in the data export.

### Data Export & Import

Export all pets and readings as a JSON file for backup or transfer. Import a previously exported file to restore your data.

### Languages

CardiPaw is available in **English**, **Dutch**, **German**, **French**, and **Japanese**. On first launch the app picks a language from your browser settings (falling back to English), and you can switch it at any time using the flag picker in the home screen header — your choice is remembered locally. Dates and numbers are formatted according to the selected language.

## Contributing a Translation

All translations live in `src/i18n/locales/`. Each file is a flat-ish JSON object keyed by feature area. English (`en.json`) is the source of truth — every other locale must have the exact same set of keys.

### Fixing a label in an existing language

1. Open `src/i18n/locales/<code>.json` (e.g. `nl.json` for Dutch).
2. Find the key — the structure mirrors `en.json`, so search for the English text to locate the right key.
3. Edit the value and save. The dev server picks up the change instantly.

### Adding a new language

Four small steps:

#### 1. Create the locale file

Copy `src/i18n/locales/en.json` to `src/i18n/locales/<code>.json`, where `<code>` is the [BCP 47 language subtag](https://www.iana.org/assignments/language-subtag-registry) (e.g. `es` for Spanish). Translate every value — do not translate the keys.

#### 2. Register the locale in `src/i18n/index.ts`

```ts
// add the import
import es from './locales/es.json';

// add to the tuple (drives type-checking and the language picker)
export const SUPPORTED_LOCALES = ['en', 'nl', 'de', 'fr', 'ja', 'es'] as const;

// add the native-language name shown in the picker
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  nl: 'Nederlands',
  de: 'Deutsch',
  fr: 'Français',
  ja: '日本語',
  es: 'Español',
};

// add the first day of the week (0 = Sunday, 1 = Monday),
// used by the in-app date picker's calendar grid
export const WEEK_START: Record<Locale, 0 | 1> = {
  en: 0,
  nl: 1,
  de: 1,
  fr: 1,
  ja: 0,
  es: 1,
};

// add to the messages object
export const i18n = createI18n({
  messages: { en, nl, de, fr, ja, es },
  // …
});
```

The `Record<Locale, …>` types are deliberate: if you extend `SUPPORTED_LOCALES` but forget a name or week start, `npm run build` fails with a missing-property error, so nothing can be registered halfway.

#### 3. Add a flag in `src/components/LocalePicker.vue`

Add the country flag to the named import and to the `FLAGS` map:

```ts
import { GB, NL, DE, FR, JP, ES } from 'country-flag-icons/string/3x2';

const FLAGS: Record<Locale, string> = {
  en: GB,
  nl: NL,
  de: DE,
  fr: FR,
  ja: JP,
  es: ES,   // exports are named by ISO 3166-1 alpha-2 country code
};
```

Keep these as named imports: a namespace import (`import * as ...`) with a dynamic lookup bundles every flag in the package (~265).

#### 4. Verify key parity

Run the included script to confirm your file has exactly the same keys as `en.json`:

```bash
npm run check-locale -- es
```

The script prints every missing or extra key and exits with a non-zero code on failure. Without an argument it checks every locale, which is what CI runs:

```bash
npm run check-locale
```

That is all that is needed — the language picker, auto-detection, date/number formatting, and the date picker's month/weekday names all pick up the new locale automatically.

> **Note on non-Latin scripts:** the PDF report renders with jsPDF's built-in Helvetica font, which only covers Latin characters. A locale written in another script (like Japanese) also needs an embedded font: place the `.ttf` files in `public/fonts/` and follow the `loadJaFont`/`registerJaFont` pattern in `src/composables/usePdfExport.ts`. Latin-script locales can skip this entirely.

## Status Thresholds

| Label    | Rate              |
|----------|-------------------|
| Normal   | ≤ 30 breaths/min  |
| Elevated | 31-35 breaths/min |
| High     | > 35 breaths/min  |

These thresholds are based on general veterinary guidance. Always follow the specific advice of your own vet.

## Docker

The app is available as a pre-built image on Docker Hub: [wesleyegbertsen/cardipaw](https://hub.docker.com/r/wesleyegbertsen/cardipaw)

### docker run

```bash
docker run -d -p 8080:80 --name cardipaw wesleyegbertsen/cardipaw:latest
```

Then open `http://localhost:8080`.

### docker-compose

```yaml
services:
  cardipaw:
    image: wesleyegbertsen/cardipaw:latest
    container_name: cardipaw
    ports:
      - "8080:80"
    restart: unless-stopped
```

Every release is also published under its version, e.g. `wesleyegbertsen/cardipaw:1.4.2`, plus floating `:1.4` and `:1` tags. Pin one of those instead of `latest` if you want to control when you upgrade.

## Android

Every [release](https://github.com/wesleyegbertsen/CardiPaw/releases) includes the Android app as `cardipaw-X.Y.Z.apk`. CardiPaw is not on Google Play yet.

1. Download the APK on your phone from the latest release and open it.
2. Allow your browser or file manager to install unknown apps when Android asks. Google Play Protect may warn about an app it doesn't know; that is expected for apps installed outside Play.

**Updating:** install the APK of a newer release over the installed app. Your pets and readings stay. The app does not update itself, so check the releases page now and then.

- Android refuses to install an older APK over a newer one. **Don't uninstall to get around that:** Android Auto Backup is disabled, so uninstalling deletes all of the app's data. If you really need to go back, [export](#data-export--import) first.
- Export regularly anyway: the export file is the only backup of the app's data.

**Checking an APK:** every release's notes list the SHA-256 of the certificate the APK is signed with, and it is the same for every release. You can compare it with the output of `apksigner verify --print-certs cardipaw-X.Y.Z.apk` (Android SDK build-tools), or with an app such as AppVerifier. If it ever differs, don't install that APK.

**Coming from a CI debug build (#84):** those APKs are signed with a different key, so Android won't install a release over them. Once: export your data in the debug app, uninstall it, install the release APK and import the file.

## Releases & Versioning

CardiPaw follows [Semantic Versioning](https://semver.org/). The version is shown at the bottom of the About section on the Settings page and links to its release notes.

Releases are automated by the [Release workflow](.github/workflows/release.yml), which runs daily and can be started manually from the Actions tab:

1. If no commits have been merged into `main` since the last `vX.Y.Z` tag, the run stops.
2. The commit must pass the same [checks as CI](#development) (lint, type-check, tests, locale check, build and `npm audit`); otherwise nothing is released.
3. [GitVersion](https://gitversion.net/) determines the next version from the commit messages since that release (see [PR titles](#pr-titles) below and [`GitVersion.yml`](GitVersion.yml)).
4. [`scripts/set-version.mjs`](scripts/set-version.mjs) stamps that version into `package.json` and `package-lock.json`, from which the app reads it at build time. You can run it locally with `npm run set-version -- 1.2.3`.
5. The website is deployed, the Docker image is pushed with the new version tags, and the Android APK is built and signed (see [Release signing](#release-signing)).
6. The commit is tagged `vX.Y.Z` and a GitHub release is created with the APK attached and a changelog that lists every commit merged since the previous release.

If the deploy, the Docker image or the APK fails, nothing is tagged, and the next run retries with the same version.

The version is not committed back to the repository: the git tags are the source of truth, so `package.json` stays at `0.0.0` on `main`.

### PR titles

PRs are squash-merged, so each PR title becomes a commit message on `main`. Titles must follow [Conventional Commits](https://www.conventionalcommits.org/) (`<type>[(scope)][!]: <description>`), which a CI check enforces. The type decides how much the next release bumps the version:

| PR title | Release bump |
| --- | --- |
| `feat!: …`, `fix(tracker)!: …`, or a `BREAKING CHANGE:` line in the commit body | major (`1.4.2` → `2.0.0`) |
| `feat: …`, `feat(pdf): …` | minor (`1.4.2` → `1.5.0`) |
| `fix: …`, `perf: …`, `refactor: …`, `docs: …`, `style: …`, `test: …`, `build: …`, `ci: …`, `chore: …`, `revert: …` | patch (`1.4.2` → `1.4.3`) |

When a release contains several PRs, the biggest bump wins: one `feat:` among ten `fix:` PRs makes it a minor release.

## Development

```bash
npm ci
npm run dev           # start the dev server
npm test              # run the unit tests once (npm run test:watch to keep them running)
npm run test:coverage # the tests with a coverage report; fails below the thresholds in vitest.config.ts
npm run lint          # ESLint
npm run typecheck     # vue-tsc
npm run check-locale  # key parity of every locale against en.json
npm run build
```

CI runs all of these, plus `npm audit --omit=dev --audit-level=high`, on every PR and every push to `main`, and the Release workflow runs them again before it deploys. Tests live next to the code they cover as `*.test.ts` (`*.test.mjs` for the Node scripts in `scripts/`) and use [Vitest](https://vitest.dev/); IndexedDB is provided by [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) and components are mounted with [Vue Test Utils](https://test-utils.vuejs.org/). Tests run in [happy-dom](https://github.com/capricorn86/happy-dom), except the pure-logic files listed in the `node` project in `vitest.config.ts`, which run in plain Node.

A Prettier config is included for new code (`npm run format:check`, `npm run format`). The existing code has not been reformatted yet, so CI does not enforce it.

### Android app

The same app also runs as an Android app, built with [Capacitor](https://capacitorjs.com/). The native project lives in [`android/`](android/) and its settings in [`capacitor.config.ts`](capacitor.config.ts).

You need [Android Studio](https://developer.android.com/studio) with the Android SDK 36 platform, JDK 21 and Node 22 or newer.

```bash
npm run build:android # type-check, build the web files into dist-native/ and copy them into android/
npm run android:open  # open the project in Android Studio, then run it on a device or emulator
npm run generate-android-assets # regenerate the launcher icon from public/favicon.svg
```

The launcher icon, and the icon on the launch screen, come from `public/favicon.svg`, the same source as the PWA icons. After changing it, run `npm run generate-android-assets` and commit the result; a test fails while the generated XML is out of date. The launch screen's background is `app_background` in `android/app/src/main/res/values*/colors.xml`, which a test keeps equal to `--color-bg` in `global.css`. The launch screen and the app's first frame follow the **system** dark mode, not the in-app theme setting, because Android shows them before the page loads.

After changing the icon or the launch screen, check them on a device: the icon under round, squircle and themed (Android 13+) masks, and the launch screen in light and dark mode with no white flash before the page appears.

CI builds a debug APK on every PR and attaches it to the run as the `cardipaw-debug-apk` artifact, so you can install it without Android Studio. The same job also builds a release APK, signs it with a throwaway key and verifies it, so every PR tests the release signing (see below).

- **The app's data is separate from cardipaw.com.** The app serves itself from `https://localhost`, so its IndexedDB and settings belong to that origin. To move data between the website and the app, use Export on one and Import on the other.
- **Never change `androidScheme` or `hostname` in `capacitor.config.ts`.** They define that origin: after a change, the app starts with no data for every user who installed an earlier version.
- **Android Auto Backup is disabled** (`allowBackup="false"` and backup rules that exclude everything), so nothing is copied to Google's backup or to a new phone. The in-app export is the only backup: export regularly and keep the file somewhere safe.
- Share links still point at `https://cardipaw.com`, so the people you send them to open them in their browser.
- Google Play publishing is not set up yet (#85).
- A debug APK is signed with a different key than the release APKs, so Android won't install one over the other. See [Android](#android) for moving your data.

#### Release signing

The [Release workflow](.github/workflows/release.yml) calls [`android-release.yml`](.github/workflows/android-release.yml):

- One job builds an **unsigned** release APK with Gradle.
- A second job, on a fresh runner that installs no npm packages and runs no Gradle, signs it with the SDK's `apksigner` through [`scripts/android-apk.mjs`](scripts/android-apk.mjs).
- So no dependency code can reach the signing key.
- The script also checks that the APK's version matches the release, and that the APK verifies with exactly one signer whose certificate matches `ANDROID_CERT_SHA256`.

It needs, under Settings → Secrets and variables → Actions:

| Name | Kind | Value |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | secret | the keystore file, base64 on one line |
| `ANDROID_KEYSTORE_PASSWORD` | secret | its password (a PKCS12 keystore, keytool's default, uses the same password for the key) |
| `ANDROID_KEY_ALIAS` | secret | the key's alias, e.g. `cardipaw` |
| `ANDROID_CERT_SHA256` | variable | the certificate's SHA-256 fingerprint; public, it is printed in every release's notes |

If one is missing or wrong, the APK step fails with a message that names it, and nothing is tagged.

One-time setup (keytool comes with JDK 21; Android Studio has it in `jbr/bin`):

```bash
keytool -genkeypair -v -keystore cardipaw-release.jks -alias cardipaw -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 cardipaw-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD   # type it at the hidden prompt
gh secret set ANDROID_KEY_ALIAS --body cardipaw
keytool -list -v -keystore cardipaw-release.jks -alias cardipaw   # copy the "SHA256:" value
gh variable set ANDROID_CERT_SHA256 --body "<that value>"
```

In PowerShell, encode the keystore with `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\cardipaw-release.jks")) | gh secret set ANDROID_KEYSTORE_BASE64`. Don't use `certutil -encode`: it adds header lines.

**The key is permanent.** Every future APK must be signed with it. If it is lost, no installed copy can ever be updated again, and users would have to uninstall, which deletes their data. Keep at least two offline backups of the `.jks` file and its password, and never commit it (`.gitignore` covers `*.jks`).

**Google Play (#85):** use this key as Play's *app signing* key, not only as the upload key. Otherwise Play installs and GitHub APKs can't update each other.

## Tech Stack

- [Vue 3](https://vuejs.org/) + TypeScript
- [Pinia](https://pinia.vuejs.org/) for state management
- [Chart.js](https://www.chartjs.org/) + [vue-chartjs](https://vue-chartjs.org/) for visualisations
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (via [idb](https://github.com/jakearchibald/idb)) for local persistence
- [Vite](https://vitejs.dev/) as the build tool
