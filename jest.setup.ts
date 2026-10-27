/** Stand-ins for the native modules the screens use, so whole screens render under Jest. */

// expo-sqlite's localStorage is native; an in-memory one behaves the same for the app.
jest.mock('expo-sqlite/localStorage/install', () => {
  const items = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, String(v)),
    removeItem: (k: string) => void items.delete(k),
    clear: () => items.clear(),
  };
});

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => {}), remove: jest.fn(), volume: 1 }),
  preload: jest.fn(async () => {}),
  setAudioModeAsync: jest.fn(async () => {}),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

jest.mock('@expo-google-fonts/inter', () => ({
  useFonts: () => [true],
  Inter_400Regular: 0,
  Inter_500Medium: 0,
  Inter_600SemiBold: 0,
  Inter_700Bold: 0,
  Inter_800ExtraBold: 0,
}));
