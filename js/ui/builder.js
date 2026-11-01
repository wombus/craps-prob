// Strategy builder: a modal form that edits a draft copy of a strategy, validates it
// live against the table rules, and previews what every bet costs (its house edge).

import { h, clear, field, numberInput, select, checkbox, money, pct, info } from './dom.js';
import { store, colorFor } from './state.js';
import { normalizeStrategy, validateStrategy, describeStrategy, strategyBets, ODDS_CHOICES, PLACE_ON_HIT, WHEN_CHOICES } from '../engine/strategy.js';
import { PROGRESSIONS } from '../engine/progressions.js';
import { houseEdge, passWithOddsEdge, ODDS_LIMITS, maxOddsMultiple, UNITS } from '../engine/rules.js';
import { POINT_NUMBERS, HARD_NUMBERS, PROP_TYPES, PROPS, pointNumbers } from '../engine/constants.js';

const oddsOptions = ODDS_CHOICES.map((v) => ({ value: v, label: v === 0 ? 'None' : v === 'max' ? 'Max (table limit)' : `${v}x` }));
const whenOptions = (keys) => keys.map((k) => ({ value: k, label: WHEN_CHOICES[k] }));

let dialog = null;

export function openBuilder(strategy, { onSave, title = 'Edit strategy' } = {}) {
  const draft = normalizeStrategy(JSON.parse(JSON.stringify(strategy)));
  draft.colorSlot = strategy.colorSlot ?? null;
  if (!dialog) {
    dialog = h('dialog', { class: 'builder-dialog', attrs: { 'aria-labelledby': 'builder-title' } });
    document.body.append(dialog);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); dialog.close(); });
  }
  clear(dialog);

  const status = h('div', { class: 'builder-status' });
  const summary = h('p', { class: 'builder-summary' });
  const costs = h('div', { class: 'builder-costs' });
  const saveBtn = h('button', { class: 'btn btn-primary', text: 'Save strategy' });

  const refresh = () => {
    const { errors, warnings } = validateStrategy(draft, store.rules);
    clear(status);
    for (const e of errors) status.append(h('div', { class: 'msg msg-bad' }, h('span', { class: 'msg-icon', text: '✕' }), h('span', { text: e })));
    for (const w of warnings) status.append(h('div', { class: 'msg msg-warn' }, h('span', { class: 'msg-icon', text: '!' }), h('span', { text: w })));
    if (!errors.length && !warnings.length) status.append(h('div', { class: 'msg msg-good' }, h('span', { class: 'msg-icon', text: '✓' }), h('span', { text: 'Valid at this table.' })));
    saveBtn.disabled = errors.length > 0;
    summary.textContent = describeStrategy(draft);
    renderCosts(costs, draft);
  };
  const set = (fn) => (v) => { fn(v); refresh(); };

  const sec = (titleText, hint, ...body) => h('fieldset', { class: 'builder-section' },
    h('legend', {}, titleText, hint ? info(hint) : null), ...body);

  const rules = store.rules;
  const grid = (...kids) => h('div', { class: 'form-grid' }, ...kids);

  // --- Line bets
  const lineSec = sec('Line bet', 'Pass Line wins on 7/11 on the come-out and when the point repeats before a 7. Don\'t Pass is the opposite (12 pushes). Free odds pay true odds — 0% house edge.',
    grid(
      field('Bet', select([{ value: 'none', label: 'None' }, { value: 'pass', label: 'Pass Line' }, { value: 'dontPass', label: "Don't Pass" }], draft.line.type, set((v) => { draft.line.type = v; }))),
      field('Amount ($)', numberInput(draft.line.amount, set((v) => { draft.line.amount = v; }), { min: 0 })),
      field('Odds', select(oddsOptions, draft.line.odds, set((v) => { draft.line.odds = v === 'max' ? 'max' : +v; })), `Table limit: ${ODDS_LIMITS[rules.oddsLimit].label}`),
    ));

  const comeSec = sec('Come / Don\'t Come', 'A Come bet is a Pass Line bet made after the point is set; it travels to the next number rolled. The strategy keeps up to N of them working, one new bet per roll.',
    h('div', { class: 'sub-label', text: 'Come bets' }),
    grid(
      field('How many working', numberInput(draft.come.count, set((v) => { draft.come.count = v; }), { min: 0, max: 6 })),
      field('Amount ($)', numberInput(draft.come.amount, set((v) => { draft.come.amount = v; }))),
      field('Odds', select(oddsOptions, draft.come.odds, set((v) => { draft.come.odds = v === 'max' ? 'max' : +v; })), rules.comeOddsWorkingOnComeOut ? 'Odds work on come-out (house rule)' : 'Come odds are off on the come-out'),
    ),
    h('div', { class: 'sub-label', text: "Don't Come bets" }),
    grid(
      field('How many working', numberInput(draft.dontCome.count, set((v) => { draft.dontCome.count = v; }), { min: 0, max: 6 })),
      field('Amount ($)', numberInput(draft.dontCome.amount, set((v) => { draft.dontCome.amount = v; }))),
      field('Lay odds', select(oddsOptions, draft.dontCome.odds, set((v) => { draft.dontCome.odds = v === 'max' ? 'max' : +v; })), 'Lay enough to win N× the flat bet'),
    ));

  // --- Place / buy
  const crapless = rules.game === 'crapless';
  const payText = (n) => ({ 2: '11:2', 3: '11:4', 4: '9:5', 5: '7:5', 6: '7:6', 8: '7:6', 9: '7:5', 10: '9:5', 11: '11:4', 12: '11:2' }[n]);
  // Keep any 2/3/11/12 amounts visible even at a standard table, so the validation error is explainable.
  const placeNums = crapless ? pointNumbers(rules) : [2, 3, 11, 12].filter((n) => draft.place.amounts[n] > 0).concat(POINT_NUMBERS).sort((a, b) => a - b);
  const placeRow = h('div', { class: 'number-grid' }, placeNums.map((n) => h('div', { class: 'number-cell' },
    h('div', { class: 'number-cell-head', text: `${n} · pays ${payText(n)}` }),
    numberInput(draft.place.amounts[n], set((v) => { draft.place.amounts[n] = v; }), { min: 0, step: UNITS.place[n] }),
    checkbox('Buy', draft.place.buy.includes(n), set((c) => { draft.place.buy = c ? [...new Set([...draft.place.buy, n])] : draft.place.buy.filter((x) => x !== n); })),
  )));
  const placeSec = sec('Place & Buy bets', 'Place bets win when the number rolls before a 7 and stay up after winning. Place pays 9:5 (4/10), 7:5 (5/9), 7:6 (6/8) — and at a crapless table 11:2 (2/12) and 11:4 (3/11). Buy pays true odds minus a 5% commission. Bet in the payout\'s units ($6 on 6/8, $5 on 4/5/9/10, $2 on 2/12, $4 on 3/11) to avoid rounded-down payouts.',
    placeRow,
    crapless ? null : h('p', { class: 'field-hint', text: '2, 3, 11 and 12 aren\'t box numbers in standard craps — they decide the come-out roll. Bet them with the Field, the one-roll props or the Horn below, or switch to Crapless craps on the Table Rules tab to place them.' }),
    grid(
      field('When to bet', select(whenOptions(['pointOn', 'always']), draft.place.when, set((v) => { draft.place.when = v; }))),
      field('After a hit', select(Object.entries(PLACE_ON_HIT).map(([value, label]) => ({ value, label })), draft.place.onHit, set((v) => { draft.place.onHit = v; }))),
      field('Press cap (× base)', numberInput(draft.place.maxPress, set((v) => { draft.place.maxPress = v; }), { min: 1 })),
      field('Take down after N hits', numberInput(draft.place.downAfterHits, set((v) => { draft.place.downAfterHits = v; }), { min: 0 }), '0 = never; resets on seven-out'),
    ),
    checkbox('Skip numbers already covered by my Pass/Come bets', draft.place.skipCovered, set((c) => { draft.place.skipCovered = c; })));

  // --- Lay
  const laySec = sec('Lay bets', 'A lay bet wins if a 7 rolls before the number. It pays the reverse of true odds (e.g. lay $40 to win $20 on the 4) minus 5% commission on the win.',
    h('div', { class: 'number-grid' }, POINT_NUMBERS.map((n) => h('div', { class: 'number-cell' },
      h('div', { class: 'number-cell-head', text: String(n) }),
      numberInput(draft.lay.amounts[n], set((v) => { draft.lay.amounts[n] = v; }), { min: 0 }))),
    ),
    grid(field('When to bet', select(whenOptions(['pointOn', 'always']), draft.lay.when, set((v) => { draft.lay.when = v; })))));

  // --- One-roll and hardways
  const fieldSec = sec('Field', `One-roll bet on 2, 3, 4, 9, 10, 11, 12. Pays even money; 2 pays ${rules.field2Pays}:1 and 12 pays ${rules.field12Pays}:1 at this table.`,
    grid(
      field('Amount ($)', numberInput(draft.field.amount, set((v) => { draft.field.amount = v; }))),
      field('When to bet', select(whenOptions(['always', 'pointOn', 'comeOut']), draft.field.when, set((v) => { draft.field.when = v; }))),
    ));

  const hardSec = sec('Hardways', 'Hard 6/8 pays 9:1, hard 4/10 pays 7:1. Loses on a 7 or if the number rolls "easy". Re-bet automatically after a loss.',
    h('div', { class: 'number-grid' }, HARD_NUMBERS.map((n) => h('div', { class: 'number-cell' },
      h('div', { class: 'number-cell-head', text: `Hard ${n}` }),
      numberInput(draft.hard.amounts[n], set((v) => { draft.hard.amounts[n] = v; }), { min: 0 })))),
    grid(field('When to bet', select(whenOptions(['pointOn', 'always']), draft.hard.when, set((v) => { draft.hard.when = v; })))));

  const propSec = sec('Proposition bets (2, 3, 11, 12 and more)', 'One-roll center-table bets — this is where 2, 3, 11 and 12 are bet individually in standard craps. Horn = $1 each on 2, 3, 11, 12 (bet in $4 units); C&E = half Any Craps, half Yo. Highest house edges on the table (11–17%).',
    h('div', { class: 'number-grid' }, PROP_TYPES.map((p) => h('div', { class: 'number-cell' },
      h('div', { class: 'number-cell-head', text: `${PROPS[p].label} · ${PROPS[p].paysLabel}` }),
      numberInput(draft.props.amounts[p], set((v) => { draft.props.amounts[p] = v; }), { min: 0 })))),
    grid(
      field('When to bet', select(whenOptions(['comeOut', 'pointOn', 'always']), draft.props.when, set((v) => { draft.props.when = v; }))),
      field('Big 6 ($)', numberInput(draft.big.amounts[6], set((v) => { draft.big.amounts[6] = v; }))),
      field('Big 8 ($)', numberInput(draft.big.amounts[8], set((v) => { draft.big.amounts[8] = v; }))),
    ));

  // --- Progression
  const progDesc = h('p', { class: 'field-hint', text: PROGRESSIONS[draft.progression.type].describe });
  const progSec = sec('Betting progression', 'Changes the size of the line (or field) bet based on previous results. Watch how it changes the histogram — and how it never changes the edge.',
    grid(
      field('Progression', select(Object.entries(PROGRESSIONS).map(([value, p]) => ({ value, label: p.label })), draft.progression.type, set((v) => { draft.progression.type = v; progDesc.textContent = PROGRESSIONS[v].describe; }))),
      field('Applies to', select([{ value: 'line', label: 'Line bet (+ its odds)' }, { value: 'field', label: 'Field bet' }], draft.progression.target, set((v) => { draft.progression.target = v; }))),
      field('Max multiplier', numberInput(draft.progression.maxMultiplier, set((v) => { draft.progression.maxMultiplier = v; }), { min: 1 }), 'Martingale resets when the next bet would exceed this'),
      field('Paroli wins in a row', numberInput(draft.progression.paroliSteps, set((v) => { draft.progression.paroliSteps = v; }), { min: 1 })),
    ),
    progDesc);

  const nameInput = h('input', { type: 'text', value: draft.name, maxLength: 80, attrs: { 'aria-label': 'Strategy name' } });
  nameInput.addEventListener('input', () => { draft.name = nameInput.value; });
  const notes = h('textarea', { rows: 2, value: draft.notes, maxLength: 500, placeholder: 'Notes (optional)' });
  notes.addEventListener('input', () => { draft.notes = notes.value; });

  saveBtn.addEventListener('click', () => {
    if (!draft.name.trim()) draft.name = describeStrategy(draft);
    const saved = (onSave || ((s) => store.upsertStrategy(s)))(draft);
    dialog.close();
    return saved;
  });

  dialog.append(
    h('header', { class: 'builder-head' },
      h('span', { class: 'swatch', style: { background: colorFor(draft.colorSlot) } }),
      h('h2', { id: 'builder-title', text: title }),
      h('button', { class: 'btn btn-ghost icon-btn', attrs: { 'aria-label': 'Close' }, text: '✕', on: { click: () => dialog.close() } })),
    h('div', { class: 'builder-body' },
      h('div', { class: 'builder-form' },
        field('Name', nameInput), notes,
        lineSec, comeSec, placeSec, laySec, fieldSec, hardSec, propSec, progSec),
      h('aside', { class: 'builder-side' },
        h('h3', { text: 'Summary' }), summary,
        h('h3', { text: 'Validation' }), status,
        h('h3', {}, 'What each bet costs', info('House edge = the casino\'s expected profit as a share of each bet decision, computed exactly from the payouts and dice probabilities at this table (including rounding and commission).')),
        costs)),
    h('footer', { class: 'builder-foot' },
      h('button', { class: 'btn btn-ghost', text: 'Cancel', on: { click: () => dialog.close() } }),
      saveBtn));

  refresh();
  dialog.showModal();
}

