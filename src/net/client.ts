import 'expo-sqlite/localStorage/install';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { build } from '../config';
import { GoApi } from './api';

/** The app's Supabase connection, or null when the build has no backend configured. */
export const api: GoApi | null = build.supabase ? new GoApi(connect(build.supabase.url, build.supabase.key), build.supabase.schema) : null;

function connect(url: string, key: string) {
  const db = createClient(url, key, {
    auth: { storage: localStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });
  // Refresh the session only while the app is on screen.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void db.auth.startAutoRefresh();
    else void db.auth.stopAutoRefresh();
  });
  return db;
}
