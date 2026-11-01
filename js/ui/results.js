// Results dashboard for a strategy comparison run.

import { h, clear, money, pct, num, info, select, download, formatValue } from './dom.js';
import { colorFor, SERIES_COLORS } from './state.js';
import { lineChart, histogram, hbars, columns, scatter, mount, legend } from './charts.js';
import { sharedHistogram } from '../engine/stats.js';
import { OBJECTIVES } from '../engine/stats.js';
import { WAYS } from '../engine/constants.js';

const fmtMoney = (v) => money(v, { compact: true });

/** Column definitions for the ranking table. */
const COLUMNS = [
  { key: 'score', label: 'Score', fmt: 'score', dir: 1, tip: 'Balanced 0–100 score: weighted percentile rank on average result (25%), chance to finish ahead (25%), risk of ruin (20%), worst-5% average (20%) and house edge (10%) — relative to the strategies in this run.' },
  { key: 'expectedNet', label: 'Expected', fmt: 'money', dir: 1, tip: 'Exact expected result per session: the house edge of every bet the strategy actually made, summed. No sampling noise.' },
  { key: 'mean', label: 'Simulated avg', fmt: 'money', dir: 1, tip: 'Mean net win/loss across the simulated sessions, with its 95% confidence interval. Converges to "Expected" as sessions increase.' },
  { key: 'median', label: 'Median', fmt: 'money', dir: 1, tip: 'The typical session: half did better, half did worse.' },
  { key: 'pProfit', label: 'P(ahead)', fmt: 'pct', dir: 1, tip: 'Share of sessions that ended with a profit.' },
  { key: 'pRuin', label: 'Risk of ruin', fmt: 'pct', dir: -1, tip: 'Share of sessions where the bankroll fell below the smallest bet the strategy needs.' },
  { key: 'pGoal', label: 'P(goal)', fmt: 'pct', dir: 1, tip: 'Share of sessions that reached the win goal.', when: (s) => s.winGoal > 0 },
  { key: 'cvar5', label: 'Worst 5%', fmt: 'money', dir: 1, tip: 'CVaR 5%: the average result of the worst 5% of sessions — your "bad day".' },
  { key: 'p95', label: 'Best 5%', fmt: 'money', dir: 1, tip: '95th percentile: only 5% of sessions did better than this — the realistic upside.' },
  { key: 'sd', label: 'Volatility', fmt: 'money', dir: -1, tip: 'Standard deviation of session results — how wide the swings are.' },
  { key: 'avgMaxDrawdown', label: 'Avg drawdown', fmt: 'money', dir: -1, tip: 'Average largest peak-to-trough drop within a session.' },
  { key: 'edgeObserved', label: 'Edge (sim)', fmt: 'pctEdge', dir: -1, tip: 'Simulated house edge: total lost ÷ total wagered.' },
  { key: 'edgeTheory', label: 'Edge (theory)', fmt: 'pctEdge', dir: -1, tip: 'Exact house edge of the bets actually made, from the probability math.' },
  { key: 'avgAction', label: 'Wagered', fmt: 'money', dir: 1, tip: 'Average total action (dollars that reached a decision) per session.' },
  { key: 'lossPerHour', label: 'Cost / hr', fmt: 'money', dir: -1, tip: 'Expected loss per hour of play at the configured rolls/hour.' },
  { key: 'avgRolls', label: 'Rolls', fmt: 'num0', dir: 1, tip: 'Average rolls per session (shorter if the session busted or hit a stop rule).' },
];

