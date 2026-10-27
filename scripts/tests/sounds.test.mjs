import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { RATE, SOUNDS, writeSounds } from '../make-sounds.mjs';

describe('sound effects', () => {
  it('the committed files are exactly what make-sounds.mjs produces', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sounds-'));
    writeSounds(dir);
    assert.deepEqual(readdirSync('assets/sounds').sort(), readdirSync(dir).sort());
    for (const f of readdirSync(dir)) {
      assert.ok(readFileSync(join(dir, f)).equals(readFileSync(join('assets/sounds', f))), `${f} differs: run npm run sounds`);
    }
  });

  it('every sound is short, audible and never clips', () => {
    for (const [name, make] of Object.entries(SOUNDS)) {
      const data = make();
      const seconds = data.length / RATE;
      const peak = Math.max(...data.map(Math.abs));
      assert.ok(seconds > 0.02 && seconds <= 1.5, `${name} lasts ${seconds}s`);
      assert.ok(peak > 0.2 && peak <= 0.81, `${name} peaks at ${peak}`);
      assert.ok(Math.abs(data[data.length - 1]) < 0.01, `${name} ends abruptly`);
    }
  });
});
