import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Opponent } from '../go/session';
import { AboutLine } from '../ui/AboutLine';
import { IconButton } from '../ui/Buttons';
import { t } from '../ui/i18n';
import { useReduceMotion } from '../ui/motion';
import { colors } from '../ui/theme';
import type { HubProps } from './hub/types';

export type { HubOnline } from './hub/types';
import { styles } from './hub/styles';
import { MenuFooter, MenuRow } from '../ui/Menu';
import { gameSummary } from './gameText';
import { Setup } from './hub/Setup';
import { OnlineView } from './hub/FamilyLobby';
import { ProfileView } from './hub/ProfileView';
import { Welcome } from './hub/Welcome';

type HubView = 'home' | 'profile' | 'online' | 'options' | Opponent;

/** The first screen: continue the current game, pick a way to play, and then set that game up. */
export function MainHub(p: HubProps) {
  const [view, setView] = useState<HubView>(p.initialView ?? 'home');
  // Leaving the profile saves the name first, by the back arrow or Android's back alike.
  const leaveProfile = useRef<() => void>(() => setView('home'));
  const scroll = useRef<ScrollView>(null);
  const welcomeBack = useRef<() => void>(() => {});
  const { visible, initialView } = p;
  const leaveSetup = view === initialView && p.onSetupBack ? p.onSetupBack : () => setView('home');
  useEffect(() => {
    if (visible) setView(initialView ?? 'home');
  }, [visible, initialView]);

  // A player without a name has not been welcomed yet: nothing else can be reached until they are.
  const welcome = !p.profile.name;
  // When the welcome ends, it shrinks into the profile chip, so the player knows where to find it again.
  const reduceMotion = useReduceMotion();
  const [shrinking, setShrinking] = useState(false);
  const chipPulse = useRef(new Animated.Value(1)).current;
  const wasWelcome = useRef(welcome);
  useEffect(() => {
    if (wasWelcome.current && !welcome && visible && !reduceMotion) setShrinking(true);
    wasWelcome.current = welcome;
  }, [welcome, visible, reduceMotion]);
  const shrunk = useCallback(() => {
    setShrinking(false);
    Animated.sequence([
      Animated.timing(chipPulse, { toValue: 1.15, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(chipPulse, { toValue: 1, duration: 220, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [chipPulse]);

  return (
    <Modal
      visible={p.visible}
      animationType="slide"
      transparent={false}
      onRequestClose={
        welcome
          ? () => welcomeBack.current()
          : view === 'home'
            ? (p.onClose ?? (() => {}))
            : view === 'profile'
              ? () => leaveProfile.current()
              : view === 'options'
                ? () => setView('home')
                : leaveSetup
      }
    >
      <SafeAreaView style={styles.screen}>
        {/* The welcome and profile have fields low down: the page shrinks above the keyboard so they can scroll into view. */}
        <KeyboardAvoidingView behavior="padding" style={styles.keyboard}>
          <ScrollView
            ref={scroll}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {welcome ? (
              <Welcome {...p} back={welcomeBack} />
            ) : view === 'home' ? (
              <Home {...p} onView={setView} chipScale={chipPulse} />
            ) : view === 'profile' ? (
              <ProfileView
                {...p}
                onBack={initialView === 'profile' && p.onClose ? p.onClose : () => setView('home')}
                leave={leaveProfile}
              />
            ) : view === 'online' ? (
              <OnlineView {...p} onBack={leaveSetup} onProfile={() => setView('profile')} />
            ) : view === 'options' ? (
              <OptionsView settings={p.settings} onBack={() => setView('home')} />
            ) : (
              <Setup key={view} {...p} opponent={view} onBack={leaveSetup} onReveal={() => scroll.current?.scrollToEnd()} />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
        {shrinking && <ShrinkToChip profile={p.profile} onDone={shrunk} />}
      </SafeAreaView>
    </Modal>
  );
}

/** The finished welcome, as a card with the player's animal and name, shrinking into the profile chip. */
function ShrinkToChip(p: { profile: HubProps['profile']; onDone: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  const { onDone } = p;
  useEffect(() => {
    const run = Animated.timing(progress, { toValue: 1, duration: 520, easing: Easing.in(Easing.cubic), useNativeDriver: true });
    run.start(({ finished }) => finished && onDone());
    return () => run.stop();
  }, [progress, onDone]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.shrink,
        {
          opacity: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.8, 0] }),
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.06] }) }],
        },
      ]}
    >
      {p.profile.avatar ? (
        <Text style={styles.shrinkAvatar}>{p.profile.avatar}</Text>
      ) : (
        <Ionicons name="person-circle-outline" size={96} color={colors.accent} />
      )}
      <Text style={styles.shrinkName}>{p.profile.name}</Text>
    </Animated.View>
  );
}

