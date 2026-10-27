import { FinishedGame, finishedGame, isNewer } from '../../go/finished';
import { RULES_VERSION } from '../../go/rules';
import { DEFAULT_SETTINGS, reduce, startSession } from '../../go/session';
import { extended, newer, phoneList, readable } from '../../go/__tests__/records';
import { addFinished, loadFinished, saveFinished } from '../prefs';

beforeEach(() => localStorage.clear());

const resigned = (id: string, endedAt: string) => {
  const s = reduce(startSession({ ...DEFAULT_SETTINGS, opponent: 'human' }), { type: 'resign' });
  const game = finishedGame(s.game, { id, mode: 'face_to_face', rules: RULES_VERSION, startedAt: null, endedAt, you: null });
  if (!game) throw new Error('not finished');
  return { game, uploaded: false };
};
const stored = () => JSON.parse(localStorage.getItem('go.finishedGames') ?? '[]') as { game: Record<string, unknown> }[];

describe('finished games on the phone', () => {
  it('reads the stored list as a released app wrote it, and writes it back unchanged', () => {
    localStorage.setItem('go.finishedGames', JSON.stringify(phoneList()));
    const kept = loadFinished();
    expect(kept.map((k) => [isNewer(k.game), k.uploaded, k.refused ?? false])).toEqual([
      [false, false, false],
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ]);
    saveFinished(kept);
    expect(stored()).toEqual(phoneList());
  });

  it('drops records from before the format was fixed', () => {
    const [, record] = readable()[0];
    const legacy: Record<string, unknown> = { ...record };
    delete legacy.format;
    localStorage.setItem(
      'go.finishedGames',
      JSON.stringify([
        { game: legacy, uploaded: true },
        { game: record, uploaded: false },
      ]),
    );
    expect(loadFinished().map((k) => k.game.id)).toEqual([record.id]);
  });

  it('a recount replaces the record and keeps what a newer app added to it; the same result changes nothing', () => {
    const [, record] = extended()[0];
    localStorage.setItem('go.finishedGames', JSON.stringify([{ game: record, uploaded: true }]));
    const f = loadFinished()[0].game as FinishedGame;
    expect(addFinished({ ...f, meta: { ...f.meta, rating: undefined } })[0].uploaded).toBe(true);

    const recount: FinishedGame = {
      ...f,
      core: { ...f.core, result: { ...f.core.result, margin: 30.5 } },
      meta: { mode: 'bot', you: 'black', handicap: 0 },
    };
    const after = addFinished(JSON.parse(JSON.stringify(recount)));
    expect(after).toHaveLength(1);
    expect(after[0].uploaded).toBe(false);
    expect(stored()[0].game).toMatchObject({
      device: { model: 'Pixel 9' },
      core: { clock: { black: 312, white: 287 }, result: { margin: 30.5 } },
    });
  });

  it('never rewrites a record a newer app saved', () => {
    const [, record] = newer()[0];
    localStorage.setItem('go.finishedGames', JSON.stringify([{ game: record, uploaded: false }]));
    const mine = resigned(record.id as string, '2026-10-30T00:00:00Z').game;
    expect(addFinished(mine)).toHaveLength(1);
    expect(stored()).toEqual([{ game: record, uploaded: false }]);
  });
});
