import { StyleSheet, Text } from 'react-native';
import { BOT_NET, HUMAN_NET } from '../../modules/go-net';
import { humanLooseness, HumanStyle } from '../go/human';
import { loosenessAt } from '../go/katago';
import { botRating, BotNet, rankName } from '../go/rating';
import type { BotLevel } from '../go/session';
import { t } from '../ui/i18n';
import notices from '../ui/notices.json';
import { Sheet } from '../ui/Sheet';
import { colors, fonts } from '../ui/theme';
import { botHint } from './hub/parts';
import { Fact, Folded, ProfileHeader, StatTiles } from './ProfileCard';
import { BOT_AVATAR } from '../ui/avatars';

/** The rank a human-style profile imitates: KataGo counts inverse ranks from 9 dan (1) down. */
const imitated = (style: HumanStyle) => (style.inverse >= 10 ? `${style.inverse - 9}k` : `${10 - style.inverse}d`);
const percent = (x: number) => `${Math.round(x * 1000) / 10}%`;
const onnx: { version?: string } | undefined = notices.works.find((w) => w.name === 'ONNX Runtime');

/**
 * The bot of the game on screen, opened from its picture: what it is like in plain words first, then how it
 * chooses its moves, for the curious. `style` is set when the human-style network plays.
 */
export function BotSheet(p: { visible: boolean; onClose: () => void; level: BotLevel; size: number; style: HumanStyle | null }) {
  const net: BotNet = p.style ? 'human' : 'kata';
  const rating = Math.round(botRating(p.level, p.size, net));
  const loose = p.style ? humanLooseness(p.style) : loosenessAt(p.size, p.level);
  const rows: [string, string][] = [
    [
      t('Network'),
      p.style
        ? `${HUMAN_NET}: ${t('KataGo’s human-style network, 18 blocks × 384 channels, trained on human games')}`
        : `${BOT_NET}: ${t('a small KataGo network, 10 blocks × 128 channels, from the kata1 training run')}`,
    ],
    ...(p.style
      ? ([
          [t('Rank profile'), t('{rank}, as on the KGS server', { rank: imitated(p.style) })],
          [t('Passing and dead stones'), t('judged by {net}', { net: BOT_NET })],
        ] as [string, string][])
      : []),
    [t('Search'), t('none: one reading of the network per move')],
    [
      t('Move choice'),
      loose.heat === 0
        ? t('always the network’s favourite move')
        : t('temperature {heat}, never a move under {floor} of the favourite’s chance', {
            heat: String(loose.heat),
            floor: percent(loose.floor),
          }),
    ],
    ...(loose.slip
      ? ([[t('Slips'), t('on {share} of moves, any of the {n} likeliest', { share: percent(loose.slip), n: String(loose.wide ?? 0) })]] as [
          string,
          string,
        ][])
      : []),
    [t('Randomness'), t('seeded by the position: the same position gets the same move')],
    [t('Runs on'), t('this phone, with ONNX Runtime {v}', { v: onnx?.version ?? '' })],
  ];
  return (
    <Sheet visible={p.visible} onClose={p.onClose} testID="bot-sheet">
      <ProfileHeader
        avatar={BOT_AVATAR}
        name={t('Bot')}
        subtitle={t('Level {n} of 7 · {net}', { n: p.level, net: p.style ? t('Human-like') : t('KataGo') })}
      />
      <StatTiles
        tiles={[
          { value: rankName(rating), label: t('Rank') },
          { value: String(rating), label: t('Rating') },
          { value: `${p.level}/7`, label: t('Level') },
        ]}
      />
      <Text style={styles.hint}>{botHint(p.level, !!p.style)}</Text>
      <Text style={styles.detail}>
        {p.style
          ? t('Plays like a human of about {rank}, at about {strength} on this board.', {
              rank: imitated(p.style),
              strength: rankName(rating),
            })
          : t('Plays at about {strength} on this board.', { strength: rankName(rating) })}
      </Text>
      <Folded title={t('Under the hood')} testID="bot-details">
        {rows.map(([label, value]) => (
          <Fact key={label} label={label} value={value} />
        ))}
      </Folded>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 24, color: colors.text, marginBottom: 6 },
  detail: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.textMuted, marginBottom: 4 },
});
