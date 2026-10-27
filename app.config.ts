import { execSync } from 'node:child_process';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * APP_VARIANT picks which backend a build talks to and lets the variants install side by side:
 * - local: Shoutan Local, the emulator against the local Supabase stack (default)
 * - dev:   Shoutan Dev, for trying a version before it is promoted to prod
 * - prod:  Shoutan, the stable app the family uses
 * Shoutan Dev and Shoutan share one online schema, so they play each other. The production
 * package ID is the app's permanent identity: Android ties it to the signing key.
 * SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are read at build time. Without them the
 * build plays offline only; feedback and error reports wait on the phone.
 */
const VARIANTS = {
  local: { name: 'Shoutan Local', id: 'io.github.jphd3v.shoutan.local', icon: '-local' },
  dev: { name: 'Shoutan Dev', id: 'io.github.jphd3v.shoutan.dev', icon: '-dev' },
  prod: { name: 'Shoutan', id: 'io.github.jphd3v.shoutan', icon: '' },
} as const;
type Variant = keyof typeof VARIANTS;

const variant = (process.env.APP_VARIANT ?? 'local') as Variant;
if (!Object.hasOwn(VARIANTS, variant)) throw new Error(`APP_VARIANT must be one of ${Object.keys(VARIANTS).join(', ')}`);

/** Local builds default to commit count; hosted builds require an explicit increasing code. */
const versionCode = Number(process.env.APP_VERSION_CODE ?? execSync('git rev-list --count HEAD').toString().trim());

const supabaseUrl = process.env.SUPABASE_URL ?? (variant === 'local' ? 'http://10.0.2.2:54321' : undefined);
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const schema = process.env.SUPABASE_SCHEMA ?? (variant === 'local' ? 'public' : 'go');
if (!['public', 'go'].includes(schema)) throw new Error('Unsupported Supabase schema');
if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error('Invalid Android version code');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: VARIANTS[variant].name,
  slug: 'shoutan',
  version: '1.0.0',
  orientation: 'portrait',
  // Drawn by scripts/make-icons.mjs; Shoutan Dev and Shoutan Local carry a badge.
  icon: `./assets/icon${VARIANTS[variant].icon}.png`,
  userInterfaceStyle: 'light',
  ios: { supportsTablet: true, bundleIdentifier: VARIANTS[variant].id },
  android: {
    adaptiveIcon: {
      backgroundColor: '#E8BC7C',
      foregroundImage: `./assets/android-icon-foreground${VARIANTS[variant].icon}.png`,
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // A reinstall starts fresh: Android would otherwise restore the old choices, and the welcome with them.
    allowBackup: false,
    // Expo's template asks for these by default; the app draws no overlays and keeps its files private.
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    package: VARIANTS[variant].id,
    versionCode,
  },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    'expo-font',
    'expo-sqlite',
    // Only the local build talks plain HTTP, to the Supabase stack on the development machine.
    ['expo-build-properties', { android: { usesCleartextTraffic: variant === 'local' } }],
    './plugins/with-release-signing.js',
  ],
  extra: {
    variant,
    versionCode,
    supabase: supabaseUrl && supabaseKey ? { url: supabaseUrl, key: supabaseKey, schema } : null,
  },
});
