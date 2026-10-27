#!/usr/bin/env node
// Synthesises the game's sound effects into assets/sounds/*.wav: `npm run sounds`.
// Everything is computed from fixed seeds, so the files are identical on every run;
// scripts/tests/sounds.test.mjs checks that the committed files match this script.
// Change a sound here, run the script, listen, and commit both.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const RATE = 22050;

/** Seeded noise in [-1, 1], so "random" textures never change between runs. */
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

const samples = (seconds) => new Float64Array(Math.round(seconds * RATE));

/** Adds a decaying sine "bell" partial starting at `at` seconds. */
function tone(out, { at = 0, freq, decay, gain, attack = 0.004 }) {
  const start = Math.round(at * RATE);
  for (let i = 0; start + i < out.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / attack) * Math.exp(-t / decay);
    if (env < 1e-4 && t > attack) break;
    out[start + i] += gain * env * Math.sin(2 * Math.PI * freq * t);
  }
}

/**
 * Adds a short knock: noise through a resonant band-pass (the wood) plus a low thump
 * (the board). `bright` sets the resonance, `decay` how long it rings.
 */
function knock(out, { at = 0, bright, decay, gain, seed, thump = 0.5 }) {
  const rnd = noise(seed);
  const start = Math.round(at * RATE);
  const w = (2 * Math.PI * bright) / RATE;
  const q = 9;
  const alpha = Math.sin(w) / (2 * q);
  const [b0, b2, a0, a1, a2] = [alpha, -alpha, 1 + alpha, -2 * Math.cos(w), 1 - alpha];
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; start + i < out.length; i++) {
    const t = i / RATE;
    const env = Math.exp(-t / decay);
    if (env < 1e-4) break;
    const x = rnd() * Math.exp(-t / 0.004);
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    const low = thump * Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t / 0.025);
    out[start + i] += gain * (y * 6 * env + low);
  }
}

function normalise(out, peak) {
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  // Short fade at the end so playback never clicks.
  const fade = Math.min(out.length, Math.round(0.01 * RATE));
  for (let i = 0; i < out.length; i++) {
    out[i] = (out[i] / max) * peak;
    if (i >= out.length - fade) out[i] *= (out.length - i) / fade;
  }
  return out;
}

export const SOUNDS = {
  /** A stone placed on the board: a short, bright clack. */
  stone() {
    const out = samples(0.16);
    knock(out, { bright: 2600, decay: 0.03, gain: 1, seed: 1, thump: 0.6 });
    knock(out, { at: 0.004, bright: 4200, decay: 0.012, gain: 0.35, seed: 2, thump: 0 });
    return normalise(out, 0.8);
  },
  /** A few stones lifted off: light clicks close together. */
  capture() {
    const out = samples(0.3);
    [0, 0.055, 0.12].forEach((at, i) =>
      knock(out, { at, bright: 3400 + i * 400, decay: 0.018, gain: 0.7 - i * 0.12, seed: 10 + i, thump: 0.1 }),
    );
    return normalise(out, 0.7);
  },
  /** Many stones lifted off: a longer rattle. */
  captureMany() {
    const out = samples(0.55);
    for (let i = 0; i < 8; i++) {
      knock(out, {
        at: i * 0.045 + (i % 3) * 0.008,
        bright: 3000 + (i % 4) * 450,
        decay: 0.016,
        gain: 0.8 - i * 0.06,
        seed: 20 + i,
        thump: 0.08,
      });
    }
    return normalise(out, 0.75);
  },
  /** A refused move: a soft, low two-note "nope". */
  illegal() {
    const out = samples(0.3);
    tone(out, { freq: 330, decay: 0.07, gain: 0.6 });
    tone(out, { at: 0.11, freq: 247, decay: 0.09, gain: 0.6 });
    return normalise(out, 0.45);
  },
  /** A pass: one soft, low tone that fades in, quieter than the other sounds. */
  pass() {
    const out = samples(0.5);
    tone(out, { freq: 330, decay: 0.14, gain: 1, attack: 0.03 });
    tone(out, { freq: 660, decay: 0.07, gain: 0.12, attack: 0.03 });
    return normalise(out, 0.24);
  },
  /** A move taken back: a soft, low tap, quieter than placing a stone. */
  undo() {
    const out = samples(0.12);
    knock(out, { bright: 1500, decay: 0.022, gain: 1, seed: 50, thump: 0.4 });
    return normalise(out, 0.3);
  },
  /** The other player moved (online): two gentle bells. */
  turn() {
    const out = samples(0.6);
    tone(out, { freq: 784, decay: 0.18, gain: 0.5 });
    tone(out, { freq: 1568, decay: 0.08, gain: 0.12 });
    tone(out, { at: 0.12, freq: 1047, decay: 0.22, gain: 0.5 });
    return normalise(out, 0.45);
  },
  /** One point of territory counted. */
  tick() {
    const out = samples(0.04);
    tone(out, { freq: 2093, decay: 0.008, gain: 1, attack: 0.001 });
    return normalise(out, 0.3);
  },
  /** A win: a rising arpeggio. */
  win() {
    const out = samples(1.3);
    [523, 659, 784, 1047].forEach((freq, i) => {
      tone(out, { at: i * 0.11, freq, decay: 0.35, gain: 0.5 });
      tone(out, { at: i * 0.11, freq: freq * 2, decay: 0.12, gain: 0.1 });
    });
    return normalise(out, 0.6);
  },
  /** The game ended otherwise: calm, falling bells. */
  end() {
    const out = samples(1);
    tone(out, { freq: 659, decay: 0.3, gain: 0.5 });
    tone(out, { at: 0.16, freq: 523, decay: 0.45, gain: 0.5 });
    return normalise(out, 0.45);
  },
};

/** 16-bit mono PCM WAV. */
export function wav(data) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return buf;
}

export function writeSounds(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [name, make] of Object.entries(SOUNDS)) writeFileSync(join(dir, `${name}.wav`), wav(make()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeSounds('assets/sounds');
  console.log(`Wrote ${Object.keys(SOUNDS).length} sounds to assets/sounds/.`);
}
