import { rankName } from '../go/rating';
import type { Player } from '../net/api';
import { levelText } from '../ui/copy';
import { t } from '../ui/i18n';
import { Sheet } from '../ui/Sheet';
import { stonesText } from './onlineMatch';
import { seenText } from './onlineText';
import { Fact, ProfileHeader, StatTiles } from './ProfileCard';

/** The family member across the board in an online game, opened from their picture: who they are and how strong. */
export function MemberSheet(p: {
  visible: boolean;
  onClose: () => void;
  player: Player | undefined;
  online: boolean;
  /** The server's time as this phone knows it, for how long ago they were seen. */
  now: number;
  myRating: number;
}) {
  const player = p.player;
  const rating = player?.rating ?? null;
  return (
    <Sheet visible={p.visible} onClose={p.onClose} testID="member-sheet">
      <ProfileHeader
        avatar={player?.avatar ?? null}
        name={player?.name ?? t('Player')}
        subtitle={p.online || player?.last_seen_at ? seenText(p.online, player?.last_seen_at, p.now) : t('Not online right now')}
        online={p.online}
      />
      {player && (
        <>
          <StatTiles
            tiles={[
              { value: rating === null ? '?' : rankName(rating), label: t('Rank') },
              { value: rating === null ? '?' : String(Math.round(rating)), label: t('Rating') },
              { value: String(player.rated_games), label: t('Rated games') },
            ]}
          />
          <Fact label={t('Level')} value={player.level ? levelText(player.level) : t('Not chosen yet')} />
          <Fact label={t('Handicap on 19×19')} value={rating === null ? t('No rating yet') : stonesText(p.myRating, rating)} />
        </>
      )}
    </Sheet>
  );
}
