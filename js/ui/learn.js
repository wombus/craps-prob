// "Odds & Learn": the exact probability math behind every bet, computed live from the
// current table rules, plus short explanations of the statistics used in the results.

import { h, clear, pct, money, info } from './dom.js';
import { store } from './state.js';
import { WAYS, POINT_NUMBERS, PROPS } from '../engine/constants.js';
import { houseEdge, winProbability, passWithOddsEdge, ODDS_LIMITS, PLACE_ODDS, TRUE_ODDS, LAY_ODDS, LINE_PROBS, pBefore7 } from '../engine/rules.js';
import { THEORY } from '../engine/stats.js';

const ratio = (x) => {
  const map = { 2: '2:1', 1.5: '3:2', 1.2: '6:5', 0.5: '1:2', [2 / 3]: '2:3', [5 / 6]: '5:6', 1.8: '9:5', 1.4: '7:5', [7 / 6]: '7:6' };
  for (const [k, v] of Object.entries(map)) if (Math.abs(+k - x) < 1e-9) return v;
  return `${x}:1`;
};

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/** "Odds against" as a reduced fraction, e.g. 6 has 5 ways → 31 : 5. */
const oddsAgainst = (ways) => { const g = gcd(36 - ways, ways); return `${(36 - ways) / g} : ${ways / g}`; };

export function mountLearn(root) {
  const body = h('div', { class: 'learn' });
  root.append(body);
  const draw = () => render(body);
  draw();
  store.on('rules', draw);
}

