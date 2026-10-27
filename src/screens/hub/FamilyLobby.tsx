import { ReactNode, useEffect, useState } from 'react';
import { Keyboard, Text, TextInput, View } from 'react-native';
import { Color, maxHandicap } from '../../go/rules';
import type { BoardSize } from '../../go/session';
import type { GameRow } from '../../net/api';
import { Button, Checkbox, IconButton, Segmented } from '../../ui/Buttons';
import { handicapText } from '../../ui/copy';
import { t } from '../../ui/i18n';
import { colors } from '../../ui/theme';
import { lobbySections, opponentIn, stonesText } from '../onlineMatch';
import { lobbyGameText, lobbyProblemText, seenText } from '../onlineText';
import type { HubOnline, HubProps } from './types';
import { AccountPanel } from './AccountPanel';
import { styles } from './styles';
import { TextLink } from '../../ui/Menu';
import { BOARD_HINT, HandicapSettings } from './parts';

/** Play online: join the family once, then create a game or open one of yours. */
export function OnlineView(
  p: Pick<HubProps, 'online' | 'confirmMoves' | 'profile' | 'account' | 'canJoin' | 'kept' | 'current' | 'onResume'> & {
    onBack: () => void;
    onProfile: () => void;
  },
) {
  const online = p.online;
  const watch = online?.watch;
  useEffect(() => watch?.(), [watch]);
  const header = (
    <View style={styles.setupHeader}>
      <IconButton label={t('Back')} icon="arrow-back" testID="hub-back" size={44} onPress={p.onBack} />
      <Text style={styles.setupTitle}>{t('Play online')}</Text>
    </View>
  );
  if (p.canJoin && !p.account)
    return (
      <View testID="hub-online" style={styles.column}>
        {header}
        <AccountPanel account={null} />
      </View>
    );
  // Just signed in: the lobby is on its way.
  if (!online && p.account) return <View style={styles.column}>{header}</View>;
  if (!online)
    return (
      <View testID="hub-online" style={styles.column}>
        {header}
        <Text style={styles.hint}>{t('Online play is not configured in this build.')}</Text>
      </View>
    );
  if (online.state.unavailable)
    return (
      <View testID="hub-online" style={styles.column}>
        {header}
        <View style={styles.section} testID="online-unavailable">
          <Text style={styles.disclosureTitle}>{t('Online play isn’t ready')}</Text>
          <Text style={styles.hint}>
            {t('Online play isn’t switched on yet. Meanwhile you can play against the bot, or with someone next to you on this phone.')}
          </Text>
        </View>
      </View>
    );
  return <FamilyLobby {...p} online={online} header={header} />;
}