export function renderResults(root, analysis, strategies) {
  clear(root);
  const A = analysis;
  const S = A.summaries;
  const byIndex = (i) => strategies[i];
  const color = (s) => colorFor(s.colorSlot);

  // ---- Headline tiles
  const pick = (key, dir) => [...S].sort((a, b) => dir * (b[key] - a[key]))[0];
  const tiles = [
    { label: 'Best overall', s: pick('score', 1), value: (s) => `Score ${num(s.score, 1)}`, sub: (s) => `${money(s.expectedNet)} expected · ${pct(s.pProfit)} ahead` },
    { label: 'Most likely to finish ahead', s: pick('pProfit', 1), value: (s) => pct(s.pProfit), sub: (s) => `worst 5%: ${money(s.cvar5)}` },
    { label: 'Lowest risk of ruin', s: pick('pRuin', -1), value: (s) => pct(s.pRuin, 2), sub: (s) => `volatility ${money(s.sd)}` },
    { label: 'Lowest house edge', s: pick('edgeTheory', -1), value: (s) => pct(s.edgeTheory, 2), sub: (s) => `${money(s.theoryLossPerHour)}/hr expected cost` },
    { label: 'Biggest upside', s: pick('p95', 1), value: (s) => money(s.p95, { sign: true }), sub: (s) => '95th-percentile session' },
  ];
  root.append(h('section', { class: 'tiles' }, tiles.map((t) => h('div', { class: 'tile' },
    h('div', { class: 'tile-label', text: t.label }),
    h('div', { class: 'tile-value', text: t.value(t.s) }),
    h('div', { class: 'tile-name' }, h('span', { class: 'swatch', style: { background: color(t.s) } }), h('span', { text: t.s.name })),
    h('div', { class: 'tile-sub', text: t.sub(t.s) })))));

  // ---- Insights
  root.append(h('section', { class: 'card' },
    h('h3', { text: 'Key findings' }),
    h('ul', { class: 'insights' }, A.insights.map((it) => h('li', { class: `insight insight-${it.kind}` },
      h('span', { class: 'insight-icon', text: { good: '✓', warn: '!', bad: '✕', info: 'ℹ' }[it.kind] }),
      h('div', {}, h('strong', { text: it.title }), h('p', { text: it.text })))))));

  // ---- Ranking table
  const tableWrap = h('div', { class: 'table-wrap' });
  let sortKey = 'score', sortDir = 1;
  const objective = select(Object.entries(OBJECTIVES).map(([value, o]) => ({ value, label: o.label })), 'balanced', (v) => {
    sortKey = OBJECTIVES[v].key; sortDir = OBJECTIVES[v].dir; drawTable();
  });
  const cols = COLUMNS.filter((c) => !c.when || c.when(A.session));
  const drawTable = () => {
    const rows = [...S].sort((a, b) => sortDir * (b[sortKey] - a[sortKey]));
    const thead = h('tr', {}, h('th', { text: '#' }), h('th', { text: 'Strategy' }), cols.map((c) => {
      const th = h('th', { class: `num sortable ${c.key === sortKey ? 'sorted' : ''}`, tabIndex: 0, attrs: { 'aria-sort': c.key === sortKey ? (sortDir === c.dir ? 'descending' : 'ascending') : 'none' } },
        c.label, c.key === sortKey ? (sortDir === c.dir ? ' ▾' : ' ▴') : '', info(c.tip));
      const act = () => { if (sortKey === c.key) sortDir = -sortDir; else { sortKey = c.key; sortDir = c.dir; } drawTable(); };
      th.addEventListener('click', act);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter') act(); });
      return th;
    }));
    const body = rows.map((s, i) => h('tr', {},
      h('td', { class: 'num muted', text: String(i + 1) }),
      h('td', { class: 'strat-cell' },
        h('div', { class: 'strat-name' }, h('span', { class: 'swatch', style: { background: color(s) } }), h('span', { text: s.name }), s.onFrontier ? h('span', { class: 'badge', title: 'On the efficient frontier: no other strategy has both a better average and lower volatility.', text: 'frontier' }) : null),
        h('div', { class: 'strat-desc', text: s.description })),
      cols.map((c) => {
        const v = s[c.key];
        let txt = c.fmt === 'num0' ? num(v, 0) : formatValue(v, c.fmt);
        if (c.key === 'mean') txt = `${money(v)} ±${money(s.ci95)}`;
        const cls = ['mean', 'median', 'cvar5', 'p95', 'expectedNet'].includes(c.key) ? (v > 0 ? 'good' : v < 0 ? 'bad-soft' : '') : '';
        return h('td', { class: `num ${cls}`, text: txt });
      })));
    clear(tableWrap).append(h('table', { class: 'data-table' }, h('thead', {}, thead), h('tbody', {}, body)));
  };
  drawTable();
  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', { text: 'Strategy ranking' }),
      h('div', { class: 'card-tools' },
        h('label', { class: 'inline-field' }, h('span', { text: 'Rank by' }), objective),
        h('button', { class: 'btn btn-small', text: 'Export CSV', on: { click: () => exportCsv(S, cols) } }),
        h('button', { class: 'btn btn-small', text: 'Export JSON', on: { click: () => exportJson(A, strategies) } }))),
    h('p', { class: 'card-sub', text: `${A.trials.toLocaleString()} sessions per strategy · ${A.session.games} games each · ${money(A.session.bankroll)} bankroll · identical dice for every strategy (common random numbers).` }),
    tableWrap));

  // ---- Risk / reward
  const riskChoices = {
    sd: { label: 'Volatility (std. dev.)', get: (s) => s.sd, fmt: fmtMoney },
    cvar: { label: 'Bad-day loss (CVaR 5%)', get: (s) => -s.cvar5, fmt: fmtMoney },
    ruin: { label: 'Risk of ruin', get: (s) => s.pRuin, fmt: (v) => pct(v, 1) },
    dd: { label: 'Average drawdown', get: (s) => s.avgMaxDrawdown, fmt: fmtMoney },
  };
  let riskKey = 'sd';
  const scatterBox = h('div', { class: 'chart' });
  const drawScatter = () => {
    const rc = riskChoices[riskKey];
    const pts = S.map((s) => ({ x: rc.get(s), y: s.expectedNet, label: s.name, color: color(s), emph: true, tip: [{ label: 'simulated average', value: money(s.mean) }, { label: 'chance to finish ahead', value: pct(s.pProfit) }, { label: 'risk of ruin', value: pct(s.pRuin) }] }));
    // Frontier on the chosen risk axis
    const front = [];
    pts.forEach((a, i) => { if (!pts.some((b, j) => j !== i && b.y >= a.y && b.x <= a.x && (b.y > a.y || b.x < a.x))) front.push(i); });
    mount(scatterBox, scatter({ points: pts, frontier: front, xTitle: rc.label, yTitle: 'Expected result per session', xFormat: rc.fmt, yFormat: fmtMoney, height: 340 }));
  };
  const riskSel = select(Object.entries(riskChoices).map(([value, r]) => ({ value, label: r.label })), riskKey, (v) => { riskKey = v; drawScatter(); });

  const grid = h('div', { class: 'chart-grid' });
  root.append(grid);
  grid.append(card('Risk vs. reward', 'Up = better expected result (exact), left = less risk (simulated). The line connects the efficient frontier: strategies no other strategy beats on both. Anything off the line is dominated.',
    h('div', { class: 'card-tools' }, h('label', { class: 'inline-field' }, h('span', { text: 'Risk measure' }), riskSel)), legend(S.map((s) => ({ name: s.name, color: color(s), kind: 'dot' }))), scatterBox, { wide: true }));
  drawScatter();

  // ---- Average result with CI
  const meanBox = h('div', { class: 'chart' });
  grid.append(card('Average result per session', 'Bars show the mean; whiskers the 95% confidence interval. Overlapping whiskers mean the difference may be noise.', meanBox));
  mount(meanBox, hbars({ items: [...S].sort((a, b) => b.mean - a.mean).map((s) => ({ label: s.name, value: s.mean, color: color(s), ci: [s.mean - s.ci95, s.mean + s.ci95], tip: [{ label: 'theory', value: money(s.expectedNet) }, { label: 'median', value: money(s.median) }] })), format: fmtMoney, valueLabel: 'Average result' }));

  const probBox = h('div', { class: 'chart' });
  grid.append(card('Chance to finish ahead', 'Share of sessions ending in profit. Progressions often score high here — check their bad-day loss before celebrating.', probBox));
  mount(probBox, hbars({ items: [...S].sort((a, b) => b.pProfit - a.pProfit).map((s) => ({ label: s.name, value: s.pProfit, color: color(s), ci: s.pProfitCI, tip: [{ label: 'break even or better', value: pct(s.pBreakEven) }, { label: 'ever ahead during session', value: pct(s.pEverAhead) }] })), format: (v) => pct(v, 0), domain: [0, Math.min(1, Math.max(...S.map((s) => s.pProfitCI[1])) * 1.05)], valueLabel: 'P(ahead)' }));

  const ruinBox = h('div', { class: 'chart' }), cvarBox = h('div', { class: 'chart' });
  grid.append(card('Risk of ruin & bad-day loss', 'Top: share of sessions that went broke. Bottom: average result of the worst 5% of sessions.', h('div', { class: 'sub-label', text: 'Risk of ruin' }), ruinBox, h('div', { class: 'sub-label', text: 'Worst-5% average (CVaR)' }), cvarBox));
  mount(ruinBox, hbars({ items: [...S].sort((a, b) => a.pRuin - b.pRuin).map((s) => ({ label: s.name, value: s.pRuin, color: color(s) })), format: (v) => pct(v, 1), valueLabel: 'Risk of ruin' }));
  mount(cvarBox, hbars({ items: [...S].sort((a, b) => b.cvar5 - a.cvar5).map((s) => ({ label: s.name, value: s.cvar5, color: color(s), tip: [{ label: '5th percentile (VaR)', value: money(s.var5) }, { label: 'worst session', value: money(s.min) }] })), format: fmtMoney, valueLabel: 'Worst-5% average' }));

  // ---- Focus strategy controls (one row, scoping the detail charts below)
  let focus = pick('score', 1).index;
  const focusSel = select(S.map((s) => ({ value: s.index, label: s.name })), focus, (v) => { focus = +v; drawFocus(); });
  const histSet = new Set([...S].sort((a, b) => b.score - a.score).slice(0, 3).map((s) => s.index));
  const chipRow = h('div', { class: 'chips' });
  const drawChips = () => {
    clear(chipRow);
    for (const s of S) {
      const on = histSet.has(s.index);
      chipRow.append(h('button', { class: `chip ${on ? 'on' : ''}`, attrs: { 'aria-pressed': String(on) }, on: { click: () => {
        if (on) histSet.delete(s.index); else histSet.add(s.index);
        if (!histSet.size) histSet.add(s.index);
        drawChips(); drawHist();
      } } }, h('span', { class: 'swatch', style: { background: color(s) } }), h('span', { text: s.name })));
    }
  };

  const histBox = h('div', { class: 'chart' });
  const drawHist = () => {
    const chosen = S.filter((s) => histSet.has(s.index));
    const hist = sharedHistogram(chosen.map((s) => A.raw[s.index].net), chosen.length === 1 ? 50 : 40);
    mount(histBox, histogram({ edges: hist.edges, series: chosen.map((s, i) => ({ name: s.name, color: color(s), values: hist.counts[i] })), xFormat: fmtMoney, xTitle: 'Session result', yTitle: 'Share of sessions', height: 300 }));
  };
  grid.append(card('Distribution of session results', 'How results spread out. A single strategy shows red bars for losing sessions and blue for winning ones. Tall narrow = predictable; long left tail = occasional disasters.',
    h('p', { class: 'card-sub', text: 'Toggle strategies to compare:' }), chipRow, histBox, { wide: true }));
  drawChips(); drawHist();

  const medBox = h('div', { class: 'chart' });
  const cps = A.checkpointGames;
  if (A.bands.every(Boolean)) {
    grid.append(card('Bankroll over the session (median)', 'The typical (median) bankroll after each game, for every strategy. The slope is the house edge eating the bankroll.',
      S.length > 8 ? legend(S.map((s) => ({ name: s.name, color: color(s) }))) : null, medBox, { wide: true }));
    mount(medBox, lineChart({
      series: S.map((s) => ({ name: s.name, color: color(s), x: cps, y: A.bands[s.index].map((b) => b.p50) })),
      refY: A.session.bankroll, refLabel: 'starting bankroll', endLabels: S.length <= 8, yFormat: fmtMoney, xFormat: (v) => `${Math.round(v)}`, xTipLabel: 'After game ', xTitle: 'Games played', height: 320,
    }));
  }

  // ---- Focus section
  const focusHead = h('div', { class: 'focus-bar' }, h('h3', { text: 'Deep dive' }), h('label', { class: 'inline-field' }, h('span', { text: 'Strategy' }), focusSel));
  const fanBox = h('div', { class: 'chart' }), pathsBox = h('div', { class: 'chart' }), brkBox = h('div', { class: 'chart' }), brkTable = h('div', { class: 'table-wrap' }), statsBox = h('div', { class: 'stat-list' });
  root.append(h('section', { class: 'card focus' }, focusHead,
    h('div', { class: 'chart-grid inner' },
      card('Range of outcomes over time', 'Shaded bands: the middle 50% (darker) and middle 90% (lighter) of bankrolls after each game. Line: median.', fanBox, { wide: true }),
      card('Sample sessions', 'A dozen individual sessions on the same dice — what a real night might look like.', pathsBox),
      card('Session statistics', null, statsBox),
      card('Where the money went', 'Net result per session by bet type, and each bet\'s observed vs. theoretical edge.', brkBox, brkTable, { wide: true }))));

  const drawFocus = () => {
    const s = S.find((x) => x.index === focus);
    const c = color(s);
    const b = A.bands[focus];
    if (b) {
      mount(fanBox, lineChart({
        series: [{ name: 'Median', color: c, x: cps, y: b.map((v) => v.p50) }, { name: 'Mean', color: '#c3c2b7', x: cps, y: b.map((v) => v.mean), width: 1.5 }],
        bands: [{ color: c, x: cps, lo: b.map((v) => v.p5), hi: b.map((v) => v.p95), opacity: 0.12, name: '90% of sessions' }, { color: c, x: cps, lo: b.map((v) => v.p25), hi: b.map((v) => v.p75), opacity: 0.22, name: '50% of sessions' }],
        refY: A.session.bankroll, refLabel: 'start', yFormat: fmtMoney, xFormat: (v) => `${Math.round(v)}`, xTipLabel: 'After game ', xTitle: 'Games played', height: 320,
      }));
      const paths = A.paths[focus] || [];
      const gx = Array.from({ length: A.session.games + 1 }, (_, i) => i);
      mount(pathsBox, lineChart({
        series: paths.map((p, i) => ({ name: `Session ${p.trial + 1}`, color: i === 0 ? c : '#898781', x: gx, y: Array.from(p.values), width: i === 0 ? 2 : 1, opacity: i === 0 ? 1 : 0.55 })),
        refY: A.session.bankroll, yFormat: fmtMoney, xFormat: (v) => `${Math.round(v)}`, xTipLabel: 'After game ', xTitle: 'Games played', height: 260,
      }));
    }
    clear(statsBox).append(...[
      ['Average result', `${money(s.mean)} ± ${money(s.ci95)}`],
      ['Theoretical expectation', money(s.expectedNet)],
      ['Median session', money(s.median)],
      ['Middle 50% of sessions', `${money(s.p25)} to ${money(s.p75)}`],
      ['Middle 90% of sessions', `${money(s.p5)} to ${money(s.p95)}`],
      ['Best / worst session', `${money(s.max)} / ${money(s.min)}`],
      ['Chance to finish ahead', `${pct(s.pProfit)} (95% CI ${pct(s.pProfitCI[0])}–${pct(s.pProfitCI[1])})`],
      ['Ahead at some point', pct(s.pEverAhead)],
      ['Average high-water mark', money(s.avgHigh, { sign: true })],
      ['Risk of ruin', pct(s.pRuin, 2)],
      ...(A.session.winGoal ? [['Reached win goal', pct(s.pGoal)]] : []),
      ...(A.session.stopLoss ? [['Hit stop-loss', pct(s.pStopLoss)]] : []),
      ['Avg / 95th pct drawdown', `${money(s.avgMaxDrawdown)} / ${money(s.p95MaxDrawdown)}`],
      ['Wagered per session', money(s.avgAction)],
      ['Wagered per roll', money(s.actionPerRoll, { decimals: 2 })],
      ['House edge (sim / theory)', `${pct(s.edgeObserved, 3)} / ${pct(s.edgeTheory, 3)}`],
      ['Expected cost per hour', money(s.theoryLossPerHour, { decimals: 2 })],
      ['Sharpe / Sortino ratio', `${num(s.sharpe, 3)} / ${num(s.sortino, 3)}`],
      ['Rolls / games per session', `${num(s.avgRolls, 0)} / ${num(s.avgGames, 1)}`],
    ].map(([k, v]) => h('div', { class: 'stat-row' }, h('span', { text: k }), h('strong', { class: 'tnum', text: v }))));

    const br = A.breakdown[focus];
    mount(brkBox, hbars({ items: br.map((r) => ({ label: r.label, value: r.netPerSession, color: r.netPerSession >= 0 ? '#3987e5' : '#e66767', tip: [{ label: 'wagered / session', value: money(r.actionPerSession) }, { label: 'win rate', value: pct(r.winRate) }] })), format: (v) => money(v, { decimals: Math.abs(v) < 10 ? 2 : 0 }), valueLabel: 'Net per session' }));
    clear(brkTable).append(h('table', { class: 'data-table compact' },
      h('thead', {}, h('tr', {}, ['Bet', 'Decisions', 'Win rate', 'Wagered/session', 'Net/session', 'Edge (sim)', 'Edge (theory)'].map((t, i) => h('th', { class: i ? 'num' : '', text: t })))),
      h('tbody', {}, br.map((r) => h('tr', {},
        h('td', { text: r.label }),
        h('td', { class: 'num', text: num(r.wins + r.losses + r.pushes) }),
        h('td', { class: 'num', text: pct(r.winRate) }),
        h('td', { class: 'num', text: money(r.actionPerSession, { decimals: 2 }) }),
        h('td', { class: `num ${r.netPerSession >= 0 ? 'good' : 'bad-soft'}`, text: money(r.netPerSession, { decimals: 2 }) }),
        h('td', { class: 'num', text: pct(r.edgeObserved, 2) }),
        h('td', { class: 'num', text: pct(r.edgeTheory, 2) }))))));
  };
  drawFocus();

  // ---- Dice diagnostics
  root.append(renderDice(A));
}

