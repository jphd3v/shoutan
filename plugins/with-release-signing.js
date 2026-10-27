// Signs release builds with the key named by environment variables, so the same key
// signs every version and phones can update in place. Without GO_KEYSTORE_FILE the
// release build keeps Expo's debug signing, which is fine for local testing only.
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING = `
        release {
            if (System.getenv('GO_KEYSTORE_FILE')) {
                storeFile file(System.getenv('GO_KEYSTORE_FILE'))
                storePassword System.getenv('GO_KEYSTORE_PASSWORD')
                keyAlias System.getenv('GO_KEY_ALIAS')
                keyPassword System.getenv('GO_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    let gradle = c.modResults.contents;
    if (gradle.includes("System.getenv('GO_KEYSTORE_FILE')")) return c;
    const debugBlock = /(signingConfigs \{\n\s+debug \{[^}]*\})/;
    const releaseUsesDebug = /(release \{[^}]*?)signingConfig signingConfigs\.debug/;
    if (!debugBlock.test(gradle) || !releaseUsesDebug.test(gradle)) {
      throw new Error('with-release-signing: build.gradle layout changed; update the plugin');
    }
    gradle = gradle.replace(debugBlock, `$1${SIGNING}`);
    gradle = gradle.replace(
      releaseUsesDebug,
      "$1signingConfig System.getenv('GO_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );
    c.modResults.contents = gradle;
    return c;
  });
};
