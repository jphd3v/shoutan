/**
 * The golden records: finished games as each format writes them. The phone's tests and the
 * database tests read the same files, so the phone and the server accept the same records.
 * Never edit a file here once a release wrote that format; add new ones. See README.md.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

type Json = Record<string, unknown>;
const read = (path: string): unknown => JSON.parse(readFileSync(join(__dirname, path), 'utf8'));
const folder = (sub: string): [string, Json][] =>
  readdirSync(join(__dirname, sub))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => [`${sub}/${f}`, read(`${sub}/${f}`) as Json]);

/** Fields a later app added: this app reads past them, and the server refuses fields it has not learned. */
const later = ([file]: [string, Json]) => file === 'v1/with-unknown-fields.json';
/** Records this app reads and replays and the server accepts, by file. */
export const readable = () => folder('v1').filter((f) => !later(f));
/** Format-1 records with fields a later app added: this app reads and replays them, and the server refuses them. */
export const extended = () => folder('v1').filter(later);
/** Records written by a later app: kept, listed and not replayed. */
export const newer = () => folder('newer');
/** The phone's list of finished games as stored under `go.finishedGames`. */
export const phoneList = () => read('phone/finished-games.json') as Json[];

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type Change = (r: Json & { core: Json & { setup: Json; result: Json }; meta: Json }) => void;

