import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { watch } from 'vue';
import type { Router } from 'vue-router';
import type { i18n as appI18n } from '../i18n';
import * as db from '../services/db';
import { isNative } from '../utils/platform';
import { buildWidgetSnapshot, type Translate } from '../utils/widgetSnapshot';

interface HomeWidgetPlugin {
  /** Stores the snapshot (JSON) and redraws every CardiPaw widget. */
  setSnapshot(options: { json: string }): Promise<void>;
}

/** App only (android/app/.../widget/HomeWidgetPlugin.java): no web implementation. */
export const HomeWidget = registerPlugin<HomeWidgetPlugin>('HomeWidget');

type AppI18n = typeof appI18n;
// Set by installHomeWidget. Only a type import of ../i18n above: loading it needs a DOM.
let i18n: AppI18n | null = null;

// One build at a time, and at most one waiting: a burst of writes (an import, a cascade delete)
// costs one running and one pending build. The waiting one reads IndexedDB when it starts, so it
// sees every write made before then.
let running: Promise<void> = Promise.resolve();
let pending: Promise<void> | null = null;

async function sync(): Promise<void> {
  if (!i18n) throw new Error('installHomeWidget() must run before the widget is synced');
  const [pets, readings] = await Promise.all([db.getAllPets(), db.getAllReadings()]);
  const snapshot = buildWidgetSnapshot({
    pets,
    readings,
    now: new Date(),
    locale: i18n.global.locale.value,
    t: i18n.global.t as unknown as Translate,
  });
  await HomeWidget.setSnapshot({ json: JSON.stringify(snapshot) });
}

/** Sends the widgets what IndexedDB holds now. Never rejects; does nothing on the website. */
export function syncHomeWidget(): Promise<void> {
  if (!isNative()) return Promise.resolve();
  if (pending) return pending;
  const next = running.then(() => {
    pending = null; // from here on, a new change needs a new build
    return sync();
  });
  pending = next.catch((e) => console.error('Could not update the home screen widget', e));
  running = pending;
  return pending;
}

export function installHomeWidget(_router: Router, appI18nInstance: AppI18n): void {
  if (!isNative()) return;
  i18n = appI18nInstance;
  db.onDataChanged(() => void syncHomeWidget());
  // Brings the trend days up to date; midnight and clock changes are redrawn natively.
  void App.addListener('resume', () => void syncHomeWidget());
  watch(appI18nInstance.global.locale, () => void syncHomeWidget());
  void syncHomeWidget();
}
