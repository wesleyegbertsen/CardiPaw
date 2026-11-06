# Contributing a Translation

All translations live in `src/i18n/locales/`. Each file is a flat-ish JSON object keyed by feature area. English (`en.json`) is the source of truth — every other locale must have the exact same set of keys.

## Fixing a label in an existing language

1. Open `src/i18n/locales/<code>.json` (e.g. `nl.json` for Dutch).
2. Find the key — the structure mirrors `en.json`, so search for the English text to locate the right key.
3. Edit the value and save. The dev server picks up the change instantly.

## Adding a new language

Four small steps:

### 1. Create the locale file

Copy `src/i18n/locales/en.json` to `src/i18n/locales/<code>.json`, where `<code>` is the [BCP 47 language subtag](https://www.iana.org/assignments/language-subtag-registry) (e.g. `es` for Spanish). Translate every value — do not translate the keys.

### 2. Register the locale in `src/i18n/index.ts`

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

### 3. Add a flag in `src/components/LocalePicker.vue`

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

### 4. Verify key parity

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
