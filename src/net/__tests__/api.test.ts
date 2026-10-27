import { createClient } from '@supabase/supabase-js';
import { errorCode, GoApi } from '../api';

it('opening the lobby without a session creates no account and makes no network request', async () => {
  const fetch = jest.fn();
  const db = createClient('https://example.com', 'public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  expect(await new GoApi(db).me()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('an expired login read without a connection still names its account, so the player keeps their saves', async () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const user = {
    id: 'u1',
    email: 'john.doe@example.com',
    is_anonymous: false,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '',
  };
  store.set(
    'go-test-auth',
    JSON.stringify({ access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 1, user }),
  );
  // No connection: the refresh never answers, so reading the account must not wait for it.
  const fetch = jest.fn(() => new Promise<Response>(() => {}));
  const db = createClient('https://example.com', 'public-key', {
    auth: { storage, storageKey: 'go-test-auth', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  expect(await new GoApi(db).account()).toEqual({ id: 'u1', email: 'john.doe@example.com' });
});

describe('errorCode', () => {
  it('names errors raised by the game functions', () => {
    expect(errorCode('wrong_family_code')).toBe('wrong_family_code');
    expect(errorCode('name_taken')).toBe('name_taken');
    expect(errorCode('too_many_open_games')).toBe('too_many_open_games');
  });

  it('treats a server without online play as unavailable, not as a bug', () => {
    expect(errorCode('Anonymous sign-ins are disabled')).toBe('unavailable');
    expect(errorCode('Invalid schema: go')).toBe('unavailable');
    expect(errorCode('The schema must be one of the following: public, graphql_public')).toBe('unavailable');
  });

  it('tells an unreachable server from an unknown failure', () => {
    expect(errorCode('TypeError: Network request failed')).toBe('network');
    expect(errorCode('boom')).toBe('unknown');
  });

  it('treats a timeout or a failing server as unreachable, not as a bug', () => {
    expect(errorCode('TypeError: Network request timed out')).toBe('network');
    expect(errorCode('AbortError: The operation was aborted')).toBe('network');
    expect(errorCode('canceling statement due to statement timeout')).toBe('network');
    expect(errorCode('', 0)).toBe('network');
    expect(errorCode('upstream connect error', 503)).toBe('network');
    expect(errorCode('<html>Bad gateway</html>', 502)).toBe('network');
    expect(errorCode('boom', 400)).toBe('unknown');
    // A refusal the game functions name is never mistaken for one.
    expect(errorCode('game_not_running', 500)).toBe('game_not_running');
  });
});
