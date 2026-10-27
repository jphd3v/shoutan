#!/usr/bin/env node
// Draws the app icon into assets/: `npm run icons`. A black and a white stone on a
// corner of the wooden board, in the app's own colours (src/ui/theme.ts, src/ui/Stone.tsx).
// Shoutan Dev and Shoutan Local get a badge so the three builds can be told apart on a phone.
// Change the drawing here, run the script, look at the PNGs, and commit both.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

const FONT = 'node_modules/@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf';
const wood = { light: '#E8BC7C', dark: '#C38D4C', grid: '#4A3117', accent: '#F2A93B', ink: '#1C1306' };

// Everything is drawn on a 108-unit canvas, the size of an Android adaptive icon in dp.
// Launchers crop it to a shape inside the middle 72 units, so the stones stay in there.
const VIEW = 108;
const C = VIEW / 2;
const STEP = 26;
const lines = [-3, -2, -1, 0, 1, 2].map((k) => C - STEP / 2 + k * STEP);

const svg = (body, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEW} ${VIEW}">${body}</svg>`;

const board = () => `
  <defs>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${wood.light}"/>
      <stop offset="1" stop-color="${wood.dark}"/>
    </linearGradient>
  </defs>
  <rect width="${VIEW}" height="${VIEW}" fill="url(#wood)"/>
  ${lines.map((p) => `<line x1="${p}" y1="0" x2="${p}" y2="${VIEW}" stroke="${wood.grid}" stroke-width="1.4" stroke-opacity="0.85"/>`).join('')}
  ${lines.map((p) => `<line x1="0" y1="${p}" x2="${VIEW}" y2="${p}" stroke="${wood.grid}" stroke-width="1.4" stroke-opacity="0.85"/>`).join('')}`;

/** One stone, shaded like the in-game Stone component. */
const stone = (color, x, y, r) => {
  const id = `g-${color}`;
  const stops =
    color === 'black'
      ? '<stop offset="0" stop-color="#6B6B6B"/><stop offset="0.35" stop-color="#262626"/><stop offset="1" stop-color="#040404"/>'
      : '<stop offset="0" stop-color="#FFFFFF"/><stop offset="0.55" stop-color="#EFEBE3"/><stop offset="1" stop-color="#BDB4A6"/>';
  return `
  <defs>
    <radialGradient id="${id}" cx="36%" cy="30%" r="${color === 'black' ? 70 : 75}%">${stops}</radialGradient>
    <radialGradient id="shadow-${color}" cx="50%" cy="50%" r="50%">
      <stop offset="0.6" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${x + r * 0.1}" cy="${y + r * 0.16}" r="${r * 1.06}" fill="url(#shadow-${color})"/>
  <circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id})"/>`;
};

// Two stones on neighbouring diagonal points: the first moves of a game.
const R = 12.4;
const black = [lines[3], lines[4]];
const white = [lines[4], lines[3]];
const stones = () => stone('black', ...black, R) + stone('white', ...white, R);

const badge = (text) => {
  const w = 8 + text.length * 5.6;
  return `
  <rect x="${C - w / 2}" y="70" width="${w}" height="11" rx="5.5" fill="${wood.accent}" stroke="${wood.ink}" stroke-width="0.8"/>
  <text x="${C}" y="78.4" text-anchor="middle" font-family="Inter" font-weight="800" font-size="7.6" letter-spacing="0.5" fill="${wood.ink}">${text}</text>`;
};

/** The monochrome layer Android tints for themed icons: shapes only. */
const mono = () => `
  <circle cx="${black[0]}" cy="${black[1]}" r="${R}" fill="#fff"/>
  <circle cx="${white[0]}" cy="${white[1]}" r="${R - 1}" fill="none" stroke="#fff" stroke-width="2"/>`;

function png(file, body, size) {
  const out = new Resvg(svg(body, size), {
    fitTo: { mode: 'width', value: size },
    font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  writeFileSync(file, out.render().asPng());
  console.log(`wrote ${file}`);
}

for (const [variant, label] of [
  ['prod', null],
  ['dev', 'DEV'],
  ['local', 'LOCAL'],
]) {
  const suffix = variant === 'prod' ? '' : `-${variant}`;
  const extra = label ? badge(label) : '';
  png(`assets/android-icon-foreground${suffix}.png`, stones() + extra, 432);
  png(`assets/icon${suffix}.png`, board() + stones() + extra, 1024);
}
png('assets/android-icon-background.png', board(), 432);
png('assets/android-icon-monochrome.png', mono(), 432);
png('assets/favicon.png', board() + stones(), 48);
