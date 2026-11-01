// Strategy Explorer: generate permutations of bets, simulate all of them, rank, and show
// which individual choices (odds or no odds? place bets? progression?) actually matter.

import { h, clear, field, numberInput, money, pct, num, toast, info, select, formatValue } from './dom.js';
import { store } from './state.js';
import { runner } from './simPage.js';
import { DIMENSIONS, defaultSelections, generatePermutations, countRaw } from '../engine/permutations.js';
import { analyze } from '../engine/analysis.js';
import { OBJECTIVES, mean } from '../engine/stats.js';
import { THEORY } from '../engine/stats.js';
import { scatter, hbars, mount } from './charts.js';
import { newId } from '../engine/strategy.js';

const FRONTIER = '#3987e5', DOMINATED = '#898781';

export function mountExplorer(root) {
  const sel = defaultSelections();
  let trials = 1000;
  const countEl = h('p', { class: 'explorer-count' });
  const out = h('div', { class: 'results' });
  const runBtn = h('button', { class: 'btn btn-primary', text: 'Explore permutations' });
  const cancelBtn = h('button', { class: 'btn btn-ghost', text: 'Cancel', hidden: true, on: { click: () => runner.cancel() } });
  const progress = h('div', { class: 'progress', hidden: true }, h('div', { class: 'progress-bar' }), h('span', { class: 'progress-text' }));

  const updateCount = () => {
    const { strategies, duplicates } = generatePermutations(sel, store.rules.tableMin, 5000);
    const s = store.session;
    const rolls = strategies.length * trials * s.games * THEORY.rollsPerGame;
    countEl.textContent = `${countRaw(sel).toLocaleString()} combinations → ${strategies.length.toLocaleString()} unique strategies (${duplicates} duplicates removed). ≈ ${num(rolls / 1e6, 0)}M rolls, est. ${Math.ceil(rolls / (2.2e6 * runner.size))}s.`;
    return strategies;
  };

  const dimsEl = h('div', { class: 'dims' }, DIMENSIONS.map((d) => h('div', { class: 'dim' },
    h('div', { class: 'dim-label', text: d.label }),
    h('div', { class: 'chips' }, d.options.map((o) => {
      const on = () => sel[d.key].some((v) => String(v) === String(o.id));
      const b = h('button', { class: `chip ${on() ? 'on' : ''}`, attrs: { 'aria-pressed': String(on()) }, text: o.label });
      b.addEventListener('click', () => {
        if (on()) { if (sel[d.key].length > 1) sel[d.key] = sel[d.key].filter((v) => String(v) !== String(o.id)); }
        else sel[d.key].push(o.id);
        b.classList.toggle('on', on()); b.setAttribute('aria-pressed', String(on()));
        updateCount();
      });
      return b;
    })))));

  runBtn.addEventListener('click', async () => {
    const strategies = updateCount();
    if (strategies.length > 1500) { toast('Too many combinations (max 1,500). Deselect some options.', 'warn'); return; }
    runBtn.disabled = true; cancelBtn.hidden = false; progress.hidden = false;
    out.classList.add('stale');
    const t0 = performance.now();
    try {
      const session = { ...store.session, trials };
      const merged = await runner.run({ strategies, rules: store.rules, session, collectPaths: false }, (f) => {
        progress.firstChild.style.width = `${(f * 100).toFixed(1)}%`;
        progress.lastChild.textContent = `${(f * 100).toFixed(0)}%`;
      });
      const A = analyze(merged, strategies, session, store.rules);
      renderExplorerResults(out, A, strategies);
      toast(`Explored ${strategies.length} strategies in ${((performance.now() - t0) / 1000).toFixed(1)}s`, 'good');
    } catch (e) {
      if (e.message !== 'cancelled') { console.error(e); toast(`Explorer failed: ${e.message}`, 'bad'); }
    } finally {
      runBtn.disabled = false; cancelBtn.hidden = true; progress.hidden = true; out.classList.remove('stale');
    }
  });

  root.append(
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Strategy Explorer', info('Builds every combination of the options you select (one table-minimum unit per bet), simulates each one on identical dice, and ranks them. Use it to discover which mixes of bets give the best risk/reward, then send the winners to the Simulator for a deep dive.'))),
      h('p', { class: 'card-sub', text: `Bankroll, games per session, stop rules and seed come from the Simulator's session settings (${money(store.session.bankroll)}, ${store.session.games} games). Bet unit = table minimum (${money(store.rules.tableMin)}).` }),
      dimsEl,
      h('div', { class: 'explorer-run' },
        field('Sessions per strategy', numberInput(trials, (v) => { trials = Math.max(50, Math.floor(v)); updateCount(); }, { min: 50, step: 500 }), 'Lower = faster; 1,000+ recommended'),
        h('div', { class: 'run-row' }, runBtn, cancelBtn)),
      countEl, progress),
    out);
  updateCount();
  store.on('session', updateCount);
  store.on('rules', updateCount);
}