function renderDice(A) {
  const d = A.dice;
  const total = d.rolls;
  const sumsBox = h('div', { class: 'chart' }), handBox = h('div', { class: 'chart' });
  const chi = d.chi;
  const fair = chi.p > 0.01;
  const sec = h('section', { class: 'card' },
    h('h3', {}, 'The dice: numbers 2–12', info('Pure dice statistics from the simulated sessions (independent of strategy). The chi-square test checks the random number generator against the exact 1-2-3-4-5-6-5-4-3-2-1 distribution.')),
    h('p', { class: 'card-sub', text: `${total.toLocaleString()} rolls simulated. χ² = ${chi.chi2.toFixed(2)} (10 df), p = ${chi.p.toFixed(3)} — ${fair ? 'consistent with fair dice.' : 'unusual; try a different seed.'}` }),
    h('div', { class: 'chart-grid inner' },
      card('Frequency of each sum', 'Bars: observed share of rolls. White ticks: exact probability (ways ÷ 36).', sumsBox),
      card('Shooter hand length', `Rolls per shooter before a seven-out. Theory: ${A.dice.theory.rollsPerHand.toFixed(2)} rolls on average.`, handBox),
    ),
    h('div', { class: 'stat-strip' },
      stat('Rolls per game', `${d.avgRollsPerGame.toFixed(3)}`, `theory ${A.dice.theory.rollsPerGame.toFixed(3)}`),
      stat(A.rules.game === 'crapless' ? 'Come-out sevens (crapless)' : 'Come-out naturals (7/11)', pct(d.naturals / d.comeOuts, 2), `theory ${pct(A.dice.theory.pNatural, 2)}`),
      A.rules.game === 'crapless'
        ? stat('Come-out craps', '—', 'none in crapless: 2/3/12 become points')
        : stat('Come-out craps (2/3/12)', pct(d.craps / d.comeOuts, 2), `theory ${pct(A.dice.theory.pCraps, 2)}`),
      stat('Points made', pct(d.pointsMade.reduce((a, b) => a + b, 0) / Math.max(1, d.pointsEstablished.reduce((a, b) => a + b, 0)), 2), `theory ${pct(A.dice.theory.pPointMadeGivenEstablished, 2)}`),
      stat('Longest hand', `${d.longestHand} rolls`, ''),
    ));
  const cats = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  mount(sumsBox, columns({ categories: cats, values: cats.map((c) => d.sums[c] / total), expected: cats.map((c) => WAYS[c] / 36), yFormat: (v) => `${(v * 100).toFixed(0)}%`, tipFormat: (v) => `${(v * 100).toFixed(3)}%`, catLabel: 'Sum ', xTitle: 'Dice total',
    extraTip: (i) => [{ value: d.sums[cats[i]].toLocaleString(), label: 'rolls' }, { value: `${WAYS[cats[i]]} of 36`, label: 'ways' }] }));
  const hl = d.handLengths;
  const hands = hl.reduce((a, b) => a + b, 0) || 1;
  const hcats = [], hvals = [];
  for (let i = 1; i < Math.min(hl.length, 41); i++) { hcats.push(i === hl.length - 1 ? `${i}+` : i); hvals.push(hl[i] / hands); }
  mount(handBox, columns({ categories: hcats, values: hvals, color: '#199e70', yFormat: (v) => `${(v * 100).toFixed(0)}%`, tipFormat: (v) => `${(v * 100).toFixed(2)}%`, catLabel: 'Hand of ', valueLabel: 'Share of hands', xTitle: 'Rolls before seven-out' }));
  return sec;
}

function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: label }), h('div', { class: 'stat-value tnum', text: value }), sub ? h('div', { class: 'stat-sub', text: sub }) : null);
}

function card(title, tipText, ...body) {
  let opts = {};
  if (body.length && body[body.length - 1] && !(body[body.length - 1] instanceof Node) && typeof body[body.length - 1] === 'object') opts = body.pop();
  return h('div', { class: `card chart-card ${opts.wide ? 'wide' : ''}` },
    h('h4', {}, title, tipText ? info(tipText) : null), ...body);
}

function exportCsv(S, cols) {
  const head = ['strategy', 'description', ...cols.map((c) => c.key), 'ci95', 'p5', 'p25', 'p75', 'expectedNet'];
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [head.join(',')];
  for (const s of S) lines.push([esc(s.name), esc(s.description), ...cols.map((c) => s[c.key]), s.ci95, s.p5, s.p25, s.p75, s.expectedNet].join(','));
  download('craps-strategy-results.csv', lines.join('\n'), 'text/csv');
}

function exportJson(A, strategies) {
  const { raw, paths, ...rest } = A;
  download('craps-simulation.json', JSON.stringify({ ...rest, strategies }, null, 2));
}

export { SERIES_COLORS };
