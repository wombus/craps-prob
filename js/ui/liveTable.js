// Live Table: play craps with paper money on a clickable layout, by hand or by letting
// one of your strategies place the bets (watch a strategy play roll by roll).

import { h, clear, money, pct, toast, numberInput, info } from './dom.js';
import { store } from './state.js';
import { PlayerSession, labelFor, minimumFor } from '../engine/session.js';
import { StrategyExecutor } from '../engine/strategy.js';
import { cryptoDie } from '../engine/rng.js';
import { WAYS, ALL_BOX_NUMBERS, PROPS, keyLabel } from '../engine/constants.js';
import { columns, lineChart, mount } from './charts.js';

const CHIPS = [1, 5, 25, 100, 500, 1000];
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const CALLS = { 2: 'Aces — craps!', 3: 'Ace-deuce, craps three', 11: 'Yo-leven!', 12: 'Boxcars — craps twelve' };
const NICKNAMES = { 2: 'Aces', 3: 'Ace-deuce', 11: 'Yo-leven', 12: 'Boxcars' };
const OUTSIDE = new Set([2, 3, 11, 12]);

export function mountLiveTable(root) {
  let sess = new PlayerSession(store.rules, store.liveBankroll);
  let chip = 5;
  let numberMode = 'place';
  let removeMode = false;
  let executor = null;
  let autoStrategyId = '';
  let autoTimer = null;
  const history = [];          // recent sums
  const bankrollTrail = [sess.bankroll];
  const freq = new Array(13).fill(0);
  const log = [];
  const stats = { games: 0, pointsMade: 0, sevenOuts: 0, hand: 0, longestHand: 0, bestRoll: 0, worstRoll: 0 };

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  const spot = (id, label, cls = '', sub = '', ...extra) => h('button', { class: `spot ${cls}`, dataset: { spot: id }, attrs: { 'aria-label': `${label}${sub ? `, ${sub}` : ''}` } },
    h('span', { class: 'spot-label', text: label }), sub ? h('span', { class: 'spot-sub', text: sub }) : null, ...extra, h('span', { class: 'spot-chips' }));

  // Box numbers. 2, 3, 11 and 12 are only box numbers in crapless craps; CSS hides them otherwise.
  const boxLabel = { 6: 'SIX', 9: 'NINE' };
  const numbers = h('div', { class: 'numbers-row' }, ALL_BOX_NUMBERS.map((n) => h('div', { class: `number-box ${OUTSIDE.has(n) ? 'crapless-only' : ''}`, dataset: { n } },
    spot(`dc-${n}`, `Don't Come on ${n}`, 'spot-dc dont-only', 'DC'),
    spot(`num-${n}`, boxLabel[n] || String(n), 'spot-number', placeSub(n)),
    spot(`come-${n}`, `Come on ${n}`, 'spot-cn', 'COME'),
    h('span', { class: 'puck', hidden: true, text: 'ON' }))));

  // Field: the numbers are printed on the felt, with the bonus numbers circled.
  const fieldNums = h('span', { class: 'field-numbers', attrs: { 'aria-hidden': 'true' } });
  const drawFieldNumbers = () => {
    const r = store.rules;
    clear(fieldNums).append(...[2, 3, 4, 9, 10, 11, 12].map((n) => {
      const bonus = n === 2 ? r.field2Pays : n === 12 ? r.field12Pays : 0;
      return h('span', { class: `field-num ${bonus ? 'bonus' : ''}` }, h('span', { text: String(n) }), bonus ? h('small', { text: `pays ${bonus}×` }) : null);
    }));
  };
  drawFieldNumbers();

  // One-roll numbers: where 2, 3, 11 and 12 are bet in standard craps.
  const DICE_FOR = { 2: [1, 1], 3: [1, 2], 11: [5, 6], 12: [6, 6], 4: [2, 2], 6: [3, 3], 8: [4, 4], 10: [5, 5] };
  const oneRoll = (id, n, name, pays) => spot(id, String(n), 'spot-prop prop-num', `${name} · ${pays}`, miniDice(...DICE_FOR[n]));
  const hardway = (n, pays) => spot(`hard${n}`, `Hard ${n}`, 'spot-prop', pays, miniDice(...DICE_FOR[n]));

  const felt = h('div', { class: `felt ${store.rules.game === 'crapless' ? 'crapless' : ''}` },
    h('div', { class: 'felt-main' },
      h('div', { class: 'felt-top' }, spot('dontCome', "DON'T COME", 'spot-dontcome dont-only', 'Bar 12'), numbers),
      spot('come', 'COME', 'spot-come'),
      spot('field', 'FIELD', 'spot-field', '', fieldNums),
      h('div', { class: 'line-row dont-only' }, spot('dontPass', "DON'T PASS BAR 12", 'spot-dontpass'), spot('dontPassOdds', 'Lay odds', 'spot-odds')),
      h('div', { class: 'line-row' }, spot('pass', 'PASS LINE', 'spot-pass'), spot('passOdds', 'Odds', 'spot-odds')),
      h('div', { class: 'big-row' }, spot('big6', 'BIG 6', 'spot-big'), spot('big8', 'BIG 8', 'spot-big'))),
    h('div', { class: 'felt-props' },
      h('div', { class: 'props-title', text: 'HARDWAYS' }),
      h('div', { class: 'props-grid' },
        hardway(6, '9 to 1'), hardway(10, '7 to 1'), hardway(8, '9 to 1'), hardway(4, '7 to 1'),
        spot('any7', 'Any Seven', 'spot-prop wide', '4 to 1')),
      h('div', { class: 'props-title', text: 'ONE-ROLL NUMBERS' }),
      h('div', { class: 'props-grid' },
        oneRoll('aces', 2, 'Aces', '30 to 1'), oneRoll('aceDeuce', 3, 'Ace-Deuce', '15 to 1'),
        oneRoll('boxcars', 12, 'Boxcars', '30 to 1'), oneRoll('yo', 11, 'Yo', '15 to 1'),
        spot('horn', 'HORN', 'spot-prop', '2 · 3 · 11 · 12'), spot('ce', 'C & E', 'spot-prop', 'Craps & Eleven'),
        spot('anyCraps', 'Any Craps', 'spot-prop wide', '2 · 3 · 12 · 7 to 1'))));

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  const die1 = dieEl(), die2 = dieEl();
  const callout = h('div', { class: 'callout', attrs: { 'aria-live': 'polite' }, text: 'Place your bets — come-out roll' });
  const rollBtn = h('button', { class: 'btn btn-primary btn-roll', text: 'Roll dice', title: 'Shortcut: Space' });
  const bankEl = h('strong', { class: 'tnum' }), netEl = h('strong', { class: 'tnum' }), tableEl = h('strong', { class: 'tnum' });
  const chipRow = h('div', { class: 'chip-row', attrs: { role: 'radiogroup', 'aria-label': 'Chip value' } });
  const drawChipRow = () => {
    clear(chipRow);
    for (const c of CHIPS) {
      chipRow.append(h('button', { class: `chip-btn chip-${c} ${c === chip ? 'on' : ''}`, attrs: { role: 'radio', 'aria-checked': String(c === chip), 'aria-label': `$${c} chip` }, text: c >= 1000 ? '1K' : String(c), on: { click: () => { chip = c; drawChipRow(); } } }));
    }
  };
  drawChipRow();
  const modeRow = h('div', { class: 'seg', attrs: { role: 'radiogroup', 'aria-label': 'Box number bet type' } });
  const drawModes = () => {
    clear(modeRow);
    for (const [m, l] of [['place', 'Place'], ['buy', 'Buy'], ['lay', 'Lay']]) {
      modeRow.append(h('button', { class: `seg-btn ${m === numberMode ? 'on' : ''}`, attrs: { role: 'radio', 'aria-checked': String(m === numberMode) }, text: l, on: { click: () => { numberMode = m; drawModes(); } } }));
    }
  };
  drawModes();
  const removeBtn = h('button', { class: 'btn btn-small', text: 'Remove mode: off', attrs: { 'aria-pressed': 'false' } });
  removeBtn.addEventListener('click', () => { removeMode = !removeMode; removeBtn.textContent = `Remove mode: ${removeMode ? 'ON' : 'off'}`; removeBtn.classList.toggle('btn-warn', removeMode); removeBtn.setAttribute('aria-pressed', String(removeMode)); felt.classList.toggle('removing', removeMode); });

  const d1Sel = diceSelect(), d2Sel = diceSelect();
  const fixedBtn = h('button', { class: 'btn btn-small', text: 'Roll these', title: 'Roll a specific combination (for learning)' });

  const stratSel = h('select', { attrs: { 'aria-label': 'Auto-bet strategy' } });
  const fillStrats = () => {
    clear(stratSel).append(h('option', { value: '', text: 'Manual betting' }));
    for (const s of store.strategies) stratSel.append(h('option', { value: s.id, text: s.name, selected: s.id === autoStrategyId }));
  };
  fillStrats();
  stratSel.addEventListener('change', () => {
    autoStrategyId = stratSel.value;
    const s = store.getStrategy(autoStrategyId);
    executor = s ? new StrategyExecutor(s, sess.rules) : null;
    if (executor) { executor.beforeRoll(sess); render(); toast(`“${s.name}” is now placing bets before each roll.`, 'info'); }
  });
  let autoCount = 50;
  const speedSel = h('select', { attrs: { 'aria-label': 'Auto-roll speed' } },
    h('option', { value: '700', text: 'Watch (slow)' }), h('option', { value: '250', text: 'Normal', selected: true }), h('option', { value: '30', text: 'Fast' }), h('option', { value: '0', text: 'Instant' }));
  const autoBtn = h('button', { class: 'btn btn-small', text: 'Auto-roll' });

  const resetInput = numberInput(store.liveBankroll, (v) => { store.liveBankroll = Math.max(1, v); store.save(); }, { min: 1, step: 100 });
  const resetBtn = h('button', { class: 'btn btn-small btn-ghost', text: 'New session' });

  const historyEl = h('div', { class: 'roll-history', attrs: { 'aria-label': 'Recent rolls' } });
  const logEl = h('ol', { class: 'event-log' });
  const freqBox = h('div', { class: 'chart' });
  const trailBox = h('div', { class: 'chart' });
  const statsEl = h('div', { class: 'stat-list' });

  root.append(h('div', { class: 'live-layout' },
    h('div', { class: 'live-main' },
      felt,
      h('p', { class: 'field-hint', text: 'Click a spot to bet the selected chip. Right-click (or use Remove mode) to take a bet down. Click Pass/Don\'t Pass or a Come number again after the point is set to add odds. Contract bets (Pass/Come once a point is set) cannot be removed.' }),
      h('div', { class: 'chart-grid inner' },
        h('div', { class: 'card chart-card' }, h('h4', {}, 'Numbers rolled this session', info('Bars: share of your rolls that landed on each sum. White ticks: exact probability.')), freqBox),
        h('div', { class: 'card chart-card' }, h('h4', { text: 'Bankroll' }), trailBox))),
    h('aside', { class: 'live-side' },
      h('section', { class: 'card dice-card' },
        h('div', { class: 'dice-row' }, die1.el, die2.el),
        callout, rollBtn,
        h('div', { class: 'fixed-row' }, h('span', { class: 'muted', text: 'Set dice:' }), d1Sel, d2Sel, fixedBtn),
        historyEl),
      h('section', { class: 'card' },
        h('div', { class: 'bank-row' },
          h('div', {}, h('span', { class: 'muted', text: 'Rack' }), bankEl),
          h('div', {}, h('span', { class: 'muted', text: 'On table' }), tableEl),
          h('div', {}, h('span', { class: 'muted', text: 'Session net' }), netEl)),
        h('div', { class: 'sub-label', text: 'Chip' }), chipRow,
        h('div', { class: 'sub-label', text: 'Box numbers bet as' }), modeRow,
        h('div', { class: 'btn-row' }, removeBtn, h('button', { class: 'btn btn-small btn-ghost', text: 'Take down all', on: { click: takeDownAll } }))),
      h('section', { class: 'card' },
        h('h4', {}, 'Auto-play a strategy', info('Pick one of your saved strategies and it will place bets for you before every roll — the exact same logic the Monte Carlo simulator uses.')),
        stratSel,
        h('div', { class: 'btn-row' },
          numberInput(autoCount, (v) => { autoCount = Math.max(1, Math.floor(v)); }, { min: 1, step: 10, width: '5.5em' }),
          h('span', { class: 'muted', text: 'rolls' }), speedSel, autoBtn)),
      h('section', { class: 'card' }, h('h4', { text: 'Session stats' }), statsEl),
      h('section', { class: 'card' },
        h('h4', { text: 'Table log' }), logEl,
        h('div', { class: 'btn-row' }, h('span', { class: 'muted', text: 'Bankroll' }), resetInput, resetBtn)))));

  // ---------------------------------------------------------------------------
  // Betting
  // ---------------------------------------------------------------------------
  const lineBet = (type) => sess.table.bets.find((b) => b.type === type);
  const flash = (msg, kind = 'warn') => toast(msg, kind, 2600);

  /** Place a chip; if a brand-new bet is under the table minimum, bet the minimum instead (like stacking chips). */
  function placeChip(type, n) {
    let r = sess.place(type, n, chip);
    if (!r.ok && !sess.findMergeTarget(type, n)) {
      const min = minimumFor(type, n, sess.rules);
      if (chip < min) {
        r = sess.place(type, n, min);
        if (r.ok) flash(`Raised to the ${money(min)} minimum for ${labelFor(type, n)}.`, 'info');
      }
    }
    if (!r.ok) flash(r.error);
    return r;
  }

  function handleSpot(id, remove) {
    const t = sess.table;
    let m;
    const addOddsTo = (bet) => {
      const r = sess.addOdds(bet, chip, { clamp: true });
      if (!r.ok) flash(r.error); else if (r.amount < chip) flash(`Odds capped at the ${store.rules.oddsLimit} limit.`, 'info');
    };
    if (remove) return removeAt(id);
    if (id === 'pass' || id === 'dontPass') {
      const b = lineBet(id);
      if (b && b.point !== null) return addOddsTo(b), render();
      placeChip(id, undefined);
    } else if (id === 'passOdds' || id === 'dontPassOdds') {
      const b = lineBet(id === 'passOdds' ? 'pass' : 'dontPass');
      if (!b) flash(`Make a ${id === 'passOdds' ? 'Pass Line' : "Don't Pass"} bet first.`);
      else addOddsTo(b);
    } else if (id === 'come' || id === 'dontCome') {
      placeChip(id, undefined);
    } else if ((m = /^num-(\d+)$/.exec(id))) {
      placeChip(numberMode, +m[1]);
    } else if ((m = /^come-(\d+)$/.exec(id))) {
      const n = +m[1];
      const bets = t.bets.filter((b) => b.type === 'come' && b.point === n);
      if (!bets.length) flash(`No Come bet on ${n} yet. Bet the COME box; it travels to the next number rolled.`);
      else addOddsTo(bets.find((b) => b.odds < sess.maxOddsFor(b)) || bets[0]);
    } else if ((m = /^dc-(\d+)$/.exec(id))) {
      const n = +m[1];
      const bets = t.bets.filter((b) => b.type === 'dontCome' && b.point === n);
      if (!bets.length) flash(`No Don't Come bet on ${n} yet.`);
      else addOddsTo(bets.find((b) => b.odds < sess.maxOddsFor(b)) || bets[0]);
    } else if ((m = /^(hard|big)(\d+)$/.exec(id))) {
      placeChip(m[1], +m[2]);
    } else {
      placeChip(id, undefined);
    }
    render();
  }

  function removeAt(id) {
    const t = sess.table;
    let m, back = 0;
    const take = (b) => { if (b) back += sess.takeDown(b); };
    if (id === 'pass' || id === 'passOdds') { const b = lineBet('pass'); if (b) back += sess.removeOdds(b); if (id === 'pass' && b && b.point === null) { t.removeBet(b); sess.bankroll += b.amount; back += b.amount; } }
    else if (id === 'dontPass') take(lineBet('dontPass'));
    else if (id === 'dontPassOdds') { const b = lineBet('dontPass'); if (b) back += sess.removeOdds(b); }
    else if (id === 'come') { const b = t.bets.find((x) => x.type === 'come' && x.point === null); if (b) { t.removeBet(b); sess.bankroll += b.amount; back += b.amount; } }
    else if (id === 'dontCome') { const b = t.bets.find((x) => x.type === 'dontCome' && x.point === null); take(b); }
    else if ((m = /^num-(\d+)$/.exec(id))) for (const b of t.bets.filter((x) => ['place', 'buy', 'lay'].includes(x.type) && x.number === +m[1])) take(b);
    else if ((m = /^come-(\d+)$/.exec(id))) for (const b of t.bets.filter((x) => x.type === 'come' && x.point === +m[1])) back += sess.removeOdds(b);
    else if ((m = /^dc-(\d+)$/.exec(id))) for (const b of t.bets.filter((x) => x.type === 'dontCome' && x.point === +m[1])) back += b.odds > 0 ? sess.removeOdds(b) : sess.takeDown(b);
    else if ((m = /^(hard|big)(\d+)$/.exec(id))) take(t.find(m[1], +m[2]));
    else take(t.find(id));
    if (!back) flash('Nothing removable there (Pass and Come bets with a point are contract bets).', 'info');
    render();
  }

  function takeDownAll() {
    let back = 0;
    for (const b of [...sess.table.bets]) {
      if ((b.type === 'pass' || b.type === 'come') && b.point === null) { sess.table.removeBet(b); sess.bankroll += b.amount; back += b.amount; continue; }
      back += sess.removeOdds(b);
      if (['place', 'buy', 'lay', 'hard', 'big', 'field', ...Object.keys(PROPS)].includes(b.type)) back += sess.takeDown(b);
    }
    toast(`Returned ${money(back)} to your rack.`, 'info');
    render();
  }

  felt.addEventListener('click', (e) => {
    const sp = e.target.closest('[data-spot]');
    if (sp) handleSpot(sp.dataset.spot, removeMode);
  });
  felt.addEventListener('contextmenu', (e) => {
    const sp = e.target.closest('[data-spot]');
    if (sp) { e.preventDefault(); handleSpot(sp.dataset.spot, true); }
  });

  // ---------------------------------------------------------------------------
  // Rolling
  // ---------------------------------------------------------------------------
  let rolling = false;
  async function doRoll(fixed, animate = true) {
    if (rolling) return;
    rolling = true;
    rollBtn.disabled = true;
    const d1 = fixed ? fixed[0] : cryptoDie();
    const d2 = fixed ? fixed[1] : cryptoDie();
    if (animate) {
      die1.el.classList.add('rolling'); die2.el.classList.add('rolling');
      for (let i = 0; i < 6; i++) { die1.set(1 + Math.floor(Math.random() * 6)); die2.set(1 + Math.floor(Math.random() * 6)); await wait(60); }
      die1.el.classList.remove('rolling'); die2.el.classList.remove('rolling');
    }
    die1.set(d1); die2.set(d2);
    const before = sess.equity;
    const res = sess.roll(d1, d2);
    if (executor) executor.afterRoll(sess, res);
    const delta = sess.equity - before;
    record(res, delta);
    if (executor) executor.beforeRoll(sess);
    rolling = false;
    rollBtn.disabled = false;
    render();
    return res;
  }

  function record(res, delta) {
    freq[res.sum]++;
    history.unshift(res.sum); if (history.length > 24) history.pop();
    bankrollTrail.push(sess.equity); if (bankrollTrail.length > 2000) bankrollTrail.shift();
    stats.hand++;
    if (res.gameOver) stats.games++;
    if (res.pointMade) stats.pointsMade++;
    if (res.sevenOut) { stats.sevenOuts++; stats.longestHand = Math.max(stats.longestHand, stats.hand); stats.hand = 0; }
    stats.bestRoll = Math.max(stats.bestRoll, delta);
    stats.worstRoll = Math.min(stats.worstRoll, delta);

    let call;
    if (res.wasComeOut) {
      if (res.pointEstablished) call = `Point is ${res.sum}`;
      else if (res.natural) call = res.sum === 7 ? 'Seven — winner on the come-out!' : 'Yo-leven — front line winner!';
      else call = CALLS[res.sum] || `Craps ${res.sum}`;
    } else if (res.pointMade) call = `${res.sum} — point made! Winner!`;
    else if (res.sevenOut) call = 'Seven out — line away';
    else if (sess.rules.game === 'crapless' && NICKNAMES[res.sum]) call = `${NICKNAMES[res.sum]} (${res.sum})`;
    else call = CALLS[res.sum] || (res.hard && [4, 6, 8, 10].includes(res.sum) ? `Hard ${res.sum}` : `${res.sum}${[4, 6, 8, 10].includes(res.sum) ? ' the easy way' : ''}`);
    callout.textContent = `${res.d1} + ${res.d2} = ${res.sum} · ${call}`;
    callout.className = `callout ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`;

    const lines = [];
    for (const ev of res.events) {
      const name = keyLabel(ev.key);
      if (ev.outcome === 'win') lines.push({ kind: 'good', text: `${name} wins ${money(ev.net, { decimals: ev.net % 1 ? 2 : 0 })}` });
      else if (ev.outcome === 'lose') lines.push({ kind: 'bad', text: `${name} loses ${money(-ev.net, { decimals: ev.net % 1 ? 2 : 0 })}` });
      else if (ev.outcome === 'push') lines.push({ kind: 'info', text: `${name} pushes (bar 12)` });
      else if (ev.outcome === 'return') lines.push({ kind: 'info', text: `${name} were off — returned ${money(ev.amount)}` });
      else if (ev.outcome === 'move') lines.push({ kind: 'info', text: `${name} moves to ${ev.number}` });
    }
    log.unshift({ roll: res.sum, d: `${res.d1}-${res.d2}`, call, lines, delta });
    if (log.length > 60) log.pop();
  }

  rollBtn.addEventListener('click', () => doRoll());
  fixedBtn.addEventListener('click', () => doRoll([+d1Sel.value, +d2Sel.value]));
  autoBtn.addEventListener('click', async () => {
    if (autoTimer) { autoTimer.stop = true; return; }
    const ctl = autoTimer = { stop: false };
    autoBtn.textContent = 'Stop';
    const delay = +speedSel.value;
    for (let i = 0; i < autoCount && !ctl.stop; i++) {
      if (!sess.table.bets.length && executor && sess.bankroll < executor.minRequired()) { toast('Busted — the bankroll can no longer cover the strategy\'s bets.', 'bad'); break; }
      await doRoll(null, delay >= 250);
      if (delay) await wait(delay); else if (i % 20 === 0) await wait(0);
    }
    autoTimer = null;
    autoBtn.textContent = 'Auto-roll';
  });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || root.hidden || root.closest('[hidden]')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) return;
    e.preventDefault();
    doRoll();
  });

  resetBtn.addEventListener('click', () => {
    if (autoTimer) autoTimer.stop = true;
    sess = new PlayerSession(store.rules, store.liveBankroll);
    applyRulesToFelt();
    if (autoStrategyId) { const s = store.getStrategy(autoStrategyId); executor = s ? new StrategyExecutor(s, sess.rules) : null; }
    history.length = 0; log.length = 0; freq.fill(0); bankrollTrail.length = 0; bankrollTrail.push(sess.bankroll);
    Object.assign(stats, { games: 0, pointsMade: 0, sevenOuts: 0, hand: 0, longestHand: 0, bestRoll: 0, worstRoll: 0 });
    callout.textContent = 'New session — place your bets'; callout.className = 'callout';
    if (executor) executor.beforeRoll(sess);
    render();
  });

  store.on('strategies', fillStrats);
  function applyRulesToFelt() {
    drawFieldNumbers();
    felt.classList.toggle('crapless', store.rules.game === 'crapless');
  }
  store.on('rules', () => {
    if (sess.table.bets.length) { toast('New table rules apply after you start a new session (bets are on the table).', 'info'); return; }
    sess = new PlayerSession(store.rules, sess.bankroll);
    applyRulesToFelt();
    render();
  });

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  let raf = 0;
  function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }

  function draw() {
    const t = sess.table;
    // chips on spots
    const amounts = new Map();
    const addAmt = (id, amt, tag) => { const a = amounts.get(id) || []; a.push({ amt, tag }); amounts.set(id, a); };
    for (const b of t.bets) {
      switch (b.type) {
        case 'pass': addAmt('pass', b.amount); if (b.odds) addAmt('passOdds', b.odds); break;
        case 'dontPass': addAmt('dontPass', b.amount); if (b.odds) addAmt('dontPassOdds', b.odds); break;
        case 'come': if (b.point === null) addAmt('come', b.amount); else { addAmt(`come-${b.point}`, b.amount); if (b.odds) addAmt(`come-${b.point}`, b.odds, t.isComeOut && !store.rules.comeOddsWorkingOnComeOut ? 'odds off' : 'odds'); } break;
        case 'dontCome': if (b.point === null) addAmt('dontCome', b.amount); else { addAmt(`dc-${b.point}`, b.amount); if (b.odds) addAmt(`dc-${b.point}`, b.odds, 'lay'); } break;
        case 'place': case 'buy': case 'lay': addAmt(`num-${b.number}`, b.amount, `${b.type === 'place' ? 'P' : b.type === 'buy' ? 'B' : 'L'}${t.isComeOut && !store.rules.placeWorkingOnComeOut ? ' off' : ''}`); break;
        case 'hard': addAmt(`hard${b.number}`, b.amount, t.isComeOut && !store.rules.hardWorkingOnComeOut ? 'off' : ''); break;
        case 'big': addAmt(`big${b.number}`, b.amount); break;
        default: addAmt(b.type, b.amount);
      }
    }
    for (const el of felt.querySelectorAll('[data-spot]')) {
      const holder = el.querySelector('.spot-chips');
      clear(holder);
      const list = amounts.get(el.dataset.spot);
      el.classList.toggle('has-bet', !!list);
      if (list) for (const c of list) holder.append(chipEl(c.amt, c.tag));
    }
    for (const box of numbers.children) {
      const on = t.point === +box.dataset.n;
      box.classList.toggle('is-point', on);
      box.querySelector('.puck').hidden = !on;
    }
    felt.classList.toggle('come-out', t.isComeOut);
    bankEl.textContent = money(sess.bankroll, { decimals: sess.bankroll % 1 ? 2 : 0 });
    tableEl.textContent = money(sess.onTable);
    const net = sess.net;
    netEl.textContent = money(net, { sign: true, decimals: net % 1 ? 2 : 0 });
    netEl.className = `tnum ${net > 0 ? 'good' : net < 0 ? 'bad' : ''}`;
    if (!rolling && !autoTimer) callout.dataset.state = t.isComeOut ? 'comeout' : 'point';

    clear(historyEl).append(...history.map((s, i) => h('span', { class: `hist-roll ${s === 7 ? 'seven' : [2, 3, 12].includes(s) ? 'craps' : ''} ${i === 0 ? 'latest' : ''}`, text: String(s) })));

    clear(logEl).append(...log.slice(0, 25).map((l) => h('li', {},
      h('div', { class: 'log-head' }, h('span', { class: 'log-roll', text: String(l.roll) }), h('span', { text: l.call }), l.delta ? h('span', { class: `log-delta ${l.delta > 0 ? 'good' : 'bad'}`, text: money(l.delta, { sign: true, decimals: l.delta % 1 ? 2 : 0 }) }) : null),
      l.lines.length ? h('ul', {}, l.lines.map((x) => h('li', { class: `log-${x.kind}`, text: x.text }))) : null)));

    const rolls = sess.rolls;
    clear(statsEl).append(...[
      ['Rolls', String(rolls)],
      ['Games (line decisions)', String(stats.games)],
      ['Points made / seven-outs', `${stats.pointsMade} / ${stats.sevenOuts}`],
      ['Current hand', `${stats.hand} rolls (longest ${Math.max(stats.longestHand, stats.hand)})`],
      ['Total wagered', money(sess.action)],
      ['Expected result of bets made', money(sess.expected, { decimals: 2 })],
      ['Actual result', money(net, { decimals: 2, sign: true })],
      ['Luck (actual − expected)', money(net - sess.expected, { decimals: 2, sign: true })],
      ['Best / worst roll', `${money(stats.bestRoll, { sign: true })} / ${money(stats.worstRoll)}`],
      ['Sevens rolled', `${freq[7]} (${rolls ? pct(freq[7] / rolls) : '—'} vs 16.7%)`],
    ].map(([k, v]) => h('div', { class: 'stat-row' }, h('span', { text: k }), h('strong', { class: 'tnum', text: v }))));

    const cats = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    mount(freqBox, columns({ categories: cats, values: cats.map((c) => (rolls ? freq[c] / rolls : 0)), expected: cats.map((c) => WAYS[c] / 36), yFormat: (v) => `${Math.round(v * 100)}%`, tipFormat: (v) => `${(v * 100).toFixed(1)}%`, catLabel: 'Sum ', height: 200, extraTip: (i) => [{ value: String(freq[cats[i]]), label: 'times rolled' }] }));
    const xs = bankrollTrail.map((_, i) => i);
    mount(trailBox, lineChart({ series: [{ name: 'Bankroll (rack + table)', color: '#3987e5', x: xs.length > 1 ? xs : [0, 1], y: bankrollTrail.length > 1 ? [...bankrollTrail] : [bankrollTrail[0], bankrollTrail[0]] }], refY: sess.startBankroll, refLabel: 'start', yFormat: (v) => money(v, { compact: true }), xFormat: (v) => `${Math.round(v)}`, xTipLabel: 'Roll ', xTitle: 'Rolls', height: 200 }));
  }

  render();
}

