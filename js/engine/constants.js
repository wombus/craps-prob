// Core facts about two six-sided dice and the craps layout.
// Everything else in the engine is derived from these few tables.

/** Number of ways (out of 36) to roll each sum. Index = sum (0..12). */
export const WAYS = Object.freeze([0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]);

/** Box numbers that can become the point. */
export const POINT_NUMBERS = Object.freeze([4, 5, 6, 8, 9, 10]);

export const HARD_NUMBERS = Object.freeze([4, 6, 8, 10]);

export const isPointNumber = (n) => n === 4 || n === 5 || n === 6 || n === 8 || n === 9 || n === 10;

/** One-roll proposition bets ("to 1" payouts, the casino-standard quote). */
export const PROPS = Object.freeze({
  any7: { label: 'Any 7', wins: [7], pays: 4 },
  anyCraps: { label: 'Any Craps', wins: [2, 3, 12], pays: 7 },
  yo: { label: 'Yo (11)', wins: [11], pays: 15 },
  aceDeuce: { label: 'Ace-Deuce (3)', wins: [3], pays: 15 },
  aces: { label: 'Aces (2)', wins: [2], pays: 30 },
  boxcars: { label: 'Boxcars (12)', wins: [12], pays: 30 },
});
export const PROP_TYPES = Object.freeze(Object.keys(PROPS));

/** Field: winning sums. 2 and 12 pay a bonus configured in the rules. */
export const FIELD_NUMBERS = Object.freeze([2, 3, 4, 9, 10, 11, 12]);

/** Bets that stay on the layout after they win (you are paid, the bet rides). */
export const STANDING_TYPES = new Set(['place', 'buy', 'lay', 'hard', 'big']);

/** Bets the player may legally take down at any time. Pass/Come flats are contract bets. */
export const REMOVABLE_TYPES = new Set([
  'place', 'buy', 'lay', 'hard', 'big', 'field', 'dontPass', 'dontCome', ...PROP_TYPES,
]);

/**
 * Ledger key for a bet (or its odds). Keys are used to break results down by bet type.
 * @param {object} bet
 * @param {boolean} [odds]
 */
export function betKey(bet, odds = false) {
  switch (bet.type) {
    case 'pass': case 'come': case 'dontPass': case 'dontCome':
      return odds ? `${bet.type}Odds` : bet.type;
    case 'place': case 'buy': case 'lay': case 'hard': case 'big':
      return `${bet.type}${bet.number}`;
    default:
      return bet.type;
  }
}

const KEY_LABELS = {
  pass: 'Pass Line', passOdds: 'Pass Odds',
  come: 'Come', comeOdds: 'Come Odds',
  dontPass: "Don't Pass", dontPassOdds: "Don't Pass Lay Odds",
  dontCome: "Don't Come", dontComeOdds: "Don't Come Lay Odds",
  field: 'Field',
};

export function keyLabel(key) {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (PROPS[key]) return PROPS[key].label;
  const m = /^(place|buy|lay|hard|big)(\d+)$/.exec(key);
  if (m) {
    const word = { place: 'Place', buy: 'Buy', lay: 'Lay', hard: 'Hard', big: 'Big' }[m[1]];
    return `${word} ${m[2]}`;
  }
  return key;
}

/** Sum → probability on a single roll. */
export const probSum = (n) => WAYS[n] / 36;
