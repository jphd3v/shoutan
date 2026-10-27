import { ReactNode } from 'react';
import { BotNet, Level } from '../../go/rating';
import { Color } from '../../go/rules';
import type { BoardSize, BotLevel, Opponent } from '../../go/session';
import type { LobbyProblem, LobbyState } from '../../net/lobby';
import { KeptGame, Profile } from '../../ui/prefs';
import type { Choices } from '../../ui/usePrefs';
import type { Account } from '../../net/api';

/** `humanColor`, `bot` and `botNet`: the player's colour, and the bot's level and network, against the bot. */
export type GameChanges = { opponent: Opponent; size: BoardSize; handicap: number; humanColor: Color; bot?: BotLevel; botNet?: BotNet };

/** The family lobby as the menu shows it. */
export interface HubOnline {
  state: LobbyState;
  /** Starts keeping the lobby fresh while the online view is on screen; returns the stop. */
  watch: () => () => void;
  /** Joins the family under the profile's name. */
  onRegister: (familyCode: string) => Promise<boolean>;
  onCreate: (setup: { size: BoardSize; color: Color; handicap: number; confirmMoves: boolean; ask?: string }) => void;
  onOpen: (gameId: string) => void;
  onRefresh: () => void;
}

export interface HubProps {
  visible: boolean;
  account: Account | null;
  /** The view shown when the menu opens. */
  initialView?: 'home' | 'online' | 'profile' | Opponent;
  /**
   * The unfinished game Continue returns to, or null when there is none. There is one game at a time: an online
   * one (`opponent` null) waits in Play online when another starts, but a game on this phone is given up.
   */
  current: { size: number; opponent: Opponent | null; moves: number; against?: string } | null;
  /** The settings of the game on this phone, which setup starts from. */
  currentSetup: { opponent: Opponent; size: BoardSize; handicap: number; humanColor: Color; bot?: BotLevel; botNet?: BotNet };
  profile: Profile;
  /** The player's Go rank, shown beside their level when ranks are on. */
  rank: string | null;
  confirmMoves: boolean;
  /** The stones the player's rating calls for against the bot on a board. */
  botHandicap: (size: BoardSize, level: BotLevel, net: BotNet) => number;
  /** The bot level that suits the player on a board. */
  botLevelFor: (size: BoardSize, net: BotNet) => BotLevel;
  /** The bot's rank at a level on a board, as the player's rank is shown. */
  botRank: (size: BoardSize, level: BotLevel, net: BotNet) => string;
  /** Whether this phone can run the human-like network, so the player may choose it; without it the bot plays KataGo. */
  humanBot: boolean;
  /** Whether the Coach is on, which makes a game against the bot unrated. */
  coach: boolean;
  /** Whether this phone can run the bot's network; without it there is no bot. */
  netBot: boolean;
  /** Renames the player; resolves with the problem when the family's server refused the name. */
  onName: (name: string) => Promise<LobbyProblem | null>;
  /**
   * Ends the welcome with the player's name, starting level and avatar. With a family code, joins the
   * family first; resolves with the problem when the family refused, and the welcome stays.
   */
  onWelcome: (name: string, level: Level, avatar: string | null, familyCode?: string) => Promise<LobbyProblem | null>;
  /** Whether this build has a family server to join. */
  canJoin: boolean;
  /** Whether the signed-in account is in the family; if not, why the last try to join failed. */
  family: { member: true } | { member: false; problem: LobbyProblem | null };
  onJoin: (familyCode: string) => Promise<LobbyProblem | null>;
  /** Picks the player's avatar, or clears it with null. */
  onAvatar: (avatar: string | null) => Promise<LobbyProblem | null>;
  /** Starts the player's rating again from a level. */
  onRestartRating: (level: Level) => void;
  /** Finished games on this phone, newest first. */
  kept: readonly KeptGame[];
  nameOf: (playerId: string) => string | undefined;
  /** Shows a finished game on the board, at its result. */
  onOpenGame: (gameId: string) => void;
  /** Continue: back to the unfinished game. */
  onResume: () => void;
  /** Closes the menu, back to the game under it; absent when there is no game to go back to. */
  onClose?: () => void;
  /** Back from a setup or Play online the menu opened straight on (the game's New game): back to the game, with its menu open. */
  onSetupBack?: () => void;
  /** Starts a game; `confirmMoves` sets tap twice to place, and `beginner` switches on the Coach and Territory. */
  onStartGame: (changes: GameChanges, extras: { confirmMoves: boolean; beginner?: boolean }) => void;
  /** Null when this build has no server for online play. */
  online: HubOnline | null;
  onRules: () => void;
  onFeedback: () => void;
  /** The Options choices, shown as a page of the menu. */
  settings: ReactNode;
  /** The app's language, which the welcome lets a new player change before anything else. */
  language: Choices['language'];
}
