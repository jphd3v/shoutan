import { useState } from 'react';
import { Level, LEVELS } from '../go/rating';
import { haptic, setVibrationOn, vibrationOn } from './haptics';
import { language as currentLanguage, Language, phoneLanguage, setLanguage } from './i18n';
import {
  forgetChoices,
  loadConfirmMoves,
  loadCoordinates,
  loadCountSteps,
  loadLanguage,
  loadLikelyAreas,
  loadScoreEstimate,
  loadShowGroups,
  loadShowLiberties,
  loadShowRanks,
  loadShowTerritory,
  loadStarPoints,
  loadTeaching,
  saveConfirmMoves,
  saveCoordinates,
  saveCountSteps,
  saveLanguage,
  saveLikelyAreas,
  saveScoreEstimate,
  saveShowGroups,
  saveShowLiberties,
  saveShowRanks,
  saveShowTerritory,
  saveStarPoints,
  saveTeaching,
} from './prefs';
import { play, setSoundOn, soundOn } from './sound';

/** A switch the player can turn on or off. */
export interface Choice {
  value: boolean;
  set: (on: boolean) => void;
}

/** The player's choices as the Guide and Options show them. */
export interface Choices {
  teaching: Choice;
  showLiberties: Choice;
  showGroups: Choice;
  showTerritory: Choice;
  likelyAreas: Choice;
  scoreEstimate: Choice;
  confirmMoves: Choice;
  countSteps: Choice;
  coordinates: Choice;
  starPoints: Choice;
  showRanks: Choice;
  sound: Choice;
  vibration: Choice;
  /** `followPhone` while no language is chosen; setting null follows the phone again. */
  language: { value: Language; followPhone: boolean; set: (l: Language | null) => void };
}

/** A choice remembered on the phone: changing it saves it, and `reload` reads it back after the choices are forgotten. */
export function usePref<T>(load: () => T, save: (v: T) => void) {
  const [value, setValue] = useState(load);
  return {
    value,
    set: (v: T) => {
      save(v);
      setValue(v);
    },
    reload: () => setValue(load()),
  };
}

/** Every choice remembered on the phone that changes how the game looks, sounds or helps. */
export function usePrefs() {
  // Coordinates help on the larger boards and only crowd a 9×9, so each size has its own choice.
  const coordinatesBySize = usePref(loadCoordinates, saveCoordinates);
  const teaching = usePref(loadTeaching, saveTeaching);
  const confirmMoves = usePref(loadConfirmMoves, saveConfirmMoves);
  const countSteps = usePref(loadCountSteps, saveCountSteps);
  const showLiberties = usePref(loadShowLiberties, saveShowLiberties);
  const showGroups = usePref(loadShowGroups, saveShowGroups);
  const starPoints = usePref(loadStarPoints, saveStarPoints);
  const showTerritory = usePref(loadShowTerritory, saveShowTerritory);
  const scoreEstimate = usePref(loadScoreEstimate, saveScoreEstimate);
  const likelyAreas = usePref(loadLikelyAreas, saveLikelyAreas);
  const showRanks = usePref(loadShowRanks, saveShowRanks);
  const [sound, setSound] = useState(soundOn());
  const [vibration, setVibration] = useState(vibrationOn());
  // Null follows the phone's language.
  const [chosenLanguage, setChosenLanguage] = useState<Language | null>(() => {
    const saved = loadLanguage();
    if (saved) setLanguage(saved);
    return saved;
  });

  /** Back to the defaults, keeping the language. */
  const forget = () => {
    forgetChoices();
    for (const p of [
      coordinatesBySize,
      teaching,
      confirmMoves,
      countSteps,
      showLiberties,
      showGroups,
      starPoints,
      showTerritory,
      scoreEstimate,
      likelyAreas,
      showRanks,
    ])
      p.reload();
  };

  /**
   * The choices a player starts with, from the level they gave: the defaults, plus the Guide's helps
   * for players new to Go and Go ranks for experienced ones. The Coach is not among them: it helps so much
   * that it comes on only with the beginner game. Set once, at the end of the welcome; after that the
   * player's own changes are kept, whatever happens to their level or rating.
   */
  const startFor = (level: Level) => {
    forget();
    const at = LEVELS.indexOf(level);
    if (at <= LEVELS.indexOf('casual')) {
      showTerritory.set(true);
      likelyAreas.set(true);
      scoreEstimate.set(true);
    }
    if (at >= LEVELS.indexOf('intermediate')) showRanks.set(true);
  };

  /** The choices shown in the Guide and Options, both in the sheets over a game and in the main menu, for a board of `size`. */
  const choicesFor = (size: number): Choices => ({
    coordinates: {
      value: coordinatesBySize.value[size] ?? size > 9,
      set: (on) => coordinatesBySize.set({ ...coordinatesBySize.value, [size]: on }),
    },
    starPoints,
    showRanks,
    showLiberties,
    showGroups,
    showTerritory,
    scoreEstimate,
    likelyAreas,
    teaching,
    confirmMoves,
    countSteps,
    language: {
      value: currentLanguage(),
      followPhone: !chosenLanguage,
      set: (l) => {
        setLanguage(l ?? phoneLanguage());
        saveLanguage(l);
        setChosenLanguage(l);
      },
    },
    sound: {
      value: sound,
      set: (on) => {
        setSoundOn(on);
        setSound(on);
        if (on) play('stone');
      },
    },
    vibration: {
      value: vibration,
      set: (on) => {
        setVibrationOn(on);
        setVibration(on);
        if (on) void haptic('light');
      },
    },
  });

  return {
    teaching: teaching.value,
    confirmMoves: confirmMoves.value,
    countSteps: countSteps.value,
    showLiberties: showLiberties.value,
    showGroups: showGroups.value,
    starPoints: starPoints.value,
    showTerritory: showTerritory.value,
    scoreEstimate: scoreEstimate.value,
    likelyAreas: likelyAreas.value,
    showRanks: showRanks.value,
    startFor,
    choicesFor,
  };
}