function renderExplorerResults(root, A, strategies) {
  clear(root);
  const S = A.summaries;
  let objective = 'balanced';
  let shown = 25;
  const tableWrap = h('div', { class: 'table-wrap' });
  const objSel = select(Object.entries(OBJECTIVES).map(([value, o]) => ({ value, label: o.label })), objective, (v) => { objective = v; shown = 25; drawTable(); });
  const more = h('button', { class: 'btn btn-small btn-ghost', text: 'Show more' });
  more.addEventListener('click', () => { shown += 50; drawTable(); });

  const ranked = () => { const o = OBJECTIVES[objective]; return [...S].sort((a, b) => o.dir * (b[o.key] - a[o.key])); };
  const addToSim = (s) => {
    const st = strategies[s.index];
    const { choice, ...clean } = st;
    store.upsertStrategy({ ...JSON.parse(JSON.stringify(clean)), id: newId(), colorSlot: null });
  };

  function drawTable() {
    const o = OBJECTIVES[objective];
    const rows = ranked().slice(0, shown);
    clear(tableWrap).append(h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, ['#', 'Strategy', o.label.split('(')[0].trim(), 'Expected', 'Simulated avg', 'P(ahead)', 'Ruin', 'Worst 5%', 'Edge', 'Score', ''].map((t, i) => h('th', { class: i > 1 ? 'num' : '', text: t })))),
      h('tbody', {}, rows.map((s, i) => h('tr', {},
        h('td', { class: 'num muted', text: String(i + 1) }),
        h('td', {}, h('div', { class: 'strat-name' }, h('span', { text: s.name }), s.onFrontier ? h('span', { class: 'badge', text: 'frontier' }) : null)),
        h('td', { class: 'num strong', text: formatValue(s[o.key], o.fmt) }),
        h('td', { class: 'num', text: money(s.expectedNet) }),
        h('td', { class: `num muted`, text: `${money(s.mean)} ±${money(s.ci95)}` }),
        h('td', { class: 'num', text: pct(s.pProfit) }),
        h('td', { class: 'num', text: pct(s.pRuin) }),
        h('td', { class: 'num', text: money(s.cvar5) }),
        h('td', { class: 'num', text: pct(s.edgeTheory, 2) }),
        h('td', { class: 'num', text: num(s.score, 1) }),
        h('td', {}, h('button', { class: 'btn btn-small', title: 'Add to my strategies', text: '+ Add', on: { click: (e) => { addToSim(s); e.target.disabled = true; e.target.textContent = 'Added'; } } })))))));
    more.hidden = shown >= S.length;
  }
  drawTable();

  const top5 = h('button', { class: 'btn btn-small', text: 'Send top 5 to Simulator' });
  top5.addEventListener('click', () => {
    for (const s of ranked().slice(0, 5)) addToSim(s);
    toast('Added the top 5 to your strategy list (Simulator tab).', 'good');
  });

  const best = ranked()[0];
  const scatterBox = h('div', { class: 'chart' });
  root.append(
    h('section', { class: 'tiles' },
      tile('Strategies explored', S.length.toLocaleString(), `${A.trials.toLocaleString()} sessions each`),
      tile('Top pick', best.name, `${money(best.expectedNet)} expected · ${pct(best.pProfit)} ahead`),
      tile('On the efficient frontier', String(S.filter((s) => s.onFrontier).length), 'not beaten on both mean and volatility'),
      tile('Lowest edge found', pct(Math.min(...S.map((s) => s.edgeTheory)), 2), 'exact, per dollar wagered')),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', { text: 'Leaderboard' }),
        h('div', { class: 'card-tools' }, h('label', { class: 'inline-field' }, h('span', { text: 'Rank by' }), objSel), top5)),
      tableWrap, more),
    h('section', { class: 'card' },
      h('h3', {}, 'Risk vs. reward map', info('Every dot is one strategy. Blue dots form the efficient frontier: for their level of volatility, nothing has a better expected result. Gray dots are dominated.')),
      h('div', { class: 'legend' },
        h('span', { class: 'legend-item' }, h('span', { class: 'legend-key legend-key-dot', style: { background: FRONTIER } }), h('span', { text: 'Efficient frontier' })),
        h('span', { class: 'legend-item' }, h('span', { class: 'legend-key legend-key-dot', style: { background: DOMINATED } }), h('span', { text: 'Dominated' }))),
      scatterBox));
  mount(scatterBox, scatter({
    points: S.map((s) => ({ x: s.sd, y: s.expectedNet, label: s.name, color: s.onFrontier ? FRONTIER : DOMINATED, emph: s.onFrontier, tip: [{ label: 'chance ahead', value: pct(s.pProfit) }, { label: 'risk of ruin', value: pct(s.pRuin) }] })),
    frontier: S.map((s, i) => (s.onFrontier ? i : -1)).filter((i) => i >= 0),
    xTitle: 'Volatility (std. dev. of session result)', yTitle: 'Expected result per session', xFormat: (v) => money(v, { compact: true }), yFormat: (v) => money(v, { compact: true }), height: 380,
  }));

  // Marginal impact of each choice.
  const impact = h('div', { class: 'chart-grid' });
  root.append(h('section', { class: 'card' },
    h('h3', {}, 'What each choice does', info('For each option, the average across every explored strategy that used it. This isolates the effect of one decision (e.g. taking odds) while averaging over all other choices.')),
    h('p', { class: 'card-sub', text: 'Expected result per session for strategies using each option (hover for chance to finish ahead and risk of ruin).' }),
    impact));
  for (const d of DIMENSIONS) {
    const groups = new Map();
    S.forEach((s) => {
      const c = strategies[s.index].choice;
      if (!c) return;
      const v = String(c[d.key]);
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v).push(s);
    });
    if (groups.size < 2) continue;
    const items = [...groups.entries()].map(([v, arr]) => {
      const opt = d.options.find((o) => String(o.id) === v);
      return { label: opt ? opt.label : v, value: mean(arr.map((s) => s.expectedNet)), color: '#3987e5', tip: [{ label: 'avg chance ahead', value: pct(mean(arr.map((s) => s.pProfit))) }, { label: 'avg risk of ruin', value: pct(mean(arr.map((s) => s.pRuin))) }, { label: 'strategies', value: String(arr.length) }] };
    });
    const box = h('div', { class: 'chart' });
    impact.append(h('div', { class: 'card chart-card' }, h('h4', { text: d.label }), box));
    mount(box, hbars({ items, format: (v) => money(v), valueLabel: 'Avg result' }));
  }
}

function tile(label, value, sub) {
  return h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: label }), h('div', { class: 'tile-value small', text: value }), h('div', { class: 'tile-sub', text: sub }));
}
