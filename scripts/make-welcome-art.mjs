#!/usr/bin/env node
// Draws the welcome screen's picture into assets/welcome-cats.png: `npm run welcome-art`. The two
// cats at their table, cut from the cover painting (assets/splash.jpg) with edges that fade out,
// so the picture sits on the dark screen without a frame. Change it here, run it, look at the PNG,
// and commit both.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

// The cover's size, and the part of it with the cats, the table and the bowls, in its own pixels.
const COVER = { width: 941, height: 1672 };
const CROP = { x: 0, y: 960, width: 941, height: 660 };
const { width: W, height: H } = CROP;
// How far in from each edge the picture fades out. The cats nearly fill the width, so the sides fade
// quickly; the wall above and the floor below have room for a long, slow fade, which keeps the
// picture from reading as a cut-out oval.
const FADE = { side: 95, top: 330, bottom: 200 };

const cover = readFileSync('assets/splash.jpg').toString('base64');
const cut = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${CROP.x} ${CROP.y} ${W} ${H}">
  <image x="0" y="0" width="${COVER.width}" height="${COVER.height}" href="data:image/jpeg;base64,${cover}"/>
</svg>`;
const pixels = Buffer.from(new Resvg(cut).render().pixels);

const smooth = (t) => t * t * t * (t * (6 * t - 15) + 10);
// How far inside the picture a point is: 0 at an edge, 1 past every fade, the corners rounded off.
function inside(x, y) {
  const a = Math.max(0, 1 - Math.min(x, W - x) / FADE.side);
  const b = Math.max(0, 1 - y / FADE.top);
  const c = Math.max(0, 1 - (H - y) / FADE.bottom);
  return Math.max(0, 1 - Math.cbrt(a ** 3 + b ** 3 + c ** 3));
}
// An S-curve, raised to a power so the outer part stays faint longer: the fade is slow, with no line.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pixels[(y * W + x) * 4 + 3] = Math.round(255 * smooth(inside(x, y)) ** 1.4);

function png(rgba) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(W, 0);
  header.writeUInt32BE(H, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  // Each row starts with its filter type, 0 (none).
  const rows = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) rgba.copy(rows, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('assets/welcome-cats.png', png(pixels));
console.log('Wrote assets/welcome-cats.png');
