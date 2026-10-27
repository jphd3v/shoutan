/**
 * Player-facing text in the player's language. The English text is the key, so code reads as
 * English; each other language has a table from English to its own text. `{name}` placeholders
 * are filled from `params`. Sentences that name a player get one key per name (e.g. "Black’s
 * turn to play"), since other languages inflect names differently.
 */
import { es } from './i18n/es';
import { fi } from './i18n/fi';
import { it } from './i18n/it';

export type Language = 'en' | 'fi' | 'es' | 'it';

/** Each language named in itself, as players look for it. */
export const LANGUAGES: readonly { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'fi', label: 'Suomi' },
  { value: 'es', label: 'Español' },
  { value: 'it', label: 'Italiano' },
];

export const TRANSLATIONS: Record<Exclude<Language, 'en'>, Readonly<Record<string, string>>> = { fi, es, it };

const isLanguage = (v: string): v is Language => LANGUAGES.some((l) => l.value === v);

/** The phone's language when the app has it, otherwise English. */
export function phoneLanguage(): Language {
  try {
    const code = new Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2).toLowerCase();
    return isLanguage(code) ? code : 'en';
  } catch {
    return 'en';
  }
}

let current: Language = phoneLanguage();

export const language = () => current;
export function setLanguage(l: Language) {
  current = l;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const text = current === 'en' ? key : (TRANSLATIONS[current][key] ?? key);
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
}

/** Marks text for translation where it is defined; `t` translates it where it is shown. */
export const phrase = (key: string) => key;
