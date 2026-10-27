import { newGame, resign } from '../../go/rules';
import { setLanguage } from '../../ui/i18n';
import { passedText, passTooText, resignWarningText, resultText } from '../gameText';

beforeEach(() => setLanguage('en'));

describe('game wording', () => {
  it('names each kind of player in a pass', () => {
    expect(passedText('you')).toBe('You passed');
    expect(passedText('bot')).toBe('Bot passed');
    expect(passedText('white')).toBe('White passed');
    expect(passedText({ name: 'John Doe' })).toBe('John Doe passed');
    expect(passTooText({ name: 'John Doe' })).toBe('John Doe passed · pass too to finish');
    expect(passTooText('black')).toBe('Black passed · pass too to finish');
  });

  it('warns the player who would resign, by who loses', () => {
    expect(resignWarningText('bot')).toBe('Resign? The bot will lose this game.');
    expect(resignWarningText('black')).toBe('Resign? Black will lose this game.');
    expect(resignWarningText('you')).toBe('Resign? You will lose this game.');
  });

  it('gives one result for every kind of game: against the bot, face to face and online', () => {
    const blackResigned = resign(newGame(9), 'black');
    expect(resultText(blackResigned, (c) => (c === 'white' ? 'bot' : 'you'))).toEqual({ title: 'Bot wins', subtitle: 'You resigned' });
    expect(resultText(blackResigned, (c) => c)).toEqual({ title: 'White wins!', subtitle: 'Black resigned' });
    expect(resultText(blackResigned, (c) => (c === 'black' ? 'you' : { name: 'John Doe' }))).toEqual({
      title: 'John Doe wins',
      subtitle: 'You resigned',
    });
    expect(resultText(blackResigned, (c) => (c === 'white' ? 'you' : { name: 'John Doe' }))).toEqual({
      title: 'You win!',
      subtitle: 'John Doe resigned',
    });
  });
});
