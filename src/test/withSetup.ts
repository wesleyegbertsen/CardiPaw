import { createApp, type App } from 'vue';
import { createTestI18n } from './i18n';

/**
 * Runs a composable inside a mounted component (with i18n installed), for
 * composables that need setup context such as useI18n. Needs a DOM environment.
 * Call `app.unmount()` when done.
 */
export function withSetup<T>(composable: () => T): [T, App] {
  let result!: T;
  const app = createApp({
    setup() {
      result = composable();
      return () => null;
    },
  });
  app.use(createTestI18n());
  app.mount(document.createElement('div'));
  return [result, app];
}
