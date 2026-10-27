// The Maestro CLI that runs the E2E flows in e2e/. It is pinned here and installed into
// tools/maestro/ (gitignored) by `npm run maestro:install`; MAESTRO_BIN overrides it.
export const MAESTRO_VERSION = '2.11.0';
export const MAESTRO_SHA256 = '5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a';
export const MAESTRO_URL = `https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip`;
export const MAESTRO_DIR = 'tools/maestro';
export const maestroBin = process.env.MAESTRO_BIN || `${MAESTRO_DIR}/bin/maestro`;
export const maestroEnv = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' };
