import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default defineConfig(
  globalIgnores(['dist/', 'dev-dist/', 'coverage/', 'public/']),

  js.configs.recommended,
  tseslint.configs.recommended,
  // 'essential' = correctness rules only; template formatting is left to Prettier.
  pluginVue.configs['flat/essential'],

  // App code: browser globals, TypeScript inside <script lang="ts"> blocks.
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
    },
  },

  // Node scripts and tool config.
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'vue/require-explicit-emits': 'error',
      // Warn for now: the existing v-html sites (flag SVGs, i18n strings, sanitized
      // note HTML) still need a review. Raise to 'error' once each one is checked
      // and either removed or given an eslint-disable comment saying why it is safe.
      'vue/no-v-html': 'warn',
    },
  },

  // The pets store must not reach into other stores' caches directly; per-pet
  // caches are cleared through ./petData so none is missed. The patterns match
  // the readings and notes stores by any path, with or without an extension.
  {
    files: ['src/stores/pets.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/readings', '**/readings.[jt]s', '**/notes', '**/notes.[jt]s'],
              message: 'Clear per-pet caches through ./petData.',
            },
          ],
        },
      ],
    },
  },

  // Turn off stylistic rules that Prettier owns. Must stay last.
  prettier,
);
