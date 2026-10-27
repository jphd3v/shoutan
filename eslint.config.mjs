import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const restricted = (patterns) => ['error', { patterns }];
const network = { group: ['@supabase/*', '**/net', '**/net/*'], message: 'Only src/net and the online screens talk to the network.' };
const screens = {
  group: ['**/screens', '**/screens/*'],
  message: 'Presentation in src/ui takes plain data; what the screen does lives in src/screens.',
};

export default tseslint.config(
  { ignores: ['android/**', 'ios/**', '.expo/**', 'coverage/**', 'tools/anti-slop/**', 'e2e-output/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    name: 'pure-rules',
    files: ['src/go/**/*.ts'],
    rules: {
      'no-restricted-imports': restricted([
        {
          group: ['react', 'react-native', 'react-native-*', 'expo', 'expo-*', '@expo/*'],
          message: 'Game rules stay free of React and Expo.',
        },
        { group: ['../*'], message: 'Game rules import only other rules modules.' },
        network,
      ]),
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded generator so a position always gets the same move.' },
        { object: 'Date', property: 'now', message: 'Rules must not depend on the clock.' },
        { object: 'performance', property: 'now', message: 'Rules must not depend on the clock.' },
      ],
      'no-restricted-syntax': ['error', { selector: "NewExpression[callee.name='Date']", message: 'Rules must not depend on the clock.' }],
    },
  },
  {
    name: 'pure-rules-tests',
    files: ['src/go/__tests__/**/*.ts'],
    rules: {
      'no-restricted-imports': restricted([
        {
          group: ['react', 'react-native', 'react-native-*', 'expo', 'expo-*', '@expo/*'],
          message: 'Game rules stay free of React and Expo.',
        },
        { group: ['../../*'], message: 'Game rules import only other rules modules.' },
        network,
      ]),
    },
  },
  {
    name: 'offline-ui',
    files: ['src/ui/**/*.{ts,tsx}', 'src/report/**/*.ts'],
    rules: { 'no-restricted-imports': restricted([network, screens]) },
  },
  {
    files: ['**/__tests__/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
  },
  {
    files: ['supabase/tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['it', 'test', 'describe'] }] },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },
  prettierConfig,
);
