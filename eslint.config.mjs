import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'bin/**', 'release/**', '.data/**'] },
  js.configs.recommended,
  security.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-control-regex': 'off', // control characters are stripped on purpose, everywhere
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Paths and lookups here are built from checked ids, never from raw input (see the tests).
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    files: ['server/**/*.js', 'electron/**/*.js', 'scripts/**/*.js', 'electron-builder.lite.js', 'test/server/**/*.js', 'test/security/**/*.js', 'test/helpers.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['src/**/*.{js,jsx}', 'test/ui/**/*.{js,jsx}'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, 'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  // The mini player's page: a plain script in the browser, no modules.
  { files: ['public/**/*.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser } } },
  { files: ['vite.config.mjs', 'eslint.config.mjs'], languageOptions: { globals: { ...globals.node } } },
];
