# CardiPaw

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

### Rate History

Every measurement is saved with a timestamp and labelled as **Normal** (≤ 30), **Elevated** (31-35), or **High** (> 35). The history list loads incrementally so it stays fast even with hundreds of entries.

### Charts

Visualise trends over time with a line chart that supports three time ranges:

- **Week** - individual readings over the past 7 days
- **Month** - daily averages for the selected month
- **Year** - monthly averages for the selected year

Navigate backwards and forwards through history with previous/next controls, or jump straight back to the current period. The chart automatically disables navigation when there is no data further back.

### Home Screen Sparkline

Each pet on the home screen shows a compact 7-day sparkline so you can see at a glance whether the trend is stable, rising, or falling, without opening the detail view.

### Data Export & Import

Export all pets and readings as a JSON file for backup or transfer. Import a previously exported file to restore your data.

## Status Thresholds

| Label    | Rate              |
|----------|-------------------|
| Normal   | ≤ 30 breaths/min  |
| Elevated | 31-35 breaths/min |
| High     | > 35 breaths/min  |

These thresholds are based on general veterinary guidance. Always follow the specific advice of your own vet.

## Tech Stack

- [Vue 3](https://vuejs.org/) + TypeScript
- [Pinia](https://pinia.vuejs.org/) for state management
- [Chart.js](https://www.chartjs.org/) + [vue-chartjs](https://vue-chartjs.org/) for visualisations
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (via [idb](https://github.com/jakearchibald/idb)) for local persistence
- [Vite](https://vitejs.dev/) as the build tool