function render(root) {
  clear(root);
  const r = store.rules;

  // ---- 36 combinations
  const grid = h('div', { class: 'combo-grid', attrs: { role: 'grid', 'aria-label': 'All 36 dice combinations' } });
  grid.append(h('span', { class: 'combo-head' }));
  for (let b = 1; b <= 6; b++) grid.append(h('span', { class: 'combo-head', text: String(b) }));
  for (let a = 1; a <= 6; a++) {
    grid.append(h('span', { class: 'combo-head', text: String(a) }));
    for (let b = 1; b <= 6; b++) grid.append(h('span', { class: `combo ${a + b === 7 ? 'seven' : ''}`, dataset: { sum: a + b }, text: String(a + b), title: `${a} + ${b} = ${a + b}` }));
  }
  const highlight = (s) => { for (const c of grid.querySelectorAll('.combo')) c.classList.toggle('hl', +c.dataset.sum === s); };

  const probRows = [];
  for (let s = 2; s <= 12; s++) {
    const p = WAYS[s] / 36;
    const tr = h('tr', { tabIndex: 0 },
      h('td', { class: 'num strong', text: String(s) }),
      h('td', { class: 'num', text: String(WAYS[s]) }),
      h('td', { class: 'num', text: pct(p, 2) }),
      h('td', { class: 'num', text: oddsAgainst(WAYS[s]) }),
      h('td', { class: 'num', text: s === 7 ? '—' : pct(WAYS[s] / (WAYS[s] + 6), 1) }),
      h('td', { class: 'bar-cell' }, h('span', { class: 'mini-bar', style: { width: `${(WAYS[s] / 6) * 100}%` } })));
    tr.addEventListener('pointerenter', () => highlight(s));
    tr.addEventListener('focus', () => highlight(s));
    tr.addEventListener('pointerleave', () => highlight(0));
    probRows.push(tr);
  }

  root.append(h('section', { class: 'card' },
    h('h3', { text: 'Two dice, 36 combinations, sums 2–12' }),
    h('p', { class: 'card-sub', text: 'Every craps probability comes from this table. There are 6 ways to roll a 7 — more than any other number — which is why the 7 decides so many bets. Hover a row to highlight its combinations.' }),
    h('div', { class: 'learn-split' },
      h('table', { class: 'data-table compact' },
        h('thead', {}, h('tr', {}, ['Sum', 'Ways', 'Probability', 'Odds against', 'Before a 7', ''].map((t, i) => h('th', { class: i < 5 ? 'num' : '', text: t })))),
        h('tbody', {}, probRows)),
      grid)));

  // ---- House edge of every bet
  const bets = [
    ['Pass Line / Come', 'pass', 0, 10, '1:1', LINE_PROBS.passWin],
    ["Don't Pass / Don't Come", 'dontPass', 0, 10, '1:1 (12 pushes)', LINE_PROBS.dontWin],
    ...POINT_NUMBERS.filter((n) => n <= 6).map((n) => [`Free odds on ${n} / ${14 - n}`, 'passOdds', n, n === 6 ? 10 : n === 5 ? 10 : 10, ratio(TRUE_ODDS[n]), pBefore7(n)]),
    ...POINT_NUMBERS.filter((n) => n <= 6).map((n) => [`Lay odds on ${n} / ${14 - n}`, 'dontPassOdds', n, n === 6 ? 12 : n === 5 ? 15 : 20, ratio(LAY_ODDS[n]), 1 - pBefore7(n)]),
    ...[6, 5, 4].map((n) => [`Place ${n} / ${14 - n}`, 'place', n, n === 6 ? 12 : 10, ratio(PLACE_ODDS[n]), pBefore7(n)]),
    ...[4, 5, 6].map((n) => [`Buy ${n} / ${14 - n}`, 'buy', n, n === 6 ? 25 : n === 5 ? 20 : 20, `${ratio(TRUE_ODDS[n])} − ${(r.vigRate * 100).toFixed(0)}%`, pBefore7(n)]),
    ...[4, 5, 6].map((n) => [`Lay ${n} / ${14 - n}`, 'lay', n, n === 6 ? 24 : n === 5 ? 30 : 40, `${ratio(LAY_ODDS[n])} − ${(r.vigRate * 100).toFixed(0)}%`, 1 - pBefore7(n)]),
    [`Field (2 pays ${r.field2Pays}:1, 12 pays ${r.field12Pays}:1)`, 'field', 0, 10, '1:1 / bonus', 16 / 36],
    ['Big 6 / Big 8', 'big', 6, 10, '1:1', pBefore7(6)],
    ['Hard 6 / Hard 8', 'hard', 6, 5, '9:1', 1 / 11],
    ['Hard 4 / Hard 10', 'hard', 4, 5, '7:1', 1 / 9],
    ...Object.entries(PROPS).map(([k, p]) => [`${p.label} (one roll)`, k, 0, 5, `${p.pays}:1`, winProbability(k)]),
  ].map(([label, type, n, amt, pays, pw]) => ({ label, type, n, amt, pays, pw, edge: houseEdge(type, n, amt, r) }));
  bets.sort((a, b) => a.edge - b.edge);

  root.append(h('section', { class: 'card' },
    h('h3', {}, 'House edge of every bet at this table', info('Computed exactly from the dice probabilities and this table\'s payouts, rounding and commission rules (change them on the Table Rules tab). Example bet sizes are the casino-friendly units.')),
    h('p', { class: 'card-sub', text: 'Sorted best to worst. "Per $100" is the expected result for every $100 of that bet that reaches a decision. The free odds are the only bet in the casino with no house edge.' }),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data-table compact' },
      h('thead', {}, h('tr', {}, ['Bet', 'Pays', 'Example bet', 'Win probability', 'House edge', 'Per $100'].map((t, i) => h('th', { class: i > 1 ? 'num' : '', text: t })))),
      h('tbody', {}, bets.map((b) => h('tr', {},
        h('td', { text: b.label }), h('td', { text: b.pays }),
        h('td', { class: 'num', text: money(b.amt) }),
        h('td', { class: 'num', text: pct(b.pw, 2) }),
        h('td', { class: `num strong ${b.edge <= 0.0001 ? 'good' : b.edge > 0.05 ? 'bad' : ''}`, text: pct(b.edge, 3) }),
        h('td', { class: 'num', text: money(-b.edge * 100, { decimals: 2 }) }))))))));

  // ---- Odds dilution
  const oddsRows = Object.entries(ODDS_LIMITS).map(([k, o]) => ({ label: o.label, edge: passWithOddsEdge(o.mult) }));
  root.append(h('section', { class: 'card' },
    h('h3', { text: 'Why taking odds matters' }),
    h('p', { class: 'card-sub', text: `The Pass Line costs ${pct(7 / 495, 3)} of the flat bet. Odds behind it pay true odds (0% edge), so the more odds you take, the smaller the edge on your total wager — though your dollar loss per game stays the same and your swings get bigger.` }),
    h('table', { class: 'data-table compact narrow' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Odds taken' }), h('th', { class: 'num', text: 'Combined edge' }))),
      h('tbody', {}, h('tr', {}, h('td', { text: 'None' }), h('td', { class: 'num', text: pct(7 / 495, 3) })),
        oddsRows.map((o) => h('tr', { class: o.label.startsWith(ODDS_LIMITS[r.oddsLimit].label) ? 'current' : '' }, h('td', { text: o.label }), h('td', { class: 'num', text: pct(o.edge, 3) })))))));

  // ---- Concepts
  const concept = (title, ...paras) => h('details', { class: 'concept' }, h('summary', { text: title }), ...paras.map((p) => h('p', { text: p })));
  root.append(h('section', { class: 'card' },
    h('h3', { text: 'How the analysis works' }),
    concept('What is a Monte Carlo simulation?',
      'Instead of solving every possible sequence of rolls on paper (impossible for strategies with presses, progressions and stop rules), we play the strategy thousands of times with random dice and measure what happened. Each simulated session is one sample; together they form the distribution of outcomes.',
      'By the law of large numbers the average of many sessions converges on the true expected value. The 95% confidence interval (± shown next to every average) tells you how far the estimate might still be from the truth — it shrinks with the square root of the number of sessions, so 4× the sessions halves the uncertainty.'),
    concept('Expected value and the house edge',
      'Expected value (EV) = Σ probability × payoff. For a $10 Pass Line bet: win $10 with probability 244/495, lose $10 with probability 251/495 → EV = −$0.141, a 1.41% house edge.',
      'The app tracks two edges for each strategy: the simulated one (total lost ÷ total wagered) and the theoretical one (the exact EV of every bet that was actually made, summed). When they agree, the simulation has converged. The theoretical number also proves that no strategy can do better than the weighted average edge of its bets.'),
    concept('Why progressions (Martingale & co.) cannot win',
      'Every individual bet has a negative EV, and the sum of negative numbers is negative — no matter how you size the bets. A Martingale turns many small wins into a high "chance to finish ahead", but pays for it with rare, very large losses (the left tail of the histogram, and a high risk of ruin when the table maximum or bankroll stops the doubling).',
      'Compare a progression with its flat-bet twin in the results: the house edge per dollar is the same, the distribution shape is not.'),
    concept('Common random numbers (fair comparisons)',
      'Session #1 of every strategy uses exactly the same dice, as does session #2, and so on. Differences between strategies therefore come from the strategies, not from one getting luckier dice. This makes head-to-head comparisons far more precise than independent runs (the "A vs B" insight uses a paired test for this reason).'),
    concept('Reading risk vs. reward',
      'Average result (mean) is the reward. Risk has several faces: volatility (standard deviation), the bad-day loss (CVaR 5% — the average of the worst 5% of sessions), risk of ruin (going broke), and drawdown (the biggest drop from a high point).',
      'The efficient frontier connects the strategies that no other strategy beats on both reward and risk. If a strategy is off the frontier, there is another one that is at least as good on both measures. The balanced score combines several measures into one ranking, but the frontier is the more principled way to choose.'),
    concept('Session rules used by the simulator',
      `A "game" is one Pass Line decision: from a come-out roll until a natural/craps or until the point is made or a seven-out (${THEORY.rollsPerGame.toFixed(3)} rolls on average; a shooter's hand lasts ${THEORY.rollsPerHand.toFixed(2)} rolls on average). The session ends after the chosen number of games, when the bankroll can no longer cover the strategy's smallest bet (ruin), or when the stop-loss / win goal is reached.`,
      'At the end, standing bets (place, buy, lay, hardways, big 6/8) are taken down and contract bets (Pass/Come with a point, and Don\'t bets) are allowed to resolve, so no money is left in limbo.'),
    concept('Casino-accurate details',
      'Payouts are rounded down to the smallest chip (configurable), so a $10 Place 6 wins $11, not $11.67 — use $6 multiples. Buy and lay commissions are 5%, rounded down with a $1 minimum. Come odds are off on the come-out roll; place, buy, lay and hardway bets are off on the come-out unless you change the house rules. Don\'t Pass/Don\'t Come push on 12 (bar 12). Odds limits follow the selected table (3-4-5x by default) and lay odds may win up to the same multiple.'),
  ));
}
