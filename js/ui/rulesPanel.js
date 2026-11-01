// Table Rules: every house rule that changes payouts or bet timing.

import { h, clear, field, numberInput, select, checkbox, toast, info, pct } from './dom.js';
import { store } from './state.js';
import { ODDS_LIMITS, DEFAULT_RULES, GAMES, houseEdge } from '../engine/rules.js';

export const RULE_PRESETS = {
  vegas: { label: 'Las Vegas Strip ($10, 3-4-5x)', rules: { ...DEFAULT_RULES } },
  downtown: { label: 'Downtown Vegas ($5, 10x odds, field 12 pays 3:1)', rules: { ...DEFAULT_RULES, tableMin: 5, tableMax: 3000, oddsLimit: '10x', field12Pays: 3 } },
  highLimit: { label: 'High limit ($100, 5x odds)', rules: { ...DEFAULT_RULES, tableMin: 100, tableMax: 25000, oddsLimit: '5x', propMin: 5 } },
  generous: { label: 'Player-friendly (100x odds, field 3:1, vig on wins)', rules: { ...DEFAULT_RULES, tableMin: 5, oddsLimit: '100x', field12Pays: 3 } },
  crapless: { label: 'Crapless craps ($10, 3-4-5x; 2, 3, 11, 12 are box numbers)', rules: { ...DEFAULT_RULES, game: 'crapless' } },
  stingy: { label: 'Tight (2x odds, vig always, $25 min)', rules: { ...DEFAULT_RULES, tableMin: 25, tableMax: 5000, oddsLimit: '2x', vigOn: 'always' } },
  math: { label: 'Theoretical (exact payouts, no rounding)', rules: { ...DEFAULT_RULES, rounding: 'exact' } },
};

export function mountRules(root) {
  const body = h('div', {});
  root.append(body);
  const draw = () => render(body);
  draw();
  store.on('rules', draw);
}

function render(root) {
  clear(root);
  const r = { ...store.rules };
  const apply = () => store.setRules(r);
  const pending = h('p', { class: 'field-hint' });
  const touch = (fn) => (v) => { fn(v); pending.textContent = 'Unsaved changes'; };

  const presetSel = select([{ value: '', label: 'Load a casino preset…' }, ...Object.entries(RULE_PRESETS).map(([value, p]) => ({ value, label: p.label }))], '', (v) => {
    if (!RULE_PRESETS[v]) return;
    store.setRules(RULE_PRESETS[v].rules);
    toast(`Loaded “${RULE_PRESETS[v].label}”. Strategies below the new minimum will show errors.`, 'good', 4500);
  });

  const yesNo = [{ value: 'false', label: 'Off (casino standard)' }, { value: 'true', label: 'Working' }];
  root.append(
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Table limits & payouts', info('These rules apply everywhere: the simulator, the explorer, the live table and the odds tables.')), presetSel),
      h('div', { class: 'form-grid' },
        field('Game', select(Object.entries(GAMES).map(([value, label]) => ({ value, label })), r.game, touch((v) => { r.game = v; })), r.game === 'crapless' ? 'Only 7 wins on the come-out; 2, 3, 11, 12 become points; no Don\'t bets' : 'Come-out 7/11 win, 2/3/12 lose; box numbers 4–10'),
        field('Table minimum ($)', numberInput(r.tableMin, touch((v) => { r.tableMin = v; })), 'Line, Come, Field, Place, Buy and Lay minimum'),
        field('Table maximum ($)', numberInput(r.tableMax, touch((v) => { r.tableMax = v; }), { step: 100 })),
        field('Prop / hardway minimum ($)', numberInput(r.propMin, touch((v) => { r.propMin = v; }))),
        field('Odds limit', select(Object.entries(ODDS_LIMITS).map(([value, o]) => ({ value, label: o.label })), r.oddsLimit, touch((v) => { r.oddsLimit = v; }))),
        field('Field pays on 2', select([{ value: 2, label: '2 to 1' }, { value: 3, label: '3 to 1' }], r.field2Pays, touch((v) => { r.field2Pays = +v; }))),
        field('Field pays on 12', select([{ value: 2, label: '2 to 1' }, { value: 3, label: '3 to 1' }], r.field12Pays, touch((v) => { r.field12Pays = +v; }))),
        field('Payout rounding', select([{ value: 'dollar', label: 'Round down to $1 (most casinos)' }, { value: 'half', label: 'Round down to $0.50' }, { value: 'exact', label: 'Exact (theoretical)' }], r.rounding, touch((v) => { r.rounding = v; }))),
        field('Buy/Lay commission', numberInput(r.vigRate * 100, touch((v) => { r.vigRate = v / 100; }), { step: 0.5 }), '% (standard 5)'),
        field('Commission charged', select([{ value: 'win', label: 'Only on wins (common)' }, { value: 'always', label: 'Up front, every decision' }], r.vigOn, touch((v) => { r.vigOn = v; }))),
      )),
    h('section', { class: 'card' },
      h('h3', {}, 'Come-out roll', info('On the come-out roll, most casinos treat place, buy, lay, hardway and come-bet odds as "off": they stay on the table but don\'t win or lose.')),
      h('div', { class: 'form-grid' },
        field('Come-bet odds on come-out', select(yesNo, String(r.comeOddsWorkingOnComeOut), touch((v) => { r.comeOddsWorkingOnComeOut = v === 'true'; }))),
        field('Place / Buy / Lay on come-out', select(yesNo, String(r.placeWorkingOnComeOut), touch((v) => { r.placeWorkingOnComeOut = v === 'true'; }))),
        field('Hardways on come-out', select(yesNo, String(r.hardWorkingOnComeOut), touch((v) => { r.hardWorkingOnComeOut = v === 'true'; }))),
      ),
      h('div', { class: 'run-row' },
        h('button', { class: 'btn btn-primary', text: 'Apply rules', on: { click: () => { apply(); toast('Table rules updated.', 'good'); } } }),
        h('button', { class: 'btn btn-ghost', text: 'Reset to Las Vegas standard', on: { click: () => store.setRules(DEFAULT_RULES) } })),
      pending),
    h('section', { class: 'card' },
      h('h3', { text: 'What these rules cost' }),
      h('div', { class: 'stat-strip' },
        stat('Field', pct(houseEdge('field', 0, 10, store.rules), 2)),
        stat('$10 Place 6 (rounded)', pct(houseEdge('place', 6, 10, store.rules), 2), '$12 → ' + pct(houseEdge('place', 6, 12, store.rules), 2)),
        stat('$20 Buy 4', pct(houseEdge('buy', 4, 20, store.rules), 2)),
        stat('$10 Buy 4 ($1 min vig)', pct(houseEdge('buy', 4, 10, store.rules), 2)),
        stat('$40 Lay 4', pct(houseEdge('lay', 4, 40, store.rules), 2)),
        stat('Pass Line', pct(houseEdge('pass', 0, 10, store.rules), 3), store.rules.game === 'crapless' ? 'crapless (standard: 1.414%)' : 'standard'),
        stat('Horn ($4)', pct(houseEdge('horn', 0, 4, store.rules), 2)))));
}

function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: label }), h('div', { class: 'stat-value tnum', text: value }), sub ? h('div', { class: 'stat-sub', text: sub }) : null);
}

export { checkbox };
