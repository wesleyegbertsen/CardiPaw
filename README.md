# CardiPaw

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

### PDF Report

Generate a PDF report for any pet directly from the detail view. Select one or more months from the full history, choose whether to order them newest or oldest first, and CardiPaw produces a report where each month gets its own chart and a complete reading list with timestamps and status labels. This makes it easy to hand your vet a clear, structured overview of your pet's RRR measurements.

### Share

Create a shareable link for any pet directly from the detail view — for example to give your vet a quick overview. Select which months to include and CardiPaw packs the readings into the link itself — compressed and encoded in the URL fragment, which browsers never send to any server. Opening the link shows a standalone read-only report with summary statistics, a chart and a reading list per month, without exposing the rest of the app. Nothing is uploaded or stored: the link *is* the data, so only the people you send it to can see it.

### Pet Notes

Each pet has a general-purpose **Notes** tab where you can write anything that does not fit neatly into a reading: medication changes, vet visit summaries, behavioural observations, or anything else you want to keep alongside the RRR data. Notes are stored locally with the rest of your pet's data and are included in the data export.

### Data Export & Import

Export all pets and readings as a JSON file for backup or transfer. Import a previously exported file to restore your data.

### Languages

CardiPaw is available in **English**, **Dutch**, and **German**. On first launch the app picks a language from your browser settings (falling back to English), and you can switch it at any time from the Settings page — your choice is remembered locally. Dates and numbers are formatted according to the selected language.

## Contributing a Translation

All translations live in `src/i18n/locales/`. Each file is a flat-ish JSON object keyed by feature area. English (`en.json`) is the source of truth — every other locale must have the exact same set of keys.

### Fixing a label in an existing language

1. Open `src/i18n/locales/<code>.json` (e.g. `nl.json` for Dutch).
2. Find the key — the structure mirrors `en.json`, so search for the English text to locate the right key.
3. Edit the value and save. The dev server picks up the change instantly.

### Adding a new language

Four small steps:

#### 1. Create the locale file

Copy `src/i18n/locales/en.json` to `src/i18n/locales/<code>.json`, where `<code>` is the [BCP 47 language subtag](https://www.iana.org/assignments/language-subtag-registry) (e.g. `fr` for French). Translate every value — do not translate the keys.

#### 2. Register the locale in `src/i18n/index.ts`

```ts
// add the import
import fr from './locales/fr.json';

// add to the tuple (drives type-checking and the language picker)
export const SUPPORTED_LOCALES = ['en', 'nl', 'de', 'fr'] as const;

// add the native-language name shown in the picker
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  nl: 'Nederlands',
  de: 'Deutsch',
  fr: 'Français',
};

// add to the messages object
export const i18n = createI18n({
  messages: { en, nl, de, fr },
  // …
});
```

#### 3. Add a flag in `src/components/LocalePicker.vue`

```ts
const LOCALE_COUNTRY: Record<Locale, keyof typeof FlagSVGs> = {
  en: 'GB',
  nl: 'NL',
  de: 'DE',
  fr: 'FR',   // ISO 3166-1 alpha-2 country code
};
```

#### 4. Verify key parity

Run the following one-liner from the project root — it exits non-zero if any keys are missing or extra in your new file:

```bash
node -e "
const en = require('./src/i18n/locales/en.json');
const fr = require('./src/i18n/locales/fr.json');
function keys(o, p='') {
  return Object.entries(o).flatMap(([k,v]) =>
    typeof v === 'object' && v ? keys(v, p+k+'.') : [p+k]);
}
const ek = new Set(keys(en)), fk = new Set(keys(fr));
const missing = [...ek].filter(k => !fk.has(k));
const extra   = [...fk].filter(k => !ek.has(k));
if (missing.length) console.error('Missing in fr:', missing);
if (extra.length)   console.error('Extra in fr:',   extra);
if (!missing.length && !extra.length) console.log('All', ek.size, 'keys match.');
process.exit(missing.length || extra.length ? 1 : 0);
"
```

That is all that is needed — the language picker, auto-detection, and date/number formatting all pick up the new locale automatically.

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