/** One readable record broken in each way the phone and the server must both refuse. */
export function broken(): [string, Json][] {
  const base = read('v1/bot-9-scored.json') as Json;
  const resigned = read('v1/bot-13-handicap-3-resign.json') as Json;
  const handicap = read('v1/bot-9-handicap-2-scored.json') as Json;
  const online = read('v1/online-19-scored.json') as Json;
  const faceToFace = read('v1/face-to-face-9-resumed.json') as Json;
  const laterRules = read('newer/rules-5.json') as Json;
  const cases: [string, Json, Change][] = [
    ['no format', base, (r) => delete r.format],
    ['format 0', base, (r) => (r.format = 0)],
    ['an id that is not a UUID', base, (r) => (r.id = 'game-1')],
    ['an id in capitals', base, (r) => (r.id = (r.id as string).toUpperCase())],
    ['an end time that is not a time', base, (r) => (r.endedAt = 'yesterday')],
    ['an end before the start', base, (r) => (r.endedAt = '2026-10-17T00:00:00.000Z')],
    ['a time without a zone', base, (r) => (r.startedAt = '2026-10-22T09:00:00.000')],
    ['a time in another zone', base, (r) => (r.startedAt = '2026-10-22T10:00:00.000+01:00')],
    ['a time written as +00:00', base, (r) => (r.startedAt = '2026-10-22T09:00:00.000+00:00')],
    ['a time without milliseconds', base, (r) => (r.startedAt = '2026-10-22T09:00:00Z')],
    ['a time in microseconds', base, (r) => (r.startedAt = '2026-10-22T09:00:00.000001Z')],
    ['a day the calendar does not have', base, (r) => (r.startedAt = '2026-02-30T09:00:00.000Z')],
    ['a zone no place has', base, (r) => (r.startedAt = '2026-10-22T09:00:00.000+15:00')],
    [
      'an end a millisecond before the start',
      base,
      (r) => ((r.startedAt = '2026-10-22T09:00:00.002Z'), (r.endedAt = '2026-10-22T09:00:00.001Z')),
    ],
    ['an hour past the end of the day', base, (r) => (r.startedAt = '2026-10-22T24:00:00.000Z')],
    ['no core', base, (r) => delete (r as Json).core],
    ['rules version 0', base, (r) => (r.core.rules = 0)],
    ['a rules version past any there will be', base, (r) => (r.core.rules = 1001)],
    ['later rules on a board the format has no board for', laterRules, (r) => (r.core.size = 10)],
    ['a board size the app has no board for', base, (r) => (r.core.size = 10)],
    ['a whole-number komi, which allows a draw', base, (r) => (r.core.komi = 7)],
    ['komi as text', base, (r) => (r.core.komi = '7.5')],
    ['komi worth more than the board', base, (r) => (r.core.komi = 81.5)],
    ['a setup stone off the board', base, (r) => (r.core.setup.black = [81])],
    ['a point with stones of both colours', base, (r) => ((r.core.setup.black = [40]), (r.core.setup.white = [40]))],
    ['setup stones out of order', handicap, (r) => (r.core.setup.black = [56, 24])],
    ['a handicap stone named twice', handicap, (r) => (r.core.setup.black = [24, 24])],
    ['a White stone in the setup', base, (r) => (r.core.setup.white = [40])],
    ['handicap stones with Black moving first', handicap, (r) => (r.core.first = 'black')],
    ['an even game with White moving first', base, (r) => (r.core.first = 'white')],
    ['a handicap with no stones', base, (r) => (r.meta.handicap = 2)],
    ['more stones than the handicap', handicap, (r) => (r.meta.handicap = 1)],
    ['handicap stones off their points', handicap, (r) => (r.core.setup.black = [20, 60])],
    [
      'more handicap stones than the board takes',
      handicap,
      (r) => ((r.core.setup.black = [20, 24, 38, 42, 56, 60]), (r.meta.handicap = 6)),
    ],
    ['no first player', base, (r) => delete r.core.first],
    ['a move off the board', base, (r) => (r.core.moves = [81])],
    ['a move that is not a whole number', base, (r) => (r.core.moves = [1.5])],
    ['a dead stone named twice', base, (r) => (r.core.dead = [8, 8])],
    ['dead stones out of order', base, (r) => (r.core.dead = [16, 8])],
    ['a score without a margin', base, (r) => (r.core.result.margin = null)],
    ['a margin of nothing', base, (r) => (r.core.result.margin = 0)],
    ['a whole-number margin, which komi rules out', base, (r) => (r.core.result.margin = 28)],
    ['a margin larger than the board and komi', base, (r) => (r.core.result.margin = 89.5)],
    ['a resignation with a margin', resigned, (r) => (r.core.result.margin = 3.5)],
    ['a resignation with dead stones', resigned, (r) => (r.core.dead = [3])],
    ['an unknown result', base, (r) => (r.core.result.reason = 'time')],
    ['no winner', base, (r) => (r.core.result.winner = null)],
    ['no meta', base, (r) => delete (r as Json).meta],
    ['an unknown mode', base, (r) => (r.meta.mode = 'tournament')],
    ['an online game without its server game', online, (r) => delete r.meta.onlineGame],
    ['an online game without its player', online, (r) => delete r.meta.player],
    ['an online game without its opponent', online, (r) => delete r.meta.opponent],
    ['an online game against yourself', online, (r) => (r.meta.opponent = r.meta.player)],
    ['a player named by something other than their id', base, (r) => (r.meta.player = 'John Doe')],
    ['a player id in capitals', base, (r) => (r.meta.player = (r.meta.player as string).toUpperCase())],
    ['a bot game naming a server game', base, (r) => (r.meta.onlineGame = (online.meta as Json).onlineGame)],
    ['a server game id in capitals', online, (r) => (r.meta.onlineGame = (r.meta.onlineGame as string).toUpperCase())],
    ['an opponent named by something other than their id', online, (r) => (r.meta.opponent = 'John Doe')],
    ['a bot game naming an opponent', base, (r) => (r.meta.opponent = (online.meta as Json).opponent)],
    ['face to face with an owner colour', base, (r) => (r.meta.mode = 'face_to_face')],
    ['a bot game without the owner colour', base, (r) => (r.meta.you = null)],
    ['ten handicap stones', base, (r) => (r.meta.handicap = 10)],
    ['half a rating', base, (r) => (r.meta.rating = { before: 1 })],
    ['a rating beyond any scale', base, (r) => (r.meta.rating = { before: 150, after: 1e6, opponent: 750 })],
    ['a rating with a fraction', base, (r) => (r.meta.rating = { before: 150, after: 212.4, opponent: 750 })],
    ['coached written as anything but true', base, (r) => (delete r.meta.rating, (r.meta.coached = false))],
    ['a coached game that moved the rating', base, (r) => (r.meta.coached = true)],
    ['took back written as anything but true', base, (r) => (delete r.meta.rating, (r.meta.tookBack = false))],
    ['a game with moves taken back that moved the rating', base, (r) => (r.meta.tookBack = true)],
    ['moves taken back face to face', faceToFace, (r) => (r.meta.tookBack = true)],
  ];
  return cases.map(([name, record, change]) => {
    const r = clone(record) as Parameters<Change>[0];
    change(r);
    return [name, r];
  });
}
