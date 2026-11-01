// Simulator tab: pick strategies, configure sessions, run the Monte Carlo, show results.

import { h, clear, field, numberInput, money, toast, download, info, num } from './dom.js';
import { store, colorFor } from './state.js';
import { openBuilder } from './builder.js';
import { renderResults } from './results.js';
import { SimRunner } from '../sim/runner.js';
import { analyze } from '../engine/analysis.js';
import { validateStrategy, describeStrategy, normalizeStrategy, defaultStrategy, newId } from '../engine/strategy.js';
import { presetCatalog } from '../engine/presets.js';
import { randomSeed } from '../engine/rng.js';
import { THEORY } from '../engine/stats.js';

export const runner = new SimRunner();

export function mountSimPage(root) {
  const listEl = h('div', { class: 'strategy-list' });
  const resultsEl = h('div', { class: 'results' }, emptyState());
  const progress = h('div', { class: 'progress', hidden: true }, h('div', { class: 'progress-bar' }), h('span', { class: 'progress-text' }));
  const runBtn = h('button', { class: 'btn btn-primary btn-run', text: 'Run simulation' });
  const cancelBtn = h('button', { class: 'btn btn-ghost', text: 'Cancel', hidden: true, on: { click: () => runner.cancel() } });
  const estimate = h('p', { class: 'field-hint estimate' });

  // ---- Strategy list
  const presetSel = h('select', { attrs: { 'aria-label': 'Add a preset strategy' } });
  const fillPresets = () => {
    clear(presetSel).append(h('option', { value: '', text: '+ Add a classic strategy…' }));
    for (const p of presetCatalog(store.rules.tableMin)) presetSel.append(h('option', { value: p.key, text: p.name, title: p.notes }));
  };
  fillPresets();
  presetSel.addEventListener('change', () => {
    const p = presetCatalog(store.rules.tableMin).find((x) => x.key === presetSel.value);
    presetSel.value = '';
    if (p) { store.upsertStrategy(p.build()); toast(`Added “${p.name}”`, 'good'); }
  });

  const drawList = () => {
    clear(listEl);
    for (const s of store.strategies) {
      const v = validateStrategy(s, store.rules);
      const cb = h('input', { type: 'checkbox', checked: store.included.has(s.id), attrs: { 'aria-label': `Include ${s.name}` } });
      cb.addEventListener('change', () => { if (cb.checked) store.included.add(s.id); else store.included.delete(s.id); store.save(); updateEstimate(); });
      listEl.append(h('div', { class: `strategy-item ${v.errors.length ? 'has-error' : ''}` },
        cb,
        h('span', { class: 'swatch', style: { background: colorFor(s.colorSlot) } }),
        h('div', { class: 'strategy-text', on: { click: () => edit(s) } },
          h('div', { class: 'strategy-name', text: s.name }),
          h('div', { class: 'strategy-desc', text: describeStrategy(s) }),
          v.errors.length ? h('div', { class: 'strategy-err', text: v.errors[0] }) : null),
        h('div', { class: 'strategy-actions' },
          h('button', { class: 'btn btn-ghost icon-btn', title: 'Edit', attrs: { 'aria-label': `Edit ${s.name}` }, text: '✎', on: { click: () => edit(s) } }),
          h('button', { class: 'btn btn-ghost icon-btn', title: 'Duplicate', attrs: { 'aria-label': `Duplicate ${s.name}` }, text: '⧉', on: { click: () => {
            const copy = { ...JSON.parse(JSON.stringify(s)), id: newId(), name: `${s.name} (copy)`, colorSlot: null };
            store.upsertStrategy(copy);
          } } }),
          h('button', { class: 'btn btn-ghost icon-btn', title: 'Delete', attrs: { 'aria-label': `Delete ${s.name}` }, text: '🗑', on: { click: () => {
            if (confirm(`Delete “${s.name}”?`)) store.removeStrategy(s.id);
          } } }))));
    }
    updateEstimate();
  };
  const edit = (s) => openBuilder(s, { title: `Edit: ${s.name}` });

  const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  importInput.addEventListener('change', async () => {
    const f = importInput.files[0];
    importInput.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const arr = Array.isArray(data) ? data : data.strategies || [data];
      let n = 0;
      for (const raw of arr) { if (raw && typeof raw === 'object') { store.upsertStrategy({ ...normalizeStrategy(raw), id: newId(), colorSlot: null }); n++; } }
      toast(`Imported ${n} strateg${n === 1 ? 'y' : 'ies'}`, 'good');
    } catch (e) { toast(`Import failed: ${e.message}`, 'bad'); }
  });

  // ---- Session settings
  const sess = { ...store.session };
  const commit = () => { store.setSession(sess); updateEstimate(); };
  const seedInput = numberInput(sess.seed, (v) => { sess.seed = v; commit(); }, { min: 1 });
  const settings = h('div', { class: 'form-grid two' },
    field('Starting bankroll ($)', numberInput(sess.bankroll, (v) => { sess.bankroll = v; commit(); }, { min: 1, step: 50 }), 'Paper money per session'),
    field('Games per session', numberInput(sess.games, (v) => { sess.games = v; commit(); }, { min: 1, step: 10 }), `A game = one Pass Line decision (~${THEORY.rollsPerGame.toFixed(2)} rolls)`),
    field('Sessions to simulate', numberInput(sess.trials, (v) => { sess.trials = v; commit(); }, { min: 1, step: 1000 }), 'More sessions = tighter estimates'),
    field('Rolls per hour', numberInput(sess.rollsPerHour, (v) => { sess.rollsPerHour = v; commit(); }, { min: 1, step: 10 }), 'Typical busy table: 60–100'),
    field('Stop-loss ($)', numberInput(sess.stopLoss, (v) => { sess.stopLoss = v; commit(); }, { min: 0, step: 50 }), '0 = play all games'),
    field('Win goal ($)', numberInput(sess.winGoal, (v) => { sess.winGoal = v; commit(); }, { min: 0, step: 50 }), '0 = no goal'),
    field('Random seed', h('div', { class: 'seed-row' }, seedInput,
      h('button', { class: 'btn btn-small', text: '🎲', title: 'New random seed', attrs: { 'aria-label': 'New random seed' }, on: { click: () => { sess.seed = randomSeed(); seedInput.value = String(sess.seed); commit(); } } })), 'Same seed → same dice → reproducible'),
  );

  function updateEstimate() {
    const n = store.strategies.filter((s) => store.included.has(s.id)).length;
    const s = store.session;
    const rolls = n * s.trials * s.games * THEORY.rollsPerGame;
    const secs = rolls / (2.2e6 * runner.size);
    estimate.textContent = `${n} strateg${n === 1 ? 'y' : 'ies'} × ${s.trials.toLocaleString()} sessions × ${s.games} games ≈ ${num(rolls / 1e6, 1)}M rolls · est. ${secs < 1 ? '<1' : Math.ceil(secs)}s on ${runner.size} worker${runner.size > 1 ? 's' : ''}`;
  }

  // ---- Run
  let running = false;
  runBtn.addEventListener('click', async () => {
    if (running) return;
    const chosen = store.strategies.filter((s) => store.included.has(s.id));
    if (!chosen.length) { toast('Select at least one strategy to simulate.', 'warn'); return; }
    const bad = chosen.map((s) => [s, validateStrategy(s, store.rules)]).filter(([, v]) => v.errors.length);
    if (bad.length) { toast(`Fix “${bad[0][0].name}”: ${bad[0][1].errors[0]}`, 'bad', 6000); return; }
    running = true;
    runBtn.disabled = true; cancelBtn.hidden = false; progress.hidden = false;
    const bar = progress.firstChild, label = progress.lastChild;
    const t0 = performance.now();
    resultsEl.classList.add('stale');
    try {
      const session = { ...store.session };
      const merged = await runner.run({ strategies: chosen, rules: store.rules, session, collectPaths: true, samplePaths: 12 }, (f) => {
        bar.style.width = `${(f * 100).toFixed(1)}%`;
        label.textContent = `${(f * 100).toFixed(0)}%`;
      });
      label.textContent = 'Analyzing…';
      await new Promise((r) => setTimeout(r, 0));
      const analysis = analyze(merged, chosen, session, store.rules);
      renderResults(resultsEl, analysis, chosen);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      toast(`Simulated ${(session.trials * chosen.length).toLocaleString()} sessions in ${secs}s`, 'good');
      store.lastAnalysis = analysis;
    } catch (e) {
      if (e.message !== 'cancelled') { console.error(e); toast(`Simulation failed: ${e.message}`, 'bad', 6000); }
      else toast('Simulation cancelled', 'info');
    } finally {
      running = false;
      runBtn.disabled = false; cancelBtn.hidden = true; progress.hidden = true;
      resultsEl.classList.remove('stale');
    }
  });

  root.append(h('div', { class: 'sim-layout' },
    h('aside', { class: 'sim-side' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', {}, 'Strategies', info('Check the strategies to compare. Click one to edit it. Each keeps its color across every chart.'))),
        listEl,
        h('div', { class: 'list-tools' },
          h('button', { class: 'btn btn-small', text: '+ New strategy', on: { click: () => openBuilder({ ...defaultStrategy(), name: 'My strategy' }, { title: 'New strategy' }) } }),
          presetSel),
        h('div', { class: 'list-tools' },
          h('button', { class: 'btn btn-small btn-ghost', text: 'Select all', on: { click: () => { store.strategies.forEach((s) => store.included.add(s.id)); store.save(); drawList(); } } }),
          h('button', { class: 'btn btn-small btn-ghost', text: 'Select none', on: { click: () => { store.included.clear(); store.save(); drawList(); } } }),
          h('button', { class: 'btn btn-small btn-ghost', text: 'Import', on: { click: () => importInput.click() } }),
          h('button', { class: 'btn btn-small btn-ghost', text: 'Export', on: { click: () => download('craps-strategies.json', JSON.stringify(store.strategies, null, 2)) } }),
          h('button', { class: 'btn btn-small btn-ghost', text: 'Reset', title: 'Restore the starter strategies', on: { click: () => { if (confirm('Replace your strategies with the starter set?')) { store.resetToStarters(); store.save(); store.emit('strategies'); } } } }),
          importInput)),
      h('section', { class: 'card' },
        h('h3', {}, 'Session settings', info('Each simulated session starts with the bankroll below and plays the given number of games, unless it busts or hits a stop rule. Bets still on the table at the end are played out (contract bets) or taken down.')),
        settings,
        h('div', { class: 'run-row' }, runBtn, cancelBtn),
        progress, estimate)),
    resultsEl));

  store.on('strategies', drawList);
  store.on('rules', () => { fillPresets(); drawList(); });
  drawList();
}

function emptyState() {
  return h('div', { class: 'empty card' },
    h('div', { class: 'empty-dice', attrs: { 'aria-hidden': 'true' }, text: '⚀ ⚅' }),
    h('h2', { text: 'Compare craps strategies with Monte Carlo simulation' }),
    h('p', { text: 'Pick strategies on the left (or build your own), set your bankroll and session length, then press Run. Every strategy is played against the same dice, thousands of times, with real casino payouts — then ranked on expected result, chance of finishing ahead, risk of ruin, bad-day losses and house edge.' }),
    h('ol', { class: 'steps' },
      h('li', { text: 'Choose or build strategies — Pass Line, odds, Come bets, Place/Buy/Lay, Field, hardways, props and progressions.' }),
      h('li', { text: 'Set paper-money bankroll, games per session, number of sessions and optional stop-loss / win goal.' }),
      h('li', { text: 'Run, then explore the ranking, risk-vs-reward frontier, distributions and bankroll trajectories.' })),
    h('p', { class: 'muted', text: 'Tip: the Strategy Explorer tab brute-forces hundreds of bet combinations to find the best risk/reward mixes.' }));
}

export { money };
