import { createHash } from 'node:crypto';
import { sha256 } from '../sha256';

describe('sha256', () => {
  it('matches the standard test vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with Node for every length across block boundaries and for non-ASCII text', () => {
    for (let n = 0; n < 200; n++) {
      const s = 'x'.repeat(n);
      expect(sha256(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
    for (const s of ['John Doe’s game ✓', 'ä ö å 碁 😀', '\u0000\n']) {
      expect(sha256(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
});