function renderCosts(el, s) {
  clear(el);
  const rules = store.rules;
  const rows = strategyBets(s).map((b) => {
    const t = ['come', 'dontCome'].includes(b.type) ? b.type : b.type;
    const e = houseEdge(t, b.number || 0, b.amount, rules);
    return { label: b.label, amount: b.amount, edge: e };
  });
  if (s.line.type === 'pass' && s.line.odds) {
    const mult = {};
    for (const n of pointNumbers(rules)) mult[n] = s.line.odds === 'max' ? maxOddsMultiple(rules, n) : Math.min(s.line.odds, maxOddsMultiple(rules, n));
    rows.push({ label: `Pass + ${s.line.odds === 'max' ? 'max' : s.line.odds + 'x'} odds combined`, amount: null, edge: passWithOddsEdge(mult, rules) });
  }
  if (!rows.length) { el.append(h('p', { class: 'muted', text: 'No bets yet.' })); return; }
  const tbl = h('table', { class: 'mini-table' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Bet' }), h('th', { class: 'num', text: 'Base' }), h('th', { class: 'num', text: 'Edge' }), h('th', { class: 'num', text: 'Per $100' }))),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('td', { text: r.label }),
      h('td', { class: 'num', text: r.amount === null ? '' : money(r.amount) }),
      h('td', { class: `num ${r.edge > 0.05 ? 'bad' : r.edge < 0.015 ? 'good' : ''}`, text: pct(r.edge, 2) }),
      h('td', { class: 'num', text: money(-r.edge * 100, { decimals: 2 }) })))));
  el.append(tbl, h('p', { class: 'field-hint', text: 'Per $100: expected result for every $100 of that bet that reaches a decision.' }));
}
