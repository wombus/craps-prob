import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules } from '../js/engine/rules.js';
import { runBatch } from '../js/engine/simulator.js';
import { summarizeStrategy, quantile, gammaQ, diceChiSquare, paretoFrontier, THEORY } from '../js/engine/stats.js';
import { analyze, pairedDifference } from '../js/engine/analysis.js';
import { mergeBatches } from '../js/sim/runner.js';
import { makeRng } from '../js/engine/rng.js';

const rules = normalizeRules({});
const STRATS = [
  { name: 'Pass', line: { type: 'pass', amount: 10 } },
  { name: 'Place 6/8', line: { type: 'none' }, place: { amounts: { 6: 12, 8: 12 } } },
  { name: 'Martingale', line: { type: 'pass', amount: 10 }, progression: { type: 'martingale' } },
];
const SESSION = { bankroll: 1000, games: 50, trials: 1500, seed: 42 };

test('same seed → identical results; splitting across workers changes nothing', () => {
  const whole = runBatch({ strategies: STRATS, rules, session: SESSION, trialStart: 0, trialCount: 1500 });
  const a = runBatch({ strategies: STRATS, rules, session: SESSION, trialStart: 0, trialCount: 700 });
  const b = runBatch({ strategies: STRATS, rules, session: SESSION, trialStart: 700, trialCount: 800 });
  const merged = mergeBatches([b, a], STRATS.length);
  for (let si = 0; si < STRATS.length; si++) assert.deepEqual(Array.from(merged.strategies[si].net), Array.from(whole.strategies[si].net));
  assert.deepEqual(merged.dice.sums, whole.dice.sums);
});

test('common random numbers: every strategy sees the same dice', () => {
  const r = runBatch({ strategies: [STRATS[0], STRATS[0]], rules, session: SESSION, trialStart: 0, trialCount: 200 });
  assert.deepEqual(Array.from(r.strategies[0].net), Array.from(r.strategies[1].net));
});

test('simulated pass-line edge converges to 1.41% and matches the exact tally', () => {
  const r = runBatch({ strategies: [STRATS[0]], rules, session: { ...SESSION, trials: 6000, games: 100 }, trialStart: 0, trialCount: 6000, collectPaths: false });
  const s = summarizeStrategy(r.strategies[0], { rollsPerHour: 100 });
  assert.ok(Math.abs(s.edgeTheory - 0.014141) < 1e-6, `theory ${s.edgeTheory}`);
  assert.ok(Math.abs(s.mean - s.expectedNet) < 4 * s.se, `mean ${s.mean} vs expected ${s.expectedNet} (se ${s.se})`);
});

test('progressions do not change the edge per dollar', () => {
  const r = runBatch({ strategies: [STRATS[2]], rules, session: { ...SESSION, trials: 3000 }, trialStart: 0, trialCount: 3000, collectPaths: false });
  const s = summarizeStrategy(r.strategies[0], { rollsPerHour: 100 });
  assert.ok(Math.abs(s.edgeTheory - 0.014141) < 1e-6);
});

test('martingale: higher chance of profit, worse tail than flat betting', () => {
  const r = runBatch({ strategies: [STRATS[0], STRATS[2]], rules, session: { ...SESSION, trials: 3000 }, trialStart: 0, trialCount: 3000, collectPaths: false });
  const flat = summarizeStrategy(r.strategies[0], { rollsPerHour: 100 });
  const mart = summarizeStrategy(r.strategies[1], { rollsPerHour: 100 });
  assert.ok(mart.pProfit > flat.pProfit);
  assert.ok(mart.cvar5 < flat.cvar5);
});

test('dice statistics match theory', () => {
  const r = runBatch({ strategies: [STRATS[0]], rules, session: { ...SESSION, trials: 3000, games: 100 }, trialStart: 0, trialCount: 3000, collectPaths: false });
  const d = r.dice;
  assert.ok(Math.abs(d.rolls / (3000 * 100) - THEORY.rollsPerGame) < 0.03);
  assert.ok(diceChiSquare(d.sums).p > 0.001);
  assert.ok(Math.abs(THEORY.rollsPerHand - 8.5255) < 1e-3);
});

test('stop-loss and win goal end sessions', () => {
  const r = runBatch({ strategies: [STRATS[0]], rules, session: { ...SESSION, stopLoss: 50, winGoal: 50 }, trialStart: 0, trialCount: 500, collectPaths: false });
  const nets = Array.from(r.strategies[0].net);
  assert.ok(nets.every((n) => n >= -50 - 20 && n <= 50 + 20)); // last decision can overshoot by one bet
});

test('analysis produces summaries, scores, frontier and insights', () => {
  const merged = mergeBatches([runBatch({ strategies: STRATS, rules, session: SESSION, trialStart: 0, trialCount: 1500 })], STRATS.length);
  const A = analyze(merged, STRATS.map((s, i) => ({ ...s, id: `s${i}` })), { ...SESSION, rollsPerHour: 100 }, rules);
  assert.equal(A.summaries.length, 3);
  assert.ok(A.summaries.every((s) => s.score >= 0 && s.score <= 100));
  assert.ok(A.summaries.some((s) => s.onFrontier));
  assert.ok(A.insights.length >= 3);
  assert.equal(A.bands[0].length, merged.checkpointGames.length);
});

test('stats helpers', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.ok(Math.abs(gammaQ(5, 18.307 / 2) - 0.05) < 1e-3); // χ²(10) critical value at p = .05
  const front = paretoFrontier([{ r: 1, k: 1 }, { r: 2, k: 2 }, { r: 0, k: 3 }], (x) => x.r, (x) => x.k);
  assert.deepEqual(front, [0, 1]);
  const pd = pairedDifference(new Float64Array([2, 3, 4]), new Float64Array([1, 2, 3]));
  assert.equal(pd.mean, 1);
});

test('RNG dice are uniform', () => {
  const rng = makeRng(7);
  const c = new Array(7).fill(0);
  for (let i = 0; i < 600000; i++) c[rng.die()]++;
  for (let f = 1; f <= 6; f++) assert.ok(Math.abs(c[f] / 600000 - 1 / 6) < 0.003);
});
