#!/usr/bin/env node
// Builds a release APK for one variant: `node scripts/build-apk.mjs local|dev|prod`.
// - local reads the key of the running local Supabase stack.
// - dev and prod need SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for that project.
// Signing uses GO_KEYSTORE_FILE etc. when set (see docs/releasing.md); otherwise the debug key.
// Output: dist/shoutan-<variant>-<version>-<versionCode>.apk, and with BUNDLE=true also the .aab for Google Play
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { withLog } from './lib/quiet.mjs';

const variant = process.argv[2] ?? 'local';
if (!['local', 'dev', 'prod'].includes(variant)) throw new Error('Usage: build-apk.mjs local|dev|prod');

if (existsSync('.env.signing.local')) process.loadEnvFile('.env.signing.local');
if (existsSync(`.env.${variant}.local`)) process.loadEnvFile(`.env.${variant}.local`);
const env = { ...process.env, APP_VARIANT: variant };
const bundle = env.BUNDLE === 'true';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', env, ...opts });

if (variant === 'local' && !env.SUPABASE_PUBLISHABLE_KEY) {
  const status = JSON.parse(
    execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
  );
  env.SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY;
}
if (variant !== 'local' && !(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error(`The ${variant} build needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.`);
}
if (variant === 'prod' && !['GO_KEYSTORE_FILE', 'GO_KEYSTORE_PASSWORD', 'GO_KEY_ALIAS', 'GO_KEY_PASSWORD'].every((k) => env[k])) {
  throw new Error('The prod build must be signed with the release key: set GO_KEYSTORE_FILE (see docs/releasing.md).');
}

if (variant !== 'local') {
  if (!env.APP_VERSION_CODE) throw new Error('Set APP_VERSION_CODE to an integer above the last released build.');
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
    throw new Error('Commit the verified candidate before building dev or prod.');
}

const config = JSON.parse(execFileSync('npx', ['expo', 'config', '--json', '--type', 'public'], { encoding: 'utf8', env }));
const { version } = config;
const { versionCode } = config.android;

withLog(`dist/build-${variant}.log`, (stdio) => {
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], { stdio });
  const tasks = ['assembleRelease', ...(bundle ? ['bundleRelease'] : [])];
  run('./gradlew', [...tasks, `-PreactNativeArchitectures=${env.ARCHS ?? 'arm64-v8a'}`], { cwd: 'android', stdio });
});

mkdirSync('dist', { recursive: true });
const out = `dist/shoutan-${variant}-${version}-${versionCode}.apk`;
copyFileSync('android/app/build/outputs/apk/release/app-release.apk', out);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const aab = out.replace(/\.apk$/, '.aab');
if (bundle) copyFileSync('android/app/build/outputs/bundle/release/app-release.aab', aab);
const manifest = {
  variant,
  version,
  versionCode,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sha256: sha256(out),
  schema: config.extra.supabase?.schema ?? null,
  ...(bundle && { applicationId: config.android.package, bundleSha256: sha256(aab) }),
};
writeFileSync(`${out}.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built ${out}${bundle ? ` and ${aab}` : ''}`);
