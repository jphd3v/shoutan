/**
 * The game's sound effects (assets/sounds, made by scripts/make-sounds.mjs) and the
 * player's on/off choice, which is remembered on the phone. Sounds mix with other audio
 * and never take audio focus.
 */
import 'expo-sqlite/localStorage/install';
import { createAudioPlayer, preload, setAudioModeAsync } from 'expo-audio';
import capture from '../../assets/sounds/capture.wav';
import captureMany from '../../assets/sounds/captureMany.wav';
import end from '../../assets/sounds/end.wav';
import illegal from '../../assets/sounds/illegal.wav';
import pass from '../../assets/sounds/pass.wav';
import stone from '../../assets/sounds/stone.wav';
import tick from '../../assets/sounds/tick.wav';
import turn from '../../assets/sounds/turn.wav';
import undo from '../../assets/sounds/undo.wav';
import win from '../../assets/sounds/win.wav';
import type { SoundName } from './cues';

const SOURCES = {
  stone,
  capture,
  captureMany,
  illegal,
  pass,
  turn,
  tick,
  win,
  end,
  undo,
} satisfies Record<SoundName, number>;

const KEY = 'go.sound';
let enabled = readEnabled();
const players = new Map<SoundName, ReturnType<typeof createAudioPlayer>>();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Loads every sound up front so the first click plays without delay. */
export function loadSounds() {
  // Like other Android games, sound follows the media volume and ignores vibrate or silent ringer modes;
  // the speaker button in the app turns it off.
  void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
  for (const [name, source] of Object.entries(SOURCES) as [SoundName, number][]) {
    try {
      void preload(source).catch(() => {});
      players.set(name, createAudioPlayer(source));
    } catch {
      // A phone without audio output still plays the game.
    }
  }
}

export function play(name: SoundName) {
  if (!enabled) return;
  const player = players.get(name);
  if (!player) return;
  try {
    void player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    // Sound is decoration: never let it interrupt the game.
  }
}

export const soundOn = () => enabled;

export function setSoundOn(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered, but still applies for this session.
  }
}