export function FamilyLobby(
  p: Pick<HubProps, 'confirmMoves' | 'profile' | 'kept' | 'current' | 'onResume'> & {
    online: HubOnline;
    header: ReactNode;
    onProfile: () => void;
  },
) {
  const { state } = p.online;
  const { me, games, busy, problem } = state;
  const [code, setCode] = useState('');
  const [size, setSize] = useState<BoardSize>(9);
  const [color, setColor] = useState<Color>('black');
  const [handicap, setHandicap] = useState(0);
  const [confirm, setConfirm] = useState(p.confirmMoves);
  const [asked, setAsked] = useState<string | null>(null);
  // Opening or creating a game that would replace the unfinished game on this phone waits here for the player to choose.
  const [pending, setPending] = useState<{ key: string; label: string; run: () => void } | null>(null);
  const act = (key: string, label: string, run: () => void) => (p.current?.opponent ? setPending({ key, label, run }) : run());
  const replaceConfirm = (key: string) =>
    pending?.key === key && (
      <View style={styles.confirm} testID="lobby-replace-confirm">
        <Text style={styles.confirmText}>{t('Your current game will be lost.')}</Text>
        <View style={styles.confirmRow}>
          <Button label={t('Keep playing')} testID="lobby-keep" flex onPress={p.onResume} />
          <Button
            label={pending.label}
            variant="primary"
            testID="lobby-discard"
            flex
            onPress={() => {
              setPending(null);
              pending.run();
            }}
          />
        </View>
      </View>
    );
  // "Online now" ends by the clock, with no refresh to say so.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, []);
  const { mine, asks: invitations, open } = lobbySections(games, me?.id, p.kept);
  const person = state.people.find((x) => x.id === asked);
  const createLabel = person ? t('Ask {name} to play', { name: person.name }) : t('Create game');
  const gameRow = (g: GameRow, isMine: boolean) => {
    if (!me) return null;
    const details = [
      `${g.size}×${g.size}`,
      ...(g.invited === me.id ? [g.black ? t('You play White') : t('You play Black')] : []),
      ...(g.handicap ? [handicapText(g.handicap)] : []),
      ...[stonesText(p.profile.rating, state.ratingOf(opponentIn(g, me.id)))].filter(Boolean),
    ].join(' · ');
    const label = isMine ? t('Open game') : t('Join game');
    return (
      <View key={g.id}>
        <View style={styles.gameRow}>
          <View style={styles.gameText}>
            <Text style={styles.gameTitle} numberOfLines={1}>
              {[state.avatarOf(opponentIn(g, me.id)), state.nameOf(opponentIn(g, me.id)) ?? t('Opponent')].filter(Boolean).join(' ')}
            </Text>
            <Text style={styles.hint}>{lobbyGameText(g, me.id, state.nameOf)}</Text>
            <Text style={styles.hint}>{details}</Text>
          </View>
          <Button
            label={label}
            variant={isMine ? 'secondary' : 'primary'}
            testID={`join-${g.id}`}
            disabled={busy}
            onPress={() => act(g.id, label, () => p.online.onOpen(g.id))}
          />
        </View>
        {replaceConfirm(g.id)}
      </View>
    );
  };

  return (
    <View testID="hub-online" style={styles.column}>
      {p.header}
      {problem ? (
        <Text style={styles.error} testID="online-error">
          {lobbyProblemText(problem)}
        </Text>
      ) : !state.online ? (
        <Text style={styles.hint}>{t('Offline. Trying again…')}</Text>
      ) : null}

      {me === null || (me === undefined && !state.online) ? (
        <View style={styles.section}>
          <Text style={styles.hint}>{t('Enter the family code once to find each other and play online.')}</Text>
          <Text style={styles.hint} testID="joining-as">
            {t('You join as {name}.', { name: p.profile.name ?? '' })}
          </Text>
          {problem === 'nameTaken' && (
            <TextLink label={t('Change your name')} icon="person-outline" testID="online-profile" onPress={p.onProfile} />
          )}
          <Text style={styles.label}>{t('Family code')}</Text>
          <TextInput
            style={styles.nameInput}
            value={code}
            onChangeText={setCode}
            secureTextEntry
            autoCapitalize="none"
            placeholder={t('Family code')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('Family code')}
            testID="family-code"
          />
          <Button
            label={t('Join')}
            icon="people-outline"
            variant="primary"
            testID="register"
            disabled={busy || !code}
            onPress={() => {
              Keyboard.dismiss();
              void p.online.onRegister(code).then((joined) => {
                if (joined) setCode('');
              });
            }}
          />
        </View>
      ) : me === undefined ? null : (
        <>
          <Text style={styles.hint} testID="online-name">
            {t('Playing as {name}', { name: me.name })}
          </Text>
          {invitations.length > 0 && (
            <View style={styles.section} testID="invitations">
              <Text style={styles.disclosureTitle}>{t('Wants to play with you')}</Text>
              {invitations.map((g) => gameRow(g, false))}
            </View>
          )}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.disclosureTitle}>{t('In progress')}</Text>
              <IconButton
                label={t('Refresh')}
                icon="refresh"
                testID="refresh-lobby"
                size={40}
                disabled={busy}
                onPress={p.online.onRefresh}
              />
            </View>
            {mine.length === 0 && <Text style={styles.hint}>{t('No games yet. Create one, or ask another player to create one.')}</Text>}
            {mine.map((g) => gameRow(g, true))}
          </View>

          {state.people.length > 0 && (
            <View style={styles.section} testID="people">
              <Text style={styles.disclosureTitle}>{t('Players')}</Text>
              {state.people.map((x) => {
                const online = state.isOnline(x.id);
                return (
                  <View key={x.id} style={styles.gameRow}>
                    <View style={styles.gameText}>
                      <Text style={styles.gameTitle} numberOfLines={1}>
                        {[x.avatar, x.name].filter(Boolean).join(' ')}
                      </Text>
                      <Text style={styles.hint}>{seenText(online, x.last_seen_at, state.now())}</Text>
                    </View>
                    <Button
                      label={asked === x.id ? t('Not now') : t('Ask to play')}
                      variant={asked === x.id ? 'secondary' : 'primary'}
                      testID={`person-${x.id}`}
                      disabled={busy}
                      onPress={() => setAsked(asked === x.id ? null : x.id)}
                    />
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.disclosureTitle}>{person ? t('Ask {name} to play', { name: person.name }) : t('New game')}</Text>
            <Text style={styles.label}>{t('Board')}</Text>
            <Segmented<BoardSize>
              value={size}
              onChange={(next) => {
                setSize(next);
                setHandicap((h) => Math.min(h, maxHandicap(next)));
              }}
              options={([9, 13, 19] as const).map((value) => ({ value, label: `${value}×${value}`, testID: `online-size-${value}` }))}
            />
            <Text style={styles.hint}>{BOARD_HINT[size]()}</Text>
            <Checkbox label={t('Tap twice to place a stone')} checked={confirm} testID="hub-confirm" onChange={setConfirm} />
            <Segmented<Color>
              value={color}
              onChange={setColor}
              options={[
                { value: 'black', label: t('Play Black'), testID: 'online-black' },
                { value: 'white', label: t('Play White'), testID: 'online-white' },
              ]}
            />
            <HandicapSettings
              size={size}
              handicap={handicap}
              onHandicap={setHandicap}
              prefix="online"
              valueTestID="online-handicap"
              titleStyle={styles.label}
            />
            {replaceConfirm('create') || (
              <Button
                label={createLabel}
                icon="add"
                variant="primary"
                testID="create-game"
                disabled={busy}
                onPress={() =>
                  act('create', createLabel, () => {
                    p.online.onCreate({ size, color, handicap, confirmMoves: confirm, ask: person?.id });
                    setAsked(null);
                  })
                }
              />
            )}
          </View>

          {open.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.disclosureTitle}>{t('Games to join')}</Text>
              {open.map((g) => gameRow(g, false))}
            </View>
          )}
        </>
      )}
    </View>
  );
}
