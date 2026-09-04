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
  - [Trend Watch](#trend-watch)
  - [Home Screen Sparkline](#home-screen-sparkline)
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

The pet detail view's tabs — Chart, Readings and Notes — can be stepped through by swiping the content left and right. When the labels do not all fit, as in some languages on narrow screens, the strip scrolls, keeps the active tab in view, and shows arrows either side to step through it; each arrow is hidden at the end of the row where there is no further tab. When every tab fits on screen the arrows are not shown at all.

### Trend Watch

The Normal/Elevated/High labels are absolute thresholds, and they miss a real pattern: a cat whose usual rate is 18 can climb to 28 — a 55% rise — while every single reading is still labelled **Normal**.

Trend Watch compares recent readings against each pet's *own* usual range instead. It takes the median of the last 5 days and compares it to the median of the 30 days before that (the windows never overlap, so a sustained rise cannot quietly drag its own baseline upwards). Medians rather than averages mean one odd reading — taken while your pet was dreaming, say — does not move the range.

The result appears as **Steady**, **Slightly up** (10% or more above usual), or **Rising** (20% or more), as a single line under the pet's name — right next to "Measured yesterday" — so it is visible on every visit rather than tucked behind a tab. Tapping it opens the usual/now/change figures and an explanation. A rise also shows as a chip on the home screen. The usual range is drawn on the chart as a dotted reference line alongside the Normal max line, so you can see the gap rather than just read about it.

The same summary appears in the [PDF report](#pdf-report) and the [shared link](#share), so whoever you hand them to sees it too. In both it is stated once, with the date it was taken, rather than drawn over month charts that may predate it — a usual range describes the pet now, not last February. Because a shared link carries only the months you picked and is opened after the fact, the figures travel inside the link as a snapshot rather than being recalculated on the reader's side.

It stays quiet until there is enough history to be meaningful — at least 8 readings in the baseline window and 2 in the recent one — and it deliberately says nothing rather than something unreliable. This is a comparison against your pet's own history, not a diagnosis; always follow your vet's advice.

### Home Screen Sparkline

Each pet on the home screen shows a compact 7-day sparkline so you can see at a glance whether the trend is stable, rising, or falling, without opening the detail view.

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

```ts
const LOCALE_COUNTRY: Record<Locale, keyof typeof FlagSVGs> = {
  en: 'GB',
  nl: 'NL',
  de: 'DE',
  fr: 'FR',
  ja: 'JP',
  es: 'ES',   // ISO 3166-1 alpha-2 country code
};
```

#### 4. Verify key parity

Run the included script to confirm your file has exactly the same keys as `en.json`:

```bash
npm run check-locale -- es
```

The script prints every missing or extra key and exits with a non-zero code on failure, so it can be used in CI. You can run it against any existing locale the same way:

```bash
npm run check-locale -- nl
npm run check-locale -- de
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

## Tech Stack

- [Vue 3](https://vuejs.org/) + TypeScript
- [Pinia](https://pinia.vuejs.org/) for state management
- [Chart.js](https://www.chartjs.org/) + [vue-chartjs](https://vue-chartjs.org/) for visualisations
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (via [idb](https://github.com/jakearchibald/idb)) for local persistence
- [Vite](https://vitejs.dev/) as the build tool
