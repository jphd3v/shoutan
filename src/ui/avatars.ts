/** Animals a player can pick as their avatar; the card shows an empty disc for a player without one. */
export const AVATARS = [
  '🐶',
  '🐱',
  '🐭',
  '🐹',
  '🐰',
  '🦊',
  '🐻',
  '🐼',
  '🐨',
  '🐯',
  '🦁',
  '🐮',
  '🐷',
  '🐸',
  '🐵',
  '🐔',
  '🐧',
  '🐦',
  '🦉',
  '🐢',
  '🐙',
  '🦄',
  '🐝',
  '🦋',
] as const;

/** The bot's avatar: not one players can pick, so it is never mistaken for a person. */
export const BOT_AVATAR = '🤖';

export const isAvatar = (x: unknown): x is string => typeof x === 'string' && (AVATARS as readonly string[]).includes(x);
