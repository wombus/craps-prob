// Table rules, payout math and analytic house-edge calculations.
//
// Every payout in the simulator flows through the functions in this file, and the
// analytic expected-value functions use the *same* payout functions. That is what lets
// the app compare "theory" against "simulation" honestly: if a casino rounds a $10
// Place 6 win down from $11.67 to $11, both the simulation and the theory see $11.

import { WAYS, PROPS } from './constants.js';

/** Odds-limit presets. Values are the max multiple of the flat bet, per point. */
export const ODDS_LIMITS = Object.freeze({
  '1x': { label: '1x', mult: { 4: 1, 5: 1, 6: 1, 8: 1, 9: 1, 10: 1 } },
  '2x': { label: '2x', mult: { 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2 } },
  '3x': { label: '3x', mult: { 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3 } },
  '345x': { label: '3-4-5x (Las Vegas standard)', mult: { 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3 } },
  '5x': { label: '5x', mult: { 4: 5, 5: 5, 6: 5, 8: 5, 9: 5, 10: 5 } },
  '10x': { label: '10x', mult: { 4: 10, 5: 10, 6: 10, 8: 10, 9: 10, 10: 10 } },
  '20x': { label: '20x', mult: { 4: 20, 5: 20, 6: 20, 8: 20, 9: 20, 10: 20 } },
  '100x': { label: '100x', mult: { 4: 100, 5: 100, 6: 100, 8: 100, 9: 100, 10: 100 } },
});

export const DEFAULT_RULES = Object.freeze({
  tableMin: 10,
  tableMax: 5000,
  propMin: 1,            // minimum for hardways / one-roll props
  oddsLimit: '345x',
  field2Pays: 2,         // 2 → "2 to 1"
  field12Pays: 2,        // 2 → "2 to 1", 3 → "3 to 1" (better for the player)
  comeOddsWorkingOnComeOut: false, // casino standard: come odds are OFF on the come-out
  placeWorkingOnComeOut: false,    // place / buy / lay bets OFF on the come-out
  hardWorkingOnComeOut: false,     // hardways OFF on the come-out
  vigRate: 0.05,         // 5% commission on buy and lay bets
  vigOn: 'win',          // 'win' = commission only when the bet wins; 'always' = paid on every decision
  rounding: 'dollar',    // 'dollar' | 'half' | 'exact'  (casinos pay down to the smallest chip)
});

export function normalizeRules(r = {}) {
  const out = { ...DEFAULT_RULES, ...r };
  out.tableMin = Math.max(1, +out.tableMin || DEFAULT_RULES.tableMin);
  out.tableMax = Math.max(out.tableMin, +out.tableMax || DEFAULT_RULES.tableMax);
  out.propMin = Math.max(0.01, +out.propMin || 1);
  if (!ODDS_LIMITS[out.oddsLimit]) out.oddsLimit = DEFAULT_RULES.oddsLimit;
  out.field2Pays = [2, 3].includes(+out.field2Pays) ? +out.field2Pays : 2;
  out.field12Pays = [2, 3].includes(+out.field12Pays) ? +out.field12Pays : 2;
  out.vigRate = Math.min(0.2, Math.max(0, +out.vigRate));
  if (!['win', 'always'].includes(out.vigOn)) out.vigOn = 'win';
  if (!['dollar', 'half', 'exact'].includes(out.rounding)) out.rounding = 'dollar';
  for (const k of ['comeOddsWorkingOnComeOut', 'placeWorkingOnComeOut', 'hardWorkingOnComeOut']) out[k] = !!out[k];
  return out;
}

// ---------------------------------------------------------------------------
// Payout ratios ("pays X to 1")
// ---------------------------------------------------------------------------

/** True odds of a point number vs. a 7 (what free odds and buy bets pay). */
export const TRUE_ODDS = Object.freeze({ 4: 2, 5: 3 / 2, 6: 6 / 5, 8: 6 / 5, 9: 3 / 2, 10: 2 });
/** What a lay bet / lay odds pay (the reverse of true odds). */
export const LAY_ODDS = Object.freeze({ 4: 1 / 2, 5: 2 / 3, 6: 5 / 6, 8: 5 / 6, 9: 2 / 3, 10: 1 / 2 });
/** Place bets pay less than true odds — that difference is the house edge. */
export const PLACE_ODDS = Object.freeze({ 4: 9 / 5, 5: 7 / 5, 6: 7 / 6, 8: 7 / 6, 9: 7 / 5, 10: 9 / 5 });
export const HARD_ODDS = Object.freeze({ 4: 7, 6: 9, 8: 9, 10: 7 });

