import { ReactNode, useState } from 'react';
import { Text, View } from 'react-native';
import { BotNet, Level, LEVELS } from '../../go/rating';
import { Color, maxHandicap } from '../../go/rules';
import { BOT_LEVELS, type BoardSize, type BotLevel, type Opponent } from '../../go/session';
import { Button, IconButton, Segmented } from '../../ui/Buttons';
import { Dimmed } from '../../ui/Dimmed';
import { StepSlider } from '../../ui/StepSlider';
import { handicapText } from '../../ui/copy';
import { t } from '../../ui/i18n';
import type { GameChanges, HubProps } from './types';
import { styles } from './styles';
import { BOARD_HINT, botHint, HandicapSettings } from './parts';

/** Who is new to Go, and so is offered the recommended first game. */
/** The players the beginner game is offered to: those who have never played or know only the basics. */
export const isNew = (l: Level) => LEVELS.indexOf(l) <= LEVELS.indexOf('basics');

export function Setup(
  p: Pick<
    HubProps,
    | 'botHandicap'
    | 'botLevelFor'
    | 'botRank'
    | 'humanBot'
    | 'coach'
    | 'confirmMoves'
    | 'rank'
    | 'current'
    | 'currentSetup'
    | 'onResume'
    | 'onStartGame'
    | 'profile'
  > & {
    opponent: Opponent;
    onBack: () => void;
    /** Brings the end of the page into view, where the confirmation replaces Start. */
    onReveal?: () => void;
  },
) {
  const vsBot = p.opponent === 'ai';
  // Setting up the same kind of game as the last one starts from its choices, to play again with a change or two.
  const last = p.currentSetup;
  const same = last.opponent === p.opponent;
  const [size, setSize] = useState<BoardSize>(last.size);
  const [handicap, setHandicap] = useState(same ? last.handicap : 0);
  const [color, setColor] = useState<Color>(same && vsBot ? last.humanColor : 'black');
  // The bot plays the human-like network where the phone can run it, unless the player chose KataGo for the last game.
  const lastNet: BotNet = p.humanBot ? (same && vsBot && last.botNet) || 'human' : 'kata';
  const [net, setNet] = useState<BotNet>(lastNet);
  // The bot starts at the level that suits the player, so it levels up as they do, moved as far as they
  // moved it from that level for the last game.
  const lean = same && vsBot && last.bot ? last.bot - p.botLevelFor(last.size, lastNet) : 0;
  const leaning = (s: BoardSize, n: BotNet) => Math.min(BOT_LEVELS.length, Math.max(1, p.botLevelFor(s, n) + lean)) as BotLevel;
  const [bot, setBot] = useState<BotLevel>(leaning(last.size, lastNet));
  // A start that would replace the unfinished game waits here for the player to choose.
  const [pending, setPending] = useState<{ changes: GameChanges; beginner: boolean } | null>(null);

  const start = (changes: GameChanges, beginner = false) => {
    if (p.current?.opponent) setPending({ changes, beginner });
    else p.onStartGame(changes, { confirmMoves: p.confirmMoves, beginner });
  };
  const suggested = vsBot ? p.botHandicap(size, bot, net) : 0;
  const levelLine = t('Level {n} of {max} · about {rank}', { n: bot, max: BOT_LEVELS.length, rank: p.botRank(size, bot, net) });
  // While the start waits for the player's choice, the setup steps back, and a tap on it cancels.
  const dim = (node: ReactNode) => (
    <Dimmed when={!!pending} onTap={() => setPending(null)} testID="hub-dimmed">
      {node}
    </Dimmed>
  );

  return (
    <>
      {dim(
        <View style={styles.setupHeader}>
          <IconButton label={t('Back')} icon="arrow-back" testID="hub-back" size={44} onPress={p.onBack} />
          <Text style={styles.setupTitle}>{vsBot ? t('Play the bot') : t('Play on this device')}</Text>
        </View>,
      )}

      {isNew(p.profile.level) &&
        dim(
          <View style={styles.recommended}>
            <Text style={styles.recommendedTitle}>{t('New to Go?')}</Text>
            <Text style={styles.hint}>{t('Start with a small board and the Coach pointing out what matters.')}</Text>
            <Button
              label={t('Start a beginner game')}
              icon="school-outline"
              testID="hub-beginner"
              onPress={() => start({ opponent: p.opponent, size: 9, handicap: 0, humanColor: 'black', bot: 1, botNet: net }, true)}
            />
          </View>,
        )}

      {vsBot &&
        dim(
          <View style={styles.section}>
            <Text style={styles.label}>{t('Bot')}</Text>
            {p.humanBot && (
              <Segmented<BotNet>
                value={net}
                onChange={(next) => {
                  setNet(next);
                  setBot((b) => (b === leaning(size, net) ? leaning(size, next) : b));
                }}
                options={[
                  { value: 'human', label: t('Human-like'), testID: 'hub-net-human' },
                  { value: 'kata', label: t('KataGo'), testID: 'hub-net-kata' },
                ]}
              />
            )}
            {!p.humanBot && (
              <Text style={styles.hint} testID="hub-net-note">
                {t('Plays with KataGo. Human-like play needs a phone with at least 5 GB of memory.')}
              </Text>
            )}
            <StepSlider
              value={bot}
              steps={BOT_LEVELS.length}
              onChange={(v) => setBot(v as BotLevel)}
              ends={[t('Easier'), t('Harder')]}
              mark={{ at: p.botLevelFor(size, net), label: t('Suits you') }}
              label={t('Bot')}
              valueText={levelLine}
              testID="hub-bot"
            />
            <Text style={styles.hint}>{botHint(bot, net === 'human')}</Text>
            {p.coach && (
              <Text style={styles.hint} testID="hub-coach-note">
                {t('The Coach is on, so this game won’t count for your rating.')}
              </Text>
            )}
            {p.rank !== null && (
              <Text style={styles.hint}>
                {t('Level {n} of {max} · about {rank} · you {mine}', {
                  n: bot,
                  max: BOT_LEVELS.length,
                  rank: p.botRank(size, bot, net),
                  mine: p.rank,
                })}
              </Text>
            )}
          </View>,
        )}

      {dim(
        <View style={styles.section}>
          <Text style={styles.label}>{t('Board')}</Text>
          <Segmented<BoardSize>
            value={size}
            onChange={(next) => {
              setSize(next);
              setBot((b) => (b === leaning(size, net) ? leaning(next, net) : b));
              setHandicap((h) => Math.min(h, maxHandicap(next)));
            }}
            options={[
              { value: 9, label: '9×9', testID: 'hub-size-9' },
              { value: 13, label: '13×13', testID: 'hub-size-13' },
              { value: 19, label: '19×19', testID: 'hub-size-19' },
            ]}
          />
          <Text style={styles.hint}>{BOARD_HINT[size]()}</Text>
          {vsBot && (
            <Segmented<Color>
              value={color}
              onChange={setColor}
              options={[
                { value: 'black', label: t('Play Black'), testID: 'hub-black' },
                { value: 'white', label: t('Play White'), testID: 'hub-white' },
              ]}
            />
          )}
        </View>,
      )}

      {dim(
        <View style={styles.section}>
          <HandicapSettings
            size={size}
            handicap={handicap}
            onHandicap={setHandicap}
            prefix="hub"
            valueTestID="hub-handicap-value"
            titleStyle={styles.disclosureTitle}
          >
            {/* The suggestion is the stones the player takes as Black; as White they would give them to the bot. */}
            {vsBot && color === 'black' && (
              <Text style={styles.hint}>{t('Suggested for your level: {stones}', { stones: handicapText(suggested) })}</Text>
            )}
          </HandicapSettings>
        </View>,
      )}

      {pending ? (
        <View style={styles.confirm} testID="hub-replace-confirm" onLayout={p.onReveal}>
          <Text style={styles.confirmText}>{t('Your current game will be lost.')}</Text>
          <View style={styles.confirmRow}>
            <Button label={t('Keep playing')} testID="hub-keep" flex onPress={p.onResume} />
            <Button
              label={t('Start')}
              variant="primary"
              testID="hub-discard"
              flex
              onPress={() =>
                p.onStartGame(pending.changes, {
                  confirmMoves: p.confirmMoves,
                  beginner: pending.beginner,
                })
              }
            />
          </View>
        </View>
      ) : (
        <Button
          label={t('Start game')}
          icon="play"
          variant="primary"
          testID="hub-start"
          onPress={() =>
            start({ opponent: p.opponent, size, handicap, humanColor: vsBot ? color : 'black', ...(vsBot ? { bot, botNet: net } : {}) })
          }
        />
      )}
    </>
  );
}
