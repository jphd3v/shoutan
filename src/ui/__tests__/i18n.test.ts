import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { setLanguage, t, TRANSLATIONS } from '../i18n';

const root = join(__dirname, '../../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'i18n' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = [join(root, 'App.tsx'), ...sources(join(root, 'src/ui')), ...sources(join(root, 'src/screens'))];
const code = files.map((f) => readFileSync(f, 'utf8'));

/** Every text passed to `t` or `phrase` as a literal: the keys each language must have. */
const keys = new Set(code.flatMap((c) => [...c.matchAll(/\b(?:t|phrase)\(\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'"))));

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('finds the keys in the code', () => {
    expect(keys.size).toBeGreaterThan(150);
    expect(keys.has('There’s already a stone there.')).toBe(true);
  });

  it('never builds a key at run time from a template', () => {
    const templated = code.filter((c) => /\b(?:t|phrase)\(\s*`/.test(c));
    expect(templated).toEqual([]);
  });

  for (const [language, table] of Object.entries(TRANSLATIONS)) {
    it(`${language} translates every key and nothing else`, () => {
      const missing = [...keys].filter((k) => !(k in table));
      const extra = Object.keys(table).filter((k) => !keys.has(k));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it(`${language} keeps every placeholder`, () => {
      const broken = Object.entries(table).filter(([k, v]) => placeholders(k).join() !== placeholders(v).join());
      expect(broken).toEqual([]);
    });
  }

  it('fills placeholders and falls back to English', () => {
    setLanguage('en');
    expect(t('You can capture {n} stones.', { n: 3 })).toBe('You can capture 3 stones.');
    setLanguage('fi');
    expect(t('You can capture {n} stones.', { n: 3 })).toBe(TRANSLATIONS.fi['You can capture {n} stones.'].replace('{n}', '3'));
    expect(t('not a key')).toBe('not a key');
    setLanguage('en');
  });
});