/** Bet sizes that pay out evenly (no rounding loss). */
export const UNITS = Object.freeze({
  place: { 4: 5, 5: 5, 6: 6, 8: 6, 9: 5, 10: 5 },
  odds: { 4: 1, 5: 2, 6: 5, 8: 5, 9: 2, 10: 1 },
  buy: { 4: 1, 5: 2, 6: 5, 8: 5, 9: 2, 10: 1 },
  lay: { 4: 2, 5: 3, 6: 6, 8: 6, 9: 3, 10: 2 },
});

const EPS = 1e-9;

/** Casinos pay down to the smallest chip they use. */
export function roundPayout(x, rules) {
  if (rules.rounding === 'exact') return x;
  const unit = rules.rounding === 'half' ? 0.5 : 1;
  return Math.floor(x / unit + EPS) * unit;
}

/** Commission on buy/lay bets: 5% of the base, rounded down, $1 minimum (unless exact). */
export function vigFor(base, rules) {
  const v = base * rules.vigRate;
  if (rules.vigRate === 0) return 0;
  if (rules.rounding === 'exact') return v;
  return Math.max(1, Math.floor(v + EPS));
}

export const maxOddsMultiple = (rules, point) => ODDS_LIMITS[rules.oddsLimit].mult[point];

/** Max free odds behind a Pass/Come bet (rounded up to a payable unit, as casinos allow). */
export function maxTakeOdds(flat, point, rules) {
  const raw = flat * maxOddsMultiple(rules, point);
  if (rules.rounding === 'exact') return raw;
  const u = UNITS.odds[point];
  return Math.ceil(raw / u - EPS) * u;
}

/** Max lay odds behind a Don't bet: you may lay enough to WIN the take-odds limit. */
export function maxLayOdds(flat, point, rules) {
  const raw = (flat * maxOddsMultiple(rules, point)) / LAY_ODDS[point];
  if (rules.rounding === 'exact') return raw;
  const u = UNITS.lay[point];
  return Math.ceil(raw / u - EPS) * u;
}

/**
 * Win/lose economics of a single bet decision.
 * @returns {{profit:number, feeOnWin:number, feeOnLoss:number}}
 *   profit   – amount paid on a win (before commission)
 *   feeOnWin – commission subtracted from a win
 *   feeOnLoss – extra commission lost on a loss (only when vig is charged every decision)
 */
