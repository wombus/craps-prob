// Permutation explorer: build every combination of a few strategy "dimensions" and let
// the simulator rank them. This is a brute-force search over the strategy space.

import { defaultStrategy, normalizeStrategy, describeStrategy, strategyBets, newId } from './strategy.js';

const up = (x, unit) => Math.ceil(x / unit - 1e-9) * unit;

export const DIMENSIONS = [
  { key: 'line', label: 'Line bet', options: [
    { id: 'none', label: 'None' }, { id: 'pass', label: 'Pass Line' }, { id: 'dontPass', label: "Don't Pass" }],
    defaults: ['none', 'pass', 'dontPass'] },
  { key: 'odds', label: 'Odds behind line / come bets', options: [
    { id: 0, label: 'No odds' }, { id: 1, label: '1x' }, { id: 2, label: '2x' }, { id: 'max', label: 'Max (table limit)' }],
    defaults: [0, 'max'] },
  { key: 'come', label: 'Come / Don\'t Come bets (same side as line)', options: [
    { id: 0, label: 'None' }, { id: 1, label: '1' }, { id: 2, label: '2' }, { id: 3, label: '3' }],
    defaults: [0, 2] },
  { key: 'place', label: 'Box-number bets', options: [
    { id: 'none', label: 'None' }, { id: '68', label: 'Place 6 & 8' }, { id: 'inside', label: 'Inside (5-6-8-9)' },
    { id: 'across', label: 'Across (all six)' }, { id: 'buy410', label: 'Buy 4 & 10' }, { id: 'lay410', label: 'Lay 4 & 10' }],
    defaults: ['none', '68', 'inside', 'across'] },
  { key: 'manage', label: 'Place-bet management', options: [
    { id: 'collect', label: 'Collect' }, { id: 'press', label: 'Full press' }, { id: 'regress', label: 'Regress' }, { id: 'hitRun', label: 'Down after 2 hits' }],
    defaults: ['collect', 'press'] },
  { key: 'field', label: 'Field', options: [{ id: 'none', label: 'None' }, { id: 'pointOn', label: 'While point is on' }, { id: 'always', label: 'Every roll' }],
    defaults: ['none'] },
  { key: 'hard', label: 'Hardways', options: [{ id: 'none', label: 'None' }, { id: '68', label: 'Hard 6 & 8' }, { id: 'all', label: 'All four' }],
    defaults: ['none'] },
  { key: 'progression', label: 'Progression on the line bet', options: [
    { id: 'flat', label: 'Flat' }, { id: 'martingale', label: 'Martingale' }, { id: 'paroli', label: 'Paroli' },
    { id: 'dalembert', label: "D'Alembert" }, { id: 'oscar', label: "Oscar's Grind" }],
    defaults: ['flat'] },
];

export function defaultSelections() {
  return Object.fromEntries(DIMENSIONS.map((d) => [d.key, [...d.defaults]]));
}

function build(choice, u) {
  const s = defaultStrategy();
  const six = up(u, 6), five = up(u, 5), small = Math.max(1, Math.round(u / 5));
  s.line = { type: choice.line, amount: u, odds: choice.line === 'none' ? 0 : choice.odds };
  if (choice.line === 'pass' && choice.come) s.come = { count: choice.come, amount: u, odds: choice.odds };
  if (choice.line === 'dontPass' && choice.come) s.dontCome = { count: choice.come, amount: u, odds: choice.odds };
  const pa = s.place.amounts;
  switch (choice.place) {
    case '68': pa[6] = six; pa[8] = six; break;
    case 'inside': pa[5] = five; pa[6] = six; pa[8] = six; pa[9] = five; break;
    case 'across': pa[4] = five; pa[5] = five; pa[6] = six; pa[8] = six; pa[9] = five; pa[10] = five; break;
    case 'buy410': pa[4] = Math.max(20, up(2 * u, 5)); pa[10] = pa[4]; s.place.buy = [4, 10]; break;
    case 'lay410': s.lay.amounts[4] = Math.max(40, 4 * u); s.lay.amounts[10] = s.lay.amounts[4]; break;
  }
  const hasPlace = ['68', 'inside', 'across', 'buy410'].includes(choice.place);
  if (hasPlace) {
    if (choice.manage === 'press') { s.place.onHit = 'press'; s.place.maxPress = 4; }
    else if (choice.manage === 'regress') {
      s.place.onHit = 'regress';
      for (const n of [4, 5, 6, 8, 9, 10]) pa[n] *= 2; // start at 2 units, regress after first hit
    } else if (choice.manage === 'hitRun') s.place.downAfterHits = 2;
    if (choice.line === 'pass') s.place.skipCovered = true;
  }
  if (choice.field !== 'none') s.field = { amount: u, when: choice.field };
  if (choice.hard === '68') { s.hard.amounts[6] = small; s.hard.amounts[8] = small; }
  if (choice.hard === 'all') for (const n of [4, 6, 8, 10]) s.hard.amounts[n] = small;
  if (choice.line !== 'none') s.progression = { type: choice.progression, target: 'line', maxMultiplier: 32, paroliSteps: 3 };
  return normalizeStrategy(s);
}

/** Strategy fingerprint ignoring name/id, used to drop duplicate permutations. */
export function signature(s) {
  const { id, name, notes, preset, color, ...rest } = s;
  return JSON.stringify(rest);
}

/**
 * Generate unique strategies from the selected options of each dimension.
 * @returns {{strategies:object[], total:number, duplicates:number}}
 */
export function generatePermutations(selections, tableMin, limit = 2000) {
  const dims = DIMENSIONS.map((d) => ({ key: d.key, values: (selections[d.key] && selections[d.key].length) ? selections[d.key] : [d.defaults[0]] }));
  const seen = new Set();
  const strategies = [];
  let total = 0, duplicates = 0;
  const choice = {};
  const rec = (i) => {
    if (strategies.length >= limit) return;
    if (i === dims.length) {
      total++;
      const s = build(choice, tableMin);
      if (!strategyBets(s).length) return;
      const sig = signature(s);
      if (seen.has(sig)) { duplicates++; return; }
      seen.add(sig);
      s.id = newId();
      s.choice = { ...choice };
      s.name = describeStrategy(s);
      strategies.push(s);
      return;
    }
    for (const v of dims[i].values) { choice[dims[i].key] = v; rec(i + 1); }
  };
  rec(0);
  return { strategies, total, duplicates, capped: strategies.length >= limit };
}

export function countRaw(selections) {
  return DIMENSIONS.reduce((a, d) => a * Math.max(1, (selections[d.key] || []).length), 1);
}
