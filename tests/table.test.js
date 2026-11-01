import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules } from '../js/engine/rules.js';
import { PlayerSession } from '../js/engine/session.js';

const rules = normalizeRules({});
const fresh = (bank = 1000) => new PlayerSession(rules, bank);
const roll = (s, a, b) => s.roll(a, b);
const outcome = (res, key) => res.events.find((e) => e.key === key)?.outcome;

test('pass line: naturals win, craps lose, point numbers set the point', () => {
  let s = fresh(); s.place('pass', undefined, 10);
  assert.equal(outcome(roll(s, 3, 4), 'pass'), 'win'); assert.equal(s.bankroll, 1010);
  s = fresh(); s.place('pass', undefined, 10);
  assert.equal(outcome(roll(s, 1, 1), 'pass'), 'lose'); assert.equal(s.bankroll, 990);
  s = fresh(); s.place('pass', undefined, 10);
  const r = roll(s, 2, 2);
  assert.ok(r.pointEstablished); assert.equal(s.table.point, 4);
  assert.equal(s.table.bets[0].point, 4);
});

test('pass line with odds: point made pays flat 1:1 and odds 2:1 on the 4', () => {
  const s = fresh(); const { bet } = s.place('pass', undefined, 10);
  roll(s, 2, 2);
  assert.ok(s.addOdds(bet, 30).ok);
  assert.equal(s.addOdds(bet, 1).ok, false, 'cannot exceed 3x on the 4');
  roll(s, 1, 3);
  assert.equal(s.bankroll, 1000 + 10 + 60);
  assert.equal(s.table.point, null);
});

test('seven-out loses pass line and odds', () => {
  const s = fresh(); const { bet } = s.place('pass', undefined, 10);
  roll(s, 3, 3); s.addOdds(bet, 50);
  const r = roll(s, 3, 4);
  assert.ok(r.sevenOut);
  assert.equal(s.bankroll, 940);
});

test("don't pass: 2/3 win, 12 is barred (push), 7/11 lose", () => {
  let s = fresh(); s.place('dontPass', undefined, 10);
  assert.equal(outcome(roll(s, 1, 2), 'dontPass'), 'win');
  s = fresh(); s.place('dontPass', undefined, 10);
  assert.equal(outcome(roll(s, 6, 6), 'dontPass'), 'push'); assert.equal(s.bankroll, 1000);
  s = fresh(); s.place('dontPass', undefined, 10);
  assert.equal(outcome(roll(s, 5, 6), 'dontPass'), 'lose');
});

test('come bet travels to a number; its odds are off (returned) on a come-out 7', () => {
  const s = fresh(); s.place('pass', undefined, 10);
  roll(s, 2, 2); // point 4
  assert.equal(s.place('come', undefined, 10).ok, true);
  roll(s, 3, 3); // come → 6
  const come = s.table.bets.find((b) => b.type === 'come');
  assert.equal(come.point, 6);
  s.addOdds(come, 20);
  roll(s, 1, 3); // point 4 made → next roll is come-out
  const r = roll(s, 3, 4); // come-out seven: come flat loses, odds returned
  assert.equal(outcome(r, 'come'), 'lose');
  assert.equal(outcome(r, 'comeOdds'), 'return');
});

test('come bets are only allowed after a point; pass only on the come-out', () => {
  const s = fresh();
  assert.equal(s.place('come', undefined, 10).ok, false);
  s.place('pass', undefined, 10); roll(s, 4, 4);
  assert.equal(s.place('dontPass', undefined, 10).ok, false);
});

test('place bets are off on the come-out and stay up after winning', () => {
  const s = fresh(); s.place('place', 6, 12);
  const r1 = roll(s, 3, 3); // come-out 6: off, becomes point
  assert.equal(r1.events.length, 0);
  roll(s, 2, 4); // point is 6 → place 6 wins $14, stays up (point also made)
  assert.equal(s.bankroll, 1000 - 12 + 14);
  assert.equal(s.table.find('place', 6).amount, 12);
});

test('hardways lose to the easy way and to 7', () => {
  const s = fresh(); s.place('pass', undefined, 10); roll(s, 2, 3); // point 5
  s.place('hard', 8, 5);
  assert.equal(outcome(roll(s, 2, 6), 'hard8'), 'lose');
  s.place('hard', 8, 5);
  assert.equal(outcome(roll(s, 4, 4), 'hard8'), 'win');
  assert.equal(s.table.find('hard', 8).amount, 5);
});

test('field pays double on 2 and loses on 5-8', () => {
  const s = fresh(); s.place('field', undefined, 10);
  roll(s, 1, 1); assert.equal(s.bankroll, 1020);
  s.place('field', undefined, 10); roll(s, 2, 3); assert.equal(s.bankroll, 1010);
});

test('minimums: place 6/8 minimum is $12 at a $10 table, props $1', () => {
  const s = fresh();
  assert.equal(s.place('place', 6, 10).ok, false);
  assert.equal(s.place('place', 6, 12).ok, true);
  assert.equal(s.place('yo', undefined, 1).ok, true);
  assert.equal(s.place('field', undefined, 5).ok, false);
});

test('contract bets cannot be taken down; removable bets return their stake', () => {
  const s = fresh(); const { bet } = s.place('pass', undefined, 10); roll(s, 4, 4);
  assert.equal(s.takeDown(bet), 0);
  const { bet: p } = s.place('place', 5, 10);
  assert.equal(s.takeDown(p), 10);
  assert.equal(s.bankroll, 990);
});

test('cannot bet more than the rack holds', () => {
  const s = fresh(20);
  assert.equal(s.place('pass', undefined, 25).ok, false);
});