function Home(
  p: Pick<HubProps, 'current' | 'netBot' | 'onClose' | 'onResume' | 'onRules' | 'onFeedback' | 'profile'> & {
    onView: (v: HubView) => void;
    chipScale: Animated.Value;
  },
) {
  const c = p.current;
  return (
    <>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.stoneIcon}>
            <View style={styles.blackStoneHalf} />
            <View style={styles.whiteStoneHalf} />
          </View>
          <Text style={styles.appTitle}>Shoutan</Text>
        </View>
        <View style={styles.headerActions}>
          <Animated.View style={{ transform: [{ scale: p.chipScale }] }}>
            <Pressable
              testID="hub-profile"
              accessibilityRole="button"
              accessibilityLabel={t('Profile')}
              onPress={() => p.onView('profile')}
              style={({ pressed }) => [styles.profileChip, pressed && styles.pressed]}
            >
              {p.profile.avatar ? (
                <Text style={styles.profileChipAvatar}>{p.profile.avatar}</Text>
              ) : (
                <Ionicons name="person-circle-outline" size={22} color={colors.accent} />
              )}
              <Text style={styles.profileChipText} numberOfLines={1}>
                {p.profile.name}
              </Text>
            </Pressable>
          </Animated.View>
          {p.onClose && <IconButton label={t('Close')} icon="close" testID="hub-close" size={44} onPress={p.onClose} />}
        </View>
      </View>

      {c && (
        <MenuRow
          primary
          icon="play"
          title={t('Continue')}
          detail={gameSummary(c.size, c.opponent, c.moves, c.against)}
          testID="hub-resume"
          onPress={p.onResume}
        />
      )}
      {p.netBot ? (
        <MenuRow
          icon="hardware-chip-outline"
          title={t('Play the bot')}
          detail={t('Practise against the computer')}
          testID="hub-play-bot"
          onPress={() => p.onView('ai')}
        />
      ) : (
        <Text style={styles.hint} testID="hub-no-bot">
          {t('The bot can’t run on this phone.')}
        </Text>
      )}
      <MenuRow
        icon="people-outline"
        title={t('Play on this device')}
        detail={t('Two players, face to face')}
        testID="hub-play-human"
        onPress={() => p.onView('human')}
      />
      <MenuRow
        icon="globe-outline"
        title={t('Play online')}
        detail={t('Play others on their own phones')}
        testID="hub-play-online"
        onPress={() => p.onView('online')}
      />

      {/* Pinned to the bottom of the page when it is short; scrolls with the page when it is long. */}
      <MenuFooter
        onRules={p.onRules}
        onFeedback={p.onFeedback}
        onSettings={() => p.onView('options')}
        testIDs={{ rules: 'hub-rules', feedback: 'hub-feedback', settings: 'hub-options', about: 'hub-about' }}
      />
    </>
  );
}

function OptionsView(p: { settings: ReactNode; onBack: () => void }) {
  return (
    <>
      <View style={styles.setupHeader}>
        <IconButton label={t('Back')} icon="arrow-back" testID="hub-back" size={44} onPress={p.onBack} />
        <Text style={styles.setupTitle}>{t('Settings')}</Text>
      </View>
      <View style={styles.optionsPage}>{p.settings}</View>
      <AboutLine testID="hub-options-about" />
    </>
  );
}
