import { configDefaults, defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// Tests run in UTC regardless of the developer's shell; tests that need another
// zone opt in with vi.stubEnv('TZ', …), which unstubEnvs undoes after each test.
process.env.TZ = 'UTC';

// Tests that need no DOM run in plain Node (IndexedDB comes from setup.ts), which has
// CompressionStream, Blob and Response built in. Every other test runs in happy-dom (the
// dom project); a new test that should run in Node adds itself here.
// src/utils/html.test.ts overrides its environment with a `// @vitest-environment jsdom`
// docblock: DOMPurify needs jsdom.
const NODE_TESTS = [
  'src/composables/{useAudioBeep,useHaptics}.test.ts',
  'src/i18n/locales.test.ts',
  'src/services/db.test.ts',
  'src/stores/stores.test.ts',
  'src/utils/{age,chartWindow,date,pdfText,petInitial,rateStatus,shareCodec}.test.ts',
];

// Kept separate from vite.config.ts so tests don't load the PWA plugin.
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  resolve: {
    alias: {
      // The PWA plugin provides this virtual module only in vite.config.ts; tests get a stub.
      'virtual:pwa-register/vue': fileURLToPath(new URL('./src/test/pwaRegister.ts', import.meta.url)),
    },
  },
  test: {
    // No `include` at this level: with `extends: true` a project's include is added to
    // it, and every file would run twice.
    // Child processes, not worker threads: Node only applies a runtime change of
    // process.env.TZ (stubTimezone in src/test/timezone.ts) on the main thread.
    pool: 'forks',
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    // Files stay isolated (the default): each gets a fresh fake IndexedDB from setup.ts.
    setupFiles: ['src/test/setup.ts'],
    // `npm run test:coverage` (CI). Coverage is configured once here, for all projects.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      // Setting exclude replaces Vitest's defaults, so the test files are listed again.
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/types/**', 'src/**/*.d.ts'],
      // The text table lists only files below 100%; open coverage/index.html for details.
      // The same table also goes to coverage/coverage.txt for the CI job summary, at full
      // width (maxCols: 0) so long "Uncovered Line #s" lists aren't cut off.
      reporter: [
        ['text', { skipFull: true }],
        ['text', { skipFull: true, file: 'coverage.txt', maxCols: 0 }],
        'html',
      ],
      // floor(measured) - 1, measured when they were set: raise them as coverage grows,
      // don't lower them to get a change merged.
      thresholds: { statements: 96, branches: 93, functions: 83, lines: 96 },
    },
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: NODE_TESTS },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/**/*.test.ts'],
          // A project's exclude replaces Vitest's default (node_modules etc.), so spread it in.
          exclude: [...configDefaults.exclude, ...NODE_TESTS],
          // Added to the root setupFiles (`extends: true` concatenates arrays).
          setupFiles: ['src/test/setup-dom.ts'],
        },
      },
    ],
  },
});
