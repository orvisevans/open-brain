import js from '@eslint/js';
import * as typescriptResolver from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import promise from 'eslint-plugin-promise';
import svelte from 'eslint-plugin-svelte';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config. Zero tolerance: `--max-warnings=0` in CI.
 * No rule is set to `"off"` or `"warn"` unless the reason is in the Decision Log.
 *
 * Structure:
 *  - Globals: ignores, base JS rules, non-typed plugin rules.
 *  - Typed block (scoped with `files`): strictTypeChecked + stylisticTypeChecked
 *    + our strict additions. Applies only to files that participate in the TS
 *    project graph.
 *  - Svelte block (scoped): same typed rules + svelte parser.
 *  - Test files: relax a couple of rules.
 *  - Root JS config files: no type-aware rules.
 */
export default tseslint.config(
  {
    ignores: [
      'build/**',
      '.svelte-kit/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.min.js',
    ],
  },

  // Non-typed plugin rules apply globally.
  js.configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  unicorn.configs['flat/recommended'],
  promise.configs['flat/recommended'],

  // Typed linting — scoped to TS/JS source files that live in the project graph.
  {
    files: ['src/**/*.{ts,js}'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
    settings: {
      'import-x/resolver-next': [
        typescriptResolver.createTypeScriptImportResolver({
          project: './tsconfig.json',
        }),
      ],
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      'import-x/no-cycle': ['error', { maxDepth: 3 }],
      'import-x/order': [
        'error',
        {
          'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          'alphabetize': { order: 'asc', caseInsensitive: true },
        },
      ],

      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },

  // Svelte files get the recommended flat config + typed linting via the svelte parser.
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // Svelte's generated code sometimes conflicts with this specific lint.
      'unicorn/no-useless-undefined': 'off',
    },
  },

  // Test files: allow test globals, relax a couple of rules.
  {
    files: ['src/**/*.{test,spec}.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },

  // Root JS config files: live outside the typed TS project. No type-aware rules.
  {
    files: ['*.config.{js,mjs,cjs}', 'svelte.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // These plugins (typescript-eslint, eslint-plugin-import-x) ship both a
      // default and named exports with the same names by design. Their own
      // docs use the default-import-then-member-access pattern.
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
    },
  },

  // SvelteKit ships virtual modules ($app/*, $env/*) that have no filesystem
  // path, so import-x's resolver can't resolve them. Ignore them globally.
  // Decision Log: 2026-04-17 — see IMPLEMENTATION-PLAN §10.
  {
    rules: {
      'import-x/no-unresolved': ['error', { ignore: [String.raw`^\$app/`, String.raw`^\$env/`] }],
    },
  },
);
