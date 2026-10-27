/**
 * Vibration through the phone's vibrator. Android's touch-feedback effects (performHapticFeedback)
 * feel nicer but are silent whenever the phone's touch-vibration setting is off, and many phones
 * skip the tick effects, so a player could get no vibration at all. The player can turn vibration
 * off in Options, which is remembered on the phone.
 */
import 'expo-sqlite/localStorage/install';
import { ImpactFeedbackStyle, impactAsync, NotificationFeedbackType, notificationAsync, selectionAsync } from 'expo-haptics';

const KEY = 'go.vibration';
let enabled = readEnabled();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export const vibrationOn = () => enabled;

export function setVibrationOn(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered, but still applies for this session.
  }
}

export type Haptic = 'tick' | 'light' | 'medium' | 'warning' | 'success';

const EFFECTS: Record<Haptic, () => Promise<void>> = {
  tick: selectionAsync,
  light: () => impactAsync(ImpactFeedbackStyle.Light),
  medium: () => impactAsync(ImpactFeedbackStyle.Medium),
  warning: () => notificationAsync(NotificationFeedbackType.Warning),
  success: () => notificationAsync(NotificationFeedbackType.Success),
};

export async function haptic(kind: Haptic): Promise<void> {
  if (!enabled) return;
  // A phone without a vibrator, or one that refuses, simply stays still.
  await EFFECTS[kind]().catch(() => {});
}