export function payoutTerms(type, number, amount, rules, sum = 0) {
  switch (type) {
    case 'pass': case 'come': case 'dontPass': case 'dontCome': case 'big':
      return { profit: amount, feeOnWin: 0, feeOnLoss: 0 };
    case 'passOdds': case 'comeOdds':
      return { profit: roundPayout(amount * TRUE_ODDS[number], rules), feeOnWin: 0, feeOnLoss: 0 };
    case 'dontPassOdds': case 'dontComeOdds':
      return { profit: roundPayout(amount * LAY_ODDS[number], rules), feeOnWin: 0, feeOnLoss: 0 };
    case 'place':
      return { profit: roundPayout(amount * PLACE_ODDS[number], rules), feeOnWin: 0, feeOnLoss: 0 };
    case 'buy': {
      const vig = vigFor(amount, rules);
      return { profit: roundPayout(amount * TRUE_ODDS[number], rules), feeOnWin: vig, feeOnLoss: rules.vigOn === 'always' ? vig : 0 };
    }
    case 'lay': {
      const win = roundPayout(amount * LAY_ODDS[number], rules);
      const vig = vigFor(win, rules);
      return { profit: win, feeOnWin: vig, feeOnLoss: rules.vigOn === 'always' ? vig : 0 };
    }
    case 'hard':
      return { profit: amount * HARD_ODDS[number], feeOnWin: 0, feeOnLoss: 0 };
    case 'field': {
      const mult = sum === 2 ? rules.field2Pays : sum === 12 ? rules.field12Pays : 1;
      return { profit: amount * mult, feeOnWin: 0, feeOnLoss: 0 };
    }
    default:
      if (PROPS[type]) return { profit: amount * PROPS[type].pays, feeOnWin: 0, feeOnLoss: 0 };
      throw new Error(`Unknown bet type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Analytic probabilities & expected values
// ---------------------------------------------------------------------------

/** P(number rolls before a 7) */
export const pBefore7 = (n) => WAYS[n] / (WAYS[n] + 6);
/** P(7 rolls before number) */
export const p7Before = (n) => 6 / (WAYS[n] + 6);

const POINTS = [4, 5, 6, 8, 9, 10];

/** Pass line: P(win) = 244/495. Don't pass: wins on 2/3, pushes 12, otherwise mirror. */
export const LINE_PROBS = (() => {
  let passWin = 8 / 36; // 7 or 11 on come-out
  let dontWin = 3 / 36; // 2 or 3
  for (const p of POINTS) {
    passWin += (WAYS[p] / 36) * pBefore7(p);
    dontWin += (WAYS[p] / 36) * p7Before(p);
  }
  return Object.freeze({
    passWin, passLose: 1 - passWin,
    dontWin, dontPush: 1 / 36, dontLose: 1 - dontWin - 1 / 36,
  });
})();

/**
 * Expected profit (in $) of one decision of a bet with the given amount.
 * "Decision" = the bet is resolved (won, lost, or — for Don't bets — barred/pushed).
 * Negative values are the house's expected take.
 */
export function expectedValue(type, number, amount, rules) {
  const t = payoutTerms(type, number, amount, rules);
  const winNet = t.profit - t.feeOnWin;
  const loseNet = -(amount + t.feeOnLoss);
  switch (type) {
    case 'pass': case 'come':
      return LINE_PROBS.passWin * winNet + LINE_PROBS.passLose * loseNet;
    case 'dontPass': case 'dontCome':
      return LINE_PROBS.dontWin * winNet + LINE_PROBS.dontLose * loseNet;
    case 'passOdds': case 'comeOdds': case 'place': case 'buy': case 'big': {
      const n = number;
      const p = pBefore7(n);
      return p * winNet + (1 - p) * loseNet;
    }
    case 'dontPassOdds': case 'dontComeOdds': case 'lay': {
      const p = p7Before(number);
      return p * winNet + (1 - p) * loseNet;
    }
    case 'hard': {
      const p = 1 / (WAYS[number] + 6); // only the one hard combo wins; easy ways + 7s lose
      return p * winNet + (1 - p) * loseNet;
    }
    case 'field': {
      let ev = 0;
      for (let s = 2; s <= 12; s++) {
        const pr = WAYS[s] / 36;
        if ([2, 3, 4, 9, 10, 11, 12].includes(s)) ev += pr * payoutTerms('field', 0, amount, rules, s).profit;
        else ev -= pr * amount;
      }
      return ev;
    }
    default: {
      const prop = PROPS[type];
      if (!prop) throw new Error(`Unknown bet type: ${type}`);
      const p = prop.wins.reduce((a, s) => a + WAYS[s], 0) / 36;
      return p * winNet + (1 - p) * loseNet;
    }
  }
}

/** House edge as a fraction of the amount bet, per decision. */
export const houseEdge = (type, number, amount, rules) => -expectedValue(type, number, amount, rules) / amount;

/** Probability of winning a single decision (pushes excluded). */
export function winProbability(type, number) {
  switch (type) {
    case 'pass': case 'come': return LINE_PROBS.passWin;
    case 'dontPass': case 'dontCome': return LINE_PROBS.dontWin;
    case 'passOdds': case 'comeOdds': case 'place': case 'buy': case 'big': return pBefore7(number);
    case 'dontPassOdds': case 'dontComeOdds': case 'lay': return p7Before(number);
    case 'hard': return 1 / (WAYS[number] + 6);
    case 'field': return 16 / 36;
    default: return PROPS[type].wins.reduce((a, s) => a + WAYS[s], 0) / 36;
  }
}

/**
 * Combined edge of a Pass Line bet with odds, per total dollar wagered.
 * Free odds have zero edge, so they dilute the 1.41% on the flat bet.
 */
export function passWithOddsEdge(multByPoint) {
  const flatLoss = -(LINE_PROBS.passWin - LINE_PROBS.passLose); // 7/495 per $1 flat
  let avgOddsAction = 0;
  for (const p of POINTS) avgOddsAction += (WAYS[p] / 36) * (multByPoint[p] || 0);
  return flatLoss / (1 + avgOddsAction);
}

const EV_CACHES = new WeakMap();

/** Memoized EV lookup used inside the hot simulation loop (shared per rules object). */
export function makeEvCache(rules) {
  let fn = EV_CACHES.get(rules);
  if (fn) return fn;
  const byType = Object.create(null);
  let size = 0;
  fn = (type, number, amount) => {
    const t = byType[type] || (byType[type] = []);
    const m = t[number] || (t[number] = new Map());
    let v = m.get(amount);
    if (v === undefined) {
      v = expectedValue(type, number, amount, rules);
      if (size++ < 100000) m.set(amount, v);
    }
    return v;
  };
  EV_CACHES.set(rules, fn);
  return fn;
}
