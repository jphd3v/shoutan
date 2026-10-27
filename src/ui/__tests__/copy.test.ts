import { countLegend, hintText, momentText, points } from '../copy';

describe('copy', () => {
  it('writes half points as ½', () => {
    expect(points(7.5)).toBe('7½');
    expect(points(0.5)).toBe('½');
    expect(points(12)).toBe('12');
  });

  it('names the count marks and the komi', () => {
    expect([countLegend.dead(), countLegend.point('black'), countLegend.point('white'), countLegend.komi(7.5)]).toEqual([
      'Taken off',
      'Black points',
      'White points',
      '+7½ komi',
    ]);
  });

  it('explains a moment in plain words', () => {
    expect(momentText({ kind: 'ko', color: 'black', points: [1], count: 1 })).toContain('Ko!');
  });

  it('numbers the strongest moves and keeps each one’s point with its line, so tapping the line can show it', () => {
    const advice = hintText([12, 30], null);
    expect(advice.ideas).toEqual([
      { text: '1. The strongest move here.', sentence: 'The strongest move here.', point: 12 },
      { text: '2. Nearly as good.', sentence: 'Nearly as good.', point: 30 },
    ]);
    expect(advice.text).toBe(advice.ideas.map((i) => i.text).join('\n'));
    expect(hintText([12], null).ideas).toEqual([{ text: 'The strongest move here.', sentence: 'The strongest move here.', point: 12 }]);
  });

  it('says why in plain words when the rules see a capture, an escape or an atari in a move', () => {
    const reasons = [
      { kind: 'capture', point: 12, count: 1 },
      { kind: 'escape', point: 99, count: 2 },
      { kind: 'atari', point: 30, count: 2 },
    ] as const;
    expect(hintText([12, 30], null, reasons).ideas.map((i) => i.sentence)).toEqual([
      'The strongest move here. You can capture a stone.',
      'Nearly as good. You can leave 2 stones with one liberty.',
    ]);
    expect(hintText([99], null, reasons).ideas[0].sentence).toBe(
      'The strongest move here. Your stones are about to be captured. Save them!',
    );
  });

  it('says passing is fine when the network sees nothing left to play', () => {
    expect(hintText([], null)).toEqual({ text: 'Nothing big is left to play. Passing is fine now.', ideas: [], note: undefined });
  });

  it('names the stronger move by its number when it is still one of the ideas, so one stone lights up one row', () => {
    const cost = { lost: 17, better: 30 };
    expect(hintText([30, 40], cost).note).toEqual({ text: 'Your last move cost about 17 points. Move 1 was stronger, and still is.' });
    expect(hintText([40, 30], cost).note).toEqual({ text: 'Your last move cost about 17 points. Move 2 was stronger, and still is.' });
    expect(hintText([30], cost).note).toEqual({
      text: 'Your last move cost about 17 points. The move shown was stronger, and still is.',
    });
    expect(hintText([40], cost).note).toEqual({
      text: 'Your last move cost about 17 points. Tap to see what was stronger.',
      point: 30,
    });
  });
});
