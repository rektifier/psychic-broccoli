import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import svelteConfig from './svelte.config.js';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
        svelteConfig,
      },
    },
  },
  {
    files: ['*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      // Existing `any` usage is tracked as review item 17 (phase 3); tighten to
      // error once that lands.
      '@typescript-eslint/no-explicit-any': 'warn',
      // These flag legacy-mode patterns whose fixes change runtime behavior
      // (keyed each blocks, reactive collections, reactive function identity).
      // Revisit during the Svelte 5 runes migration (review item 6), then
      // tighten to error.
      'svelte/require-each-key': 'warn',
      'svelte/prefer-svelte-reactivity': 'warn',
      'svelte/no-reactive-functions': 'warn',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'src-tauri/target/', 'src-tauri/gen/', 'getting-started/'],
  }
);
