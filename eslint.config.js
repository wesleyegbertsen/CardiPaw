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

  // Claude Code workflow scripts: the Workflow runtime provides these globals and
  // runs the body inside an async function (so top-level await/return are allowed).
  {
    files: ['.claude/workflows/**/*.js'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { globalReturn: true } },
      globals: {
        agent: 'readonly',
        parallel: 'readonly',
        pipeline: 'readonly',
        phase: 'readonly',
        log: 'readonly',
        args: 'readonly',
        budget: 'readonly',
        workflow: 'readonly',
      },
    },
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

  // Turn off stylistic rules that Prettier owns. Must stay last.
  prettier,
);
