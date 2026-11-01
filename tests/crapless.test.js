import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules, houseEdge, CRAPLESS_LINE_PROBS } from '../js/engine/rules.js';
import { PlayerSession } from '../js/engine/session.js';
import { validateStrategy } from '../js/engine/strategy.js';
import { presetCatalog } from '../js/engine/presets.js';
import { runBatch } from '../js/engine/simulator.js';
import { summarizeStrategy, theoryFor } from '../js/engine/stats.js';
import { generatePermutations, defaultSelections } from '../js/engine/permutations.js';

const standard = normalizeRules({});
const crapless = normalizeRules({ game: 'crapless' });
const exactCrapless = normalizeRules({ game: 'crapless', rounding: 'exact' });
const close = (a, b, tol = 2e-6) => assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

// ---- Horn & C&E: how 2, 3, 11, 12 are bet in standard craps
test('Horn: $4 pays $27 on a 2 or 12, $12 on a 3 or 11; 12.5% edge', () => {
  for (const [d, net] of [[[1, 1], 27], [[6, 6], 27], [[1, 2], 12], [[5, 6], 12], [[3, 4], -4]]) {
    const s = new PlayerSession(standard, 100);
    s.place('horn', undefined, 4);
    s.roll(...d);
    assert.equal(s.bankroll - 100, net, `dice ${d}`);
  }
  close(houseEdge('horn', 0, 4, standard), 0.125);
});

test('C&E: craps nets 3:1, eleven nets 7:1; 11.1% edge', () => {
  const s = new PlayerSession(standard, 100);
  s.place('ce', undefined, 2); s.roll(1, 1); assert.equal(s.bankroll, 106);
  s.place('ce', undefined, 2); s.roll(5, 6); assert.equal(s.bankroll, 106 + 14);
  close(houseEdge('ce', 0, 2, standard), 1 / 9);
});

test('Horn minimum is four units', () => {
  const s = new PlayerSession(standard, 100);
  assert.equal(s.place('horn', undefined, 2).ok, false);
  assert.equal(s.place('horn', undefined, 4).ok, true);
});

// ---- Crapless craps: 2, 3, 11, 12 are box numbers
test('crapless edges: Pass 5.38%, Place 2/12 7.14%, Place 3/11 6.25%, odds 0%', () => {
  close(CRAPLESS_LINE_PROBS.passWin * 2 - 1, -0.053826, 1e-5);
  close(houseEdge('pass', 0, 10, exactCrapless), 0.053826, 1e-5);
  close(houseEdge('place', 2, 2, exactCrapless), 1 / 14);
  close(houseEdge('place', 12, 2, exactCrapless), 1 / 14);
  close(houseEdge('place', 3, 4, exactCrapless), 0.0625);
  close(houseEdge('passOdds', 2, 10, exactCrapless), 0);
  close(houseEdge('passOdds', 11, 10, exactCrapless), 0);
});

test('crapless come-out: 2, 3, 11 and 12 become the point; only 7 wins', () => {
  for (const [d, point] of [[[1, 1], 2], [[1, 2], 3], [[5, 6], 11], [[6, 6], 12]]) {
    const s = new PlayerSession(crapless, 1000);
    s.place('pass', undefined, 10);
    const r = s.roll(...d);
    assert.ok(r.pointEstablished, `come-out ${d}`);
    assert.equal(s.table.point, point);
    assert.equal(s.bankroll, 990, 'pass bet still riding');
  }
  const s = new PlayerSession(crapless, 1000);
  s.place('pass', undefined, 10);
  assert.ok(s.roll(3, 4).natural);
  assert.equal(s.bankroll, 1010);
});

test('crapless: making the 2 pays 6:1 odds', () => {
  const s = new PlayerSession(crapless, 1000);
  const { bet } = s.place('pass', undefined, 10);
  s.roll(1, 1); // point 2
  assert.ok(s.addOdds(bet, 30).ok, '3x odds allowed under 3-4-5x');
  s.roll(1, 1); // point made
  assert.equal(s.bankroll, 1000 + 10 + 180);
});

test('place bets on 2/3/11/12: allowed in crapless, rejected in standard', () => {
  const c = new PlayerSession(crapless, 1000);
  assert.equal(c.place('place', 12, 10).ok, true);
  c.place('pass', undefined, 10); c.roll(2, 2); // point 4
  c.roll(6, 6); // place 12 hits at 11:2
  assert.equal(c.bankroll, 1000 - 10 - 10 + 55);
  const st = new PlayerSession(standard, 1000);
  const r = st.place('place', 12, 10);
  assert.equal(r.ok, false);
  assert.match(r.error, /Crapless/);
});

test("crapless has no Don't Pass / Don't Come", () => {
  const s = new PlayerSession(crapless, 1000);
  assert.equal(s.place('dontPass', undefined, 10).ok, false);
  assert.ok(validateStrategy({ line: { type: 'dontPass', amount: 10 } }, crapless).errors.length > 0);
  assert.ok(validateStrategy({ line: { type: 'none' }, place: { amounts: { 2: 10 } } }, standard).errors.length > 0);
  assert.deepEqual(validateStrategy({ line: { type: 'none' }, place: { amounts: { 2: 10 } } }, crapless).errors, []);
});

test('presets are filtered to what is legal in each game', () => {
  const c = presetCatalog(10, 'crapless');
  const s = presetCatalog(10, 'standard');
  assert.ok(c.some((p) => p.key === 'craplessOutside') && !s.some((p) => p.key === 'craplessOutside'));
  assert.ok(!c.some((p) => p.key === 'dontMax') && s.some((p) => p.key === 'dontMax'));
  for (const p of c) assert.deepEqual(validateStrategy(p.build(), crapless).errors, [], p.name);
});

test('explorer drops combinations that are illegal in the current game', () => {
  const sel = { ...defaultSelections(), place: ['none', 'outside2312'] };
  const std = generatePermutations(sel, 10, 2000, standard);
  const cr = generatePermutations(sel, 10, 2000, crapless);
  assert.ok(std.illegal > 0 && cr.illegal > 0);
  assert.ok(std.strategies.every((s) => !s.place.amounts[2]));
  assert.ok(cr.strategies.every((s) => s.line.type !== 'dontPass'));
});

test('crapless simulation converges to the 5.38% edge and crapless dice theory', () => {
  const r = runBatch({ strategies: [{ line: { type: 'pass', amount: 10 } }], rules: crapless, session: { bankroll: 1000, games: 100, trials: 3000, seed: 9 }, trialStart: 0, trialCount: 3000, collectPaths: false });
  const s = summarizeStrategy(r.strategies[0], { rollsPerHour: 100 });
  close(s.edgeTheory, 0.053826, 1e-4);
  assert.ok(Math.abs(s.mean - s.expectedNet) < 4 * s.se);
  assert.equal(r.dice.craps, 0);
  assert.ok(Math.abs(r.dice.rolls / 300000 - theoryFor(crapless).rollsPerGame) < 0.04);
});
