// Well-known craps strategies, expressed in table-minimum units so they scale with the table.

import { defaultStrategy, normalizeStrategy, newId } from './strategy.js';

const up = (x, unit) => Math.ceil(x / unit - 1e-9) * unit;

/** Build a strategy from a partial spec. */
function make(name, notes, spec) {
  const d = defaultStrategy();
  const s = {
    ...d, ...spec, name, notes,
    line: { ...d.line, ...(spec.line || {}) },
    come: { ...d.come, ...(spec.come || {}) },
    dontCome: { ...d.dontCome, ...(spec.dontCome || {}) },
    place: { ...d.place, ...(spec.place || {}), amounts: { ...d.place.amounts, ...(spec.place?.amounts || {}) } },
    lay: { ...d.lay, ...(spec.lay || {}), amounts: { ...d.lay.amounts, ...(spec.lay?.amounts || {}) } },
    field: { ...d.field, ...(spec.field || {}) },
    hard: { ...d.hard, ...(spec.hard || {}), amounts: { ...d.hard.amounts, ...(spec.hard?.amounts || {}) } },
    props: { ...d.props, ...(spec.props || {}), amounts: { ...d.props.amounts, ...(spec.props?.amounts || {}) } },
    progression: { ...d.progression, ...(spec.progression || {}) },
  };
  return normalizeStrategy(s);
}

/**
 * @param {number} u table minimum
 * @returns {{key:string, build:()=>object}[]}
 */
export function presetCatalog(u = 10) {
  const six = up(u, 6);          // place 6/8 unit (e.g. $12 at a $10 table)
  const five = up(u, 5);         // place 4/5/9/10 unit
  const small = Math.max(1, Math.round(u / 5));
  const none = { type: 'none' };
  const list = [
    ['pass', 'Pass Line (flat)', 'The baseline: a single Pass Line bet each game. 1.41% house edge.',
      { line: { type: 'pass', amount: u } }],
    ['passMax', 'Pass + 3-4-5x Odds', 'Pass Line plus the maximum free odds. Odds pay true odds (0% edge), diluting the overall edge to ~0.37%.',
      { line: { type: 'pass', amount: u, odds: 'max' } }],
    ['pass2x', 'Pass + 2x Odds', 'A moderate odds bet — lower variance than max odds.',
      { line: { type: 'pass', amount: u, odds: 2 } }],
    ['molly', 'Three-Point Molly', 'Pass Line plus two Come bets, all with max odds — keeps three numbers working.',
      { line: { type: 'pass', amount: u, odds: 'max' }, come: { count: 2, amount: u, odds: 'max' } }],
    ['dontMax', "Don't Pass + Max Lay Odds", 'The "dark side": bet against the shooter with full lay odds. Lowest edge on the layout.',
      { line: { type: 'dontPass', amount: u, odds: 'max' } }],
    ['darkSide', "Don't Pass + 2 Don't Come", "Don't Pass and two Don't Come bets with 1x lay odds — wins when the 7 shows.",
      { line: { type: 'dontPass', amount: u, odds: 1 }, dontCome: { count: 2, amount: u, odds: 1 } }],
    ['place68', 'Place 6 & 8', 'The most popular place bets (1.52% edge). Off on the come-out.',
      { line: none, place: { amounts: { 6: six, 8: six } } }],
    ['inside', 'Inside Numbers (5-6-8-9)', 'Place the four inside numbers; collect every hit.',
      { line: none, place: { amounts: { 5: five, 6: six, 8: six, 9: five } } }],
    ['acrossPress', 'Across + Press', 'Place all six numbers and full-press each hit (up to 4× the base). High variance.',
      { line: none, place: { amounts: { 4: five, 5: five, 6: six, 8: six, 9: five, 10: five }, onHit: 'press', maxPress: 4 } }],
    ['ironCross', 'Iron Cross', 'Field + Place 5, 6, 8: every number except 7 wins something. Feels great; the edge says otherwise.',
      { line: none, place: { amounts: { 5: five, 6: six, 8: six } }, field: { amount: u, when: 'pointOn' } }],
    ['hitRun', 'Hit & Run 6/8', 'Place 6 & 8, take them down after one hit, wait for the next shooter.',
      { line: none, place: { amounts: { 6: six, 8: six }, downAfterHits: 1 } }],
    ['regression', '6/8 Regression', 'Start big on 6 & 8 (3 units), regress to the minimum after the first hit to lock in profit.',
      { line: none, place: { amounts: { 6: six * 3, 8: six * 3 }, onHit: 'regress' } }],
    ['passHard', 'Pass + Hardways', 'Pass Line with a small bet on every hardway while the point is on.',
      { line: { type: 'pass', amount: u, odds: 1 }, hard: { amounts: { 4: small, 6: small, 8: small, 10: small } } }],
    ['buy410', 'Pass + Buy 4 & 10', 'Buy the outside numbers at true odds less 5% commission (charged on wins).',
      { line: { type: 'pass', amount: u, odds: 1 }, place: { amounts: { 4: Math.max(20, 2 * u), 10: Math.max(20, 2 * u) }, buy: [4, 10], skipCovered: true } }],
    ['lay410', 'Lay 4 & 10', 'Lay against the 4 and 10 — win small and often, lose big occasionally.',
      { line: none, lay: { amounts: { 4: Math.max(40, 4 * u), 10: Math.max(40, 4 * u) } } }],
    ['passMartingale', 'Pass Line Martingale', 'Double the Pass bet after every loss (cap 32×). High chance of small wins, real risk of ruin.',
      { line: { type: 'pass', amount: u }, progression: { type: 'martingale', target: 'line', maxMultiplier: 32 } }],
    ['passParoli', 'Pass Line Paroli', 'Double after each win, up to 3 in a row, then reset. Risks winnings, not bankroll.',
      { line: { type: 'pass', amount: u }, progression: { type: 'paroli', target: 'line', paroliSteps: 3, maxMultiplier: 8 } }],
    ['passDalembert', "Pass + 2x Odds D'Alembert", "Raise one unit after a loss, drop one after a win. Gentle progression.",
      { line: { type: 'pass', amount: u, odds: 2 }, progression: { type: 'dalembert', target: 'line', maxMultiplier: 10 } }],
    ['fieldMartingale', 'Field Martingale', 'Bet the Field every roll, doubling after losses (cap 16×).',
      { line: none, field: { amount: u, when: 'always' }, progression: { type: 'martingale', target: 'field', maxMultiplier: 16 } }],
    ['hedge', 'Pass + Any Craps Hedge', 'Protect the Pass bet on the come-out with Any Craps. The hedge costs more than it saves.',
      { line: { type: 'pass', amount: u }, props: { amounts: { anyCraps: small }, when: 'comeOut' } }],
  ];
  return list.map(([key, name, notes, spec]) => ({ key, name, notes, build: () => ({ ...make(name, notes, spec), id: newId(), preset: key }) }));
}

/** The starter set shown on first launch. */
export const STARTER_PRESETS = ['pass', 'passMax', 'dontMax', 'molly', 'place68', 'ironCross', 'passMartingale', 'acrossPress'];
