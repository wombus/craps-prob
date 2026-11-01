// App entry: initialize state, mount each tab, wire up tab navigation.

import { store } from './ui/state.js';
import { mountSimPage } from './ui/simPage.js';
import { mountExplorer } from './ui/explorer.js';
import { mountLiveTable } from './ui/liveTable.js';
import { mountLearn } from './ui/learn.js';
import { mountRules } from './ui/rulesPanel.js';
import { ODDS_LIMITS } from './engine/rules.js';
import { $, $$, money } from './ui/dom.js';

store.init();

const TABS = {
  simulator: mountSimPage,
  explorer: mountExplorer,
  live: mountLiveTable,
  learn: mountLearn,
  rules: mountRules,
};
const mounted = new Set();

function show(tab) {
  if (!TABS[tab]) tab = 'simulator';
  for (const btn of $$('.tab')) {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
  }
  for (const panel of $$('.panel')) panel.hidden = panel.id !== `panel-${tab}`;
  if (!mounted.has(tab)) { mounted.add(tab); TABS[tab]($(`#panel-${tab}`)); }
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}

for (const btn of $$('.tab')) btn.addEventListener('click', () => show(btn.dataset.tab));
$('.tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const tabs = $$('.tab');
  const i = tabs.findIndex((t) => t.classList.contains('on'));
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  show(next.dataset.tab); next.focus();
});
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

function rulesChip() {
  const r = store.rules;
  $('#rules-chip').textContent = `${r.game === 'crapless' ? 'CRAPLESS · ' : ''}${money(r.tableMin)}–${money(r.tableMax, { compact: true })} · ${ODDS_LIMITS[r.oddsLimit].label.split(' ')[0]} odds · Field 12 pays ${r.field12Pays}:1`;
}
$('#rules-chip').addEventListener('click', () => show('rules'));
store.on('rules', rulesChip);
rulesChip();

show(location.hash.slice(1) || 'simulator');