function placeSub(n) {
  return { 2: '11:2', 3: '11:4', 4: '9:5', 5: '7:5', 6: '7:6', 8: '7:6', 9: '7:5', 10: '9:5', 11: '11:4', 12: '11:2' }[n];
}

/** Two tiny dice drawn with CSS pips (unicode die glyphs render inconsistently across fonts). */
function miniDice(a, b) {
  const die = (v) => h('span', { class: 'mini-die' }, ...Array.from({ length: 9 }, (_, i) => h('span', { class: PIPS[v].includes(i + 1) ? 'on' : '' })));
  return h('span', { class: 'mini-dice', attrs: { 'aria-hidden': 'true' } }, die(a), die(b));
}

function dieEl() {
  const el = h('div', { class: 'die', attrs: { role: 'img', 'aria-label': 'Die showing 1' } });
  for (let i = 1; i <= 9; i++) el.append(h('span', { class: 'pip', dataset: { i } }));
  const set = (v) => {
    el.dataset.value = v;
    el.setAttribute('aria-label', `Die showing ${v}`);
    for (const p of el.children) p.classList.toggle('on', PIPS[v].includes(+p.dataset.i));
  };
  set(1);
  return { el, set };
}

function chipEl(amount, tag) {
  const denom = amount >= 1000 ? 1000 : amount >= 500 ? 500 : amount >= 100 ? 100 : amount >= 25 ? 25 : amount >= 5 ? 5 : 1;
  const label = amount >= 10000 ? `${Math.round(amount / 1000)}K` : amount >= 1000 ? `${(amount / 1000).toFixed(amount % 1000 ? 1 : 0)}K` : String(Math.round(amount * 100) / 100);
  return h('span', { class: `chip-stack chip-${denom}`, title: `${money(amount, { decimals: amount % 1 ? 2 : 0 })}${tag ? ` (${tag})` : ''}` },
    h('span', { class: 'chip-face', text: label }), tag ? h('span', { class: 'chip-tag', text: tag }) : null);
}

function diceSelect() {
  return h('select', { class: 'dice-select', attrs: { 'aria-label': 'Die value' } }, [1, 2, 3, 4, 5, 6].map((v) => h('option', { value: String(v), text: String(v) })));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export { labelFor };
