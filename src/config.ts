import Constants from 'expo-constants';

/** Build settings from app.config.ts, embedded in the APK. */
export interface BuildInfo {
  variant: 'local' | 'dev' | 'prod';
  version: string;
  versionCode: number;
  supabase: { url: string; key: string; schema: string } | null;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<BuildInfo>;

export const build: BuildInfo = {
  variant: extra.variant ?? 'local',
  version: Constants.expoConfig?.version ?? '0.0.0',
  versionCode: extra.versionCode ?? 0,
  supabase: extra.supabase ?? null,
};

export const versionLabel = `${build.version} (${build.versionCode})${build.variant === 'prod' ? '' : ` ${build.variant}`}`;
