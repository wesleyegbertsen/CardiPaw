// Generates realistic CardiPaw test data and writes it to public/seed-data.json.
// Run with: npm run seed
// Then click "Load seed data" in Settings (dev mode only) to import into the app.

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'seed-data.json');

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isoAt(daysAgo, hour) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, randInt(0, 59), randInt(0, 59), 0);
  return d.toISOString();
}

// Returns a clickCount (taps in 30s); rate = clickCount * 2
function clickCountFor(profile) {
  const r = Math.random();
  if (profile === 'bella') {
    // Mostly normal (22–28 bpm), occasional elevated (30–34), rare high (36–40)
    if (r < 0.70) return randInt(11, 14);   // 22–28
    if (r < 0.88) return randInt(15, 17);   // 30–34
    return randInt(18, 20);                  // 36–40
  }
  if (profile === 'max') {
    // Mostly normal (18–24 bpm), rare elevated (26–28)
    if (r < 0.88) return randInt(9, 12);    // 18–24
    return randInt(13, 14);                  // 26–28
  }
  if (profile === 'luna') {
    // Higher baseline — older cat with HCM; frequent elevated/high
    if (r < 0.45) return randInt(12, 15);   // 24–30
    if (r < 0.72) return randInt(16, 17);   // 32–34
    return randInt(18, 22);                  // 36–44
  }
}

function makeReadings(petId, profile, totalCount, daySpread) {
  // Pick `totalCount` (day, slot) pairs; allow at most 2 readings per day
  const slots = [];
  const perDay = {};

  while (slots.length < totalCount) {
    const day = randInt(1, daySpread);
    const used = perDay[day] ?? 0;
    if (used >= 2) continue;
    perDay[day] = used + 1;
    // Morning vs evening
    const hour = used === 0 ? randInt(7, 11) : randInt(18, 21);
    slots.push({ day, hour });
  }

  return slots
    .sort((a, b) => a.day - b.day || a.hour - b.hour)
    .map(({ day, hour }) => {
      const clickCount = clickCountFor(profile);
      return {
        id: crypto.randomUUID(),
        petId,
        date: isoAt(day, hour),
        rate: clickCount * 2,
        clickCount,
        restState: Math.random() < 0.55 ? 'sleeping' : 'resting',
      };
    });
}

// ── Pets ──────────────────────────────────────────────────────────────────────

const bellaId = crypto.randomUUID();
const maxId   = crypto.randomUUID();
const lunaId  = crypto.randomUUID();

const pets = [
  {
    id: bellaId,
    name: 'Bella',
    species: 'cat',
    photo: null,
    birthdate: '2021-03-15',
    createdAt: isoAt(180, 10),
  },
  {
    id: maxId,
    name: 'Max',
    species: 'dog',
    photo: null,
    birthdate: '2023-08-20',
    createdAt: isoAt(120, 14),
  },
  {
    id: lunaId,
    name: 'Luna',
    species: 'cat',
    photo: null,
    birthdate: '2017-06-10',
    createdAt: isoAt(365, 9),
    normalCeiling: 28,
    elevatedCeiling: 33,
  },
];

// ── Readings ──────────────────────────────────────────────────────────────────

const readings = [
  ...makeReadings(bellaId, 'bella', 48, 90),
  ...makeReadings(maxId,   'max',   38, 90),
  ...makeReadings(lunaId,  'luna',  60, 90),
];

// ── Notes ─────────────────────────────────────────────────────────────────────

const notes = [
  {
    id: crypto.randomUUID(),
    petId: bellaId,
    title: 'HCM diagnosis — initial notes',
    content: '<p>Bella was diagnosed with hypertrophic cardiomyopathy (HCM) following an echocardiogram. Dr. Reyes recommends monitoring resting respiratory rate daily and contacting the clinic if we see rates above 40 bpm consistently.</p><p>Starting atenolol 6.25 mg once daily with food.</p>',
    createdAt: isoAt(85, 11),
    pinnedAt: isoAt(85, 11),
  },
  {
    id: crypto.randomUUID(),
    petId: bellaId,
    title: '6-week recheck',
    content: '<p>Echo shows no significant progression. Dr. Reyes is happy with the rate control. Continue current medication.</p><ul><li>Weight: 4.2 kg (stable)</li><li>Heart rate on exam: 168 bpm</li><li>No murmur grade change</li></ul>',
    createdAt: isoAt(44, 15),
    modifiedAt: isoAt(43, 9),
  },
  {
    id: crypto.randomUUID(),
    petId: bellaId,
    title: 'Behavior changes to watch',
    content: '<p>Noticed Bella is slightly less active than usual over the past week. Eating and drinking normally. No open-mouth breathing observed. Will continue monitoring.</p>',
    createdAt: isoAt(12, 20),
  },

  {
    id: crypto.randomUUID(),
    petId: maxId,
    title: 'Annual wellness visit',
    content: '<p>Max had his annual checkup — all clear. Vet suggested tracking RRR as a baseline even for healthy dogs, especially given his breed predisposition.</p><p>Vaccines up to date. Next visit in 12 months.</p>',
    createdAt: isoAt(70, 10),
  },
  {
    id: crypto.randomUUID(),
    petId: maxId,
    title: 'New exercise routine',
    content: '<p>Started longer morning walks (45 min instead of 20). Making sure to take readings only after at least 30 minutes of rest.</p>',
    createdAt: isoAt(30, 8),
  },

  {
    id: crypto.randomUUID(),
    petId: lunaId,
    title: 'Cardiology referral — summary',
    content: '<p>Luna referred to Dr. Park at the cardiology clinic. Echo confirmed moderate HCM with mild left atrial enlargement. Risk of CHF is elevated.</p><p><strong>Key guidance:</strong></p><ul><li>Call immediately if RRR &gt; 40 bpm at rest</li><li>Watch for labored breathing, open-mouth breathing, or sudden lethargy</li><li>Started furosemide 12.5 mg BID</li></ul>',
    createdAt: isoAt(150, 14),
    pinnedAt: isoAt(150, 14),
  },
  {
    id: crypto.randomUUID(),
    petId: lunaId,
    title: 'Medication adjustment',
    content: '<p>Dr. Park increased furosemide to 12.5 mg TID after two consecutive high readings (38 and 42 bpm). Re-check scheduled in 3 weeks.</p>',
    createdAt: isoAt(60, 16),
    modifiedAt: isoAt(59, 10),
  },
  {
    id: crypto.randomUUID(),
    petId: lunaId,
    title: '3-week recheck',
    content: '<p>Recheck with Dr. Park — readings have improved since medication adjustment. Average over last 2 weeks is 32 bpm. Continue current protocol.</p>',
    createdAt: isoAt(38, 11),
  },
];

// ── Output ────────────────────────────────────────────────────────────────────

const payload = {
  version: 1,
  exportedAt: new Date().toISOString(),
  pets,
  readings,
  notes,
};

writeFileSync(OUT, JSON.stringify(payload, null, 2));

const counts = {
  pets: pets.length,
  readings: readings.length,
  notes: notes.length,
};
console.log(`Seed data written to public/seed-data.json`);
console.log(`  ${counts.pets} pets, ${counts.readings} readings, ${counts.notes} notes`);
console.log(`\nTo load: start the dev server, open Settings, and click "Load seed data".`);
