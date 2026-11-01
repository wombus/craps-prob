import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules, houseEdge, passWithOddsEdge, ODDS_LIMITS, payoutTerms, maxTakeOdds, maxLayOdds, LINE_PROBS } from '../js/engine/rules.js';

const exact = normalizeRules({ rounding: 'exact' });
const casino = normalizeRules({});
const close = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

test('published house edges (exact payouts)', () => {
  const cases = [
    ['pass', 0, 10, 0.014141], ['dontPass', 0, 10, 0.013636],
    ['place', 6, 6, 0.015152], ['place', 5, 5, 0.04], ['place', 4, 5, 0.066667],
    ['buy', 4, 20, 0.016667], ['lay', 4, 40, 0.016667],
    ['field', 0, 10, 0.055556], ['hard', 6, 1, 0.090909], ['hard', 4, 1, 0.111111],
    ['any7', 0, 1, 0.166667], ['anyCraps', 0, 1, 0.111111], ['yo', 0, 1, 0.111111],
    ['aces', 0, 1, 0.138889], ['big', 8, 10, 0.090909],
    ['passOdds', 4, 10, 0], ['passOdds', 5, 10, 0], ['passOdds', 6, 10, 0],
    ['dontPassOdds', 4, 20, 0], ['dontPassOdds', 6, 12, 0],
  ];
  for (const [t, n, a, e] of cases) close(houseEdge(t, n, a, exact), e, 2e-6);
});

test('field paying 3:1 on 12 halves the edge', () => {
  close(houseEdge('field', 0, 10, normalizeRules({ rounding: 'exact', field12Pays: 3 })), 0.027778, 2e-6);
});

test('pass line win probability is 244/495', () => {
  close(LINE_PROBS.passWin, 244 / 495, 1e-12);
});

test('odds dilute the pass-line edge (3-4-5x → 0.374%)', () => {
  close(passWithOddsEdge(ODDS_LIMITS['345x'].mult), 0.003743, 2e-6);
  close(passWithOddsEdge(ODDS_LIMITS['1x'].mult), 0.008485, 2e-6);
});

test('casino rounding: $10 place 6 pays $11 and raises the edge', () => {
  assert.equal(payoutTerms('place', 6, 10, casino).profit, 11);
  assert.equal(payoutTerms('place', 6, 12, casino).profit, 14);
  assert.ok(houseEdge('place', 6, 10, casino) > 0.04);
});

test('buy/lay commission: 5% rounded down with $1 minimum', () => {
  assert.equal(payoutTerms('buy', 4, 20, casino).feeOnWin, 1);
  assert.equal(payoutTerms('buy', 4, 10, casino).feeOnWin, 1); // $0.50 → $1 minimum
  assert.equal(payoutTerms('buy', 4, 25, casino).feeOnWin, 1); // $1.25 → $1
  const lay = payoutTerms('lay', 4, 40, casino);
  assert.equal(lay.profit, 20);
  assert.equal(lay.feeOnWin, 1);
});

test('3-4-5x odds limits, and lay odds may win up to the same multiple', () => {
  assert.equal(maxTakeOdds(10, 4, casino), 30);
  assert.equal(maxTakeOdds(10, 5, casino), 40);
  assert.equal(maxTakeOdds(10, 6, casino), 50);
  for (const p of [4, 5, 6, 8, 9, 10]) assert.equal(maxLayOdds(10, p, casino), 60); // "6x on the don't"
  // $5 flat, 1x on the 5: casinos allow $6 so the 3:2 payout is whole.
  assert.equal(maxTakeOdds(5, 5, normalizeRules({ oddsLimit: '1x' })), 6);
});
