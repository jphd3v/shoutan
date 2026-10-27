import { markStartPending, takeStartPending } from '../prefs';

beforeEach(() => localStorage.clear());

it('a phone marked when a player signs back in starts its choices once, and an unmarked one never', () => {
  expect(takeStartPending()).toBe(false);
  markStartPending();
  expect(takeStartPending()).toBe(true);
  expect(takeStartPending()).toBe(false);
});
