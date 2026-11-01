import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules } from '../js/engine/rules.js';
import { PlayerSession } from '../js/engine/session.js';
import { StrategyExecutor, validateStrategy, normalizeStrategy, describeStrategy } from '../js/engine/strategy.js';
import { Progression } from '../js/engine/progressions.js';
import { presetCatalog } from '../js/engine/presets.js';
import { generatePermutations, defaultSelections } from '../js/engine/permutations.js';

const rules = normalizeRules({});
function step(s, ex, a, b) { const r = s.roll(a, b); ex.afterRoll(s, r); ex.beforeRoll(s); return r; }

test('max odds strategy takes 3x/4x/5x', () => {
  for (const [d, want] of [[[2, 2], 30], [[2, 3], 40], [[3, 3], 50]]) {
    const s = new PlayerSession(rules, 1000);
    const ex = new StrategyExecutor({ line: { type: 'pass', amount: 10, odds: 'max' } }, rules);
    ex.beforeRoll(s); step(s, ex, ...d);
    assert.equal(s.table.find('pass').odds, want);
  }
});

test("don't pass with 2x lay odds lays to win 2× the flat bet", () => {
  const s = new PlayerSession(rules, 1000);
  const ex = new StrategyExecutor({ line: { type: 'dontPass', amount: 10, odds: 2 } }, rules);
  ex.beforeRoll(s); step(s, ex, 2, 2); // point 4: lay $40 to win $20
  assert.equal(s.table.find('dontPass').odds, 40);
});

test('come bets: keeps N working, one in the box at a time', () => {
  const s = new PlayerSession(rules, 1000);
  const ex = new StrategyExecutor({ line: { type: 'pass', amount: 10 }, come: { count: 2, amount: 10, odds: 0 } }, rules);
  ex.beforeRoll(s);
  step(s, ex, 2, 2); // point 4, come placed
  assert.equal(s.table.bets.filter((b) => b.type === 'come').length, 1);
  step(s, ex, 3, 3); // come → 6, new come placed
  step(s, ex, 4, 4); // come → 8; already 2 established → no new one
  const comes = s.table.bets.filter((b) => b.type === 'come');
  assert.deepEqual(comes.map((b) => b.point).sort(), [6, 8]);
});

test('press doubles a place bet after a hit, reset after seven-out', () => {
  const s = new PlayerSession(rules, 1000);
  const ex = new StrategyExecutor({ line: { type: 'none' }, place: { amounts: { 6: 12 }, onHit: 'press', maxPress: 4 } }, rules);
  ex.beforeRoll(s); step(s, ex, 2, 2); // point 4 → place 6 goes up
  assert.equal(s.table.find('place', 6).amount, 12);
  step(s, ex, 2, 4); // 6 hits → press to 24
  assert.equal(s.table.find('place', 6).amount, 24);
  step(s, ex, 3, 4); // seven-out
  step(s, ex, 2, 3); // new point 5 → back to base
  assert.equal(s.table.find('place', 6).amount, 12);
});

test('regression drops to table minimum after the first hit', () => {
  const s = new PlayerSession(rules, 1000);
  const ex = new StrategyExecutor({ line: { type: 'none' }, place: { amounts: { 6: 36, 8: 36 }, onHit: 'regress' } }, rules);
  ex.beforeRoll(s); step(s, ex, 2, 2);
  step(s, ex, 5, 3); // 8 hits → regress both to $12
  assert.equal(s.table.find('place', 6).amount, 12);
  assert.equal(s.table.find('place', 8).amount, 12);
});

test('down after N hits takes place bets down until the next shooter', () => {
  const s = new PlayerSession(rules, 1000);
  const ex = new StrategyExecutor({ line: { type: 'none' }, place: { amounts: { 6: 12, 8: 12 }, downAfterHits: 1 } }, rules);
  ex.beforeRoll(s); step(s, ex, 2, 2); step(s, ex, 2, 4);
  assert.equal(s.table.bets.length, 0);
});

test('skipCovered does not place the point number', () => {
  const s = new PlayerSession(rules, 1000);
  const ex = new StrategyExecutor({ line: { type: 'pass', amount: 10 }, place: { amounts: { 6: 12, 8: 12 }, skipCovered: true } }, rules);
  ex.beforeRoll(s); step(s, ex, 3, 3); // point 6
  assert.equal(s.table.find('place', 6), null);
  assert.ok(s.table.find('place', 8));
});

test('martingale doubles after losses and resets on a win or at the cap', () => {
  const p = new Progression({ type: 'martingale', maxMultiplier: 8 });
  p.record('lose'); assert.equal(p.multiplier(), 2);
  p.record('lose'); assert.equal(p.multiplier(), 4);
  p.record('lose'); assert.equal(p.multiplier(), 8);
  p.record('lose'); assert.equal(p.multiplier(), 1, 'cap forces reset');
  p.record('lose'); p.record('win'); assert.equal(p.multiplier(), 1);
});

test('paroli rides wins up to N then resets', () => {
  const p = new Progression({ type: 'paroli', paroliSteps: 3 });
  p.record('win'); assert.equal(p.multiplier(), 2);
  p.record('win'); assert.equal(p.multiplier(), 4);
  p.record('win'); assert.equal(p.multiplier(), 1);
});

test('validation catches below-minimum bets and warns on odd units', () => {
  const v = validateStrategy({ line: { type: 'pass', amount: 5 }, place: { amounts: { 6: 15 } } }, rules);
  assert.ok(v.errors.some((e) => e.includes('Pass Line')));
  assert.ok(v.warnings.some((w) => w.includes('Place 6')));
  assert.ok(validateStrategy({ line: { type: 'none' } }, rules).errors.length > 0);
});

test('every preset is valid at $5, $10 and $25 tables', () => {
  for (const min of [5, 10, 25]) {
    const r = normalizeRules({ tableMin: min });
    for (const p of presetCatalog(min)) {
      const v = validateStrategy(p.build(), r);
      assert.deepEqual(v.errors, [], `${p.name} @ $${min}`);
    }
  }
});

test('normalizeStrategy tolerates junk input', () => {
  const s = normalizeStrategy({ line: { type: 'bogus', amount: 'abc' }, place: { amounts: { 6: -5 } }, progression: { type: 'nope' } });
  assert.equal(s.line.type, 'none');
  assert.equal(s.place.amounts[6], 0);
  assert.equal(s.progression.type, 'flat');
  assert.equal(typeof describeStrategy(s), 'string');
});

test('permutations are unique and named', () => {
  const { strategies, duplicates } = generatePermutations(defaultSelections(), 10);
  assert.ok(strategies.length > 20);
  assert.ok(duplicates > 0);
  assert.equal(new Set(strategies.map((s) => s.name)).size, strategies.length);
});
