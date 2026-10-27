import { defineConfig } from 'oxlint';

export default defineConfig({
  categories: { correctness: 'off' },
  ignorePatterns: ['**/node_modules/**', 'android/**', 'coverage/**', 'tools/anti-slop/**'],
  jsPlugins: [{ name: 'anti-slop', specifier: './tools/anti-slop/index.ts' }],
  rules: {
    'oxc/no-accumulating-spread': 'error',
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/no-reduce-accumulator-copy': 'error',
  },
});
